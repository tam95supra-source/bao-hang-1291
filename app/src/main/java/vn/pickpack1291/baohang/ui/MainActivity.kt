package vn.pickpack1291.baohang.ui

import android.app.AlertDialog
import android.content.Intent
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.ArrayAdapter
import android.widget.AutoCompleteTextView
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import vn.pickpack1291.baohang.BaoHangApplication
import vn.pickpack1291.baohang.BuildConfig
import vn.pickpack1291.baohang.R
import vn.pickpack1291.baohang.data.AppConfig
import vn.pickpack1291.baohang.data.InventoryImportRow
import vn.pickpack1291.baohang.data.InventoryStatus
import vn.pickpack1291.baohang.data.IssueBoard
import vn.pickpack1291.baohang.data.IssueStatus
import vn.pickpack1291.baohang.data.OperationalConfig
import vn.pickpack1291.baohang.data.SkuItem
import vn.pickpack1291.baohang.data.StockIssue
import vn.pickpack1291.baohang.data.UserProfile
import vn.pickpack1291.baohang.data.UserRole
import vn.pickpack1291.baohang.importer.XlsxImporter
import vn.pickpack1291.baohang.realtime.RealtimeClient
import vn.pickpack1291.baohang.update.AppUpdater
import java.time.Instant
import java.util.UUID

class MainActivity : AppCompatActivity() {
    private val app by lazy { application as BaoHangApplication }
    private lateinit var container: FrameLayout
    private var searchJob: Job? = null
    private var realtimeAuthJob: Job? = null
    private var currentScreen = ""

    private val realtime by lazy {
        RealtimeClient(
            diagnostics = app.diagnostics,
            onIssueChanged = {
                runOnUiThread {
                    when (currentScreen) {
                        SCREEN_INVENT -> showInventBoard()
                        SCREEN_PICKER -> lifecycleScope.launch { checkPendingAlerts() }
                    }
                }
            },
            onInventoryChanged = {
                runOnUiThread { if (currentScreen == SCREEN_INVENTORY) showInventory() }
            },
            onStatus = { app.diagnostics.info("realtime_status", mapOf("status" to it.name)) }
        )
    }

    private val chooseSku = registerForActivityResult(ActivityResultContracts.GetContent()) { uri -> uri?.let(::importSkuFile) }
    private val chooseUsers = registerForActivityResult(ActivityResultContracts.GetContent()) { uri -> uri?.let(::importUserFile) }
    private val chooseInventory = registerForActivityResult(ActivityResultContracts.GetContent()) { uri -> uri?.let(::importInventoryFile) }
    private val saveTemplate = registerForActivityResult(ActivityResultContracts.CreateDocument(XLSX_MIME)) { uri -> uri?.let(::writeTemplate) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!app.session.isLoggedIn) {
            startActivity(Intent(this, LoginActivity::class.java)); finish(); return
        }
        setContentView(R.layout.activity_main)
        container = findViewById(R.id.contentContainer)
        findViewById<TextView>(R.id.btnLogout).setOnClickListener {
            AlertDialog.Builder(this).setMessage("Đăng xuất khỏi thiết bị này?")
                .setNegativeButton("HỦY", null).setPositiveButton("ĐĂNG XUẤT") { _, _ ->
                    realtime.stop()
                    app.repository.logout()
                    startActivity(Intent(this, LoginActivity::class.java)); finish()
                }.show()
        }
        lifecycleScope.launch {
            runCatching { app.repository.refreshProfile() }
                .onFailure { app.diagnostics.warn("profile_refresh_fallback", mapOf("error" to it.message.orEmpty())) }
            renderForRole()
            checkPendingAlerts()
        }
        AppUpdater(this, app.diagnostics).check()
        lifecycleScope.launch(Dispatchers.IO) {
            if (app.repository.outboxCount() > 0) runCatching { app.repository.flushOutbox() }
            runCatching { app.repository.syncCatalogIfStale() }
        }
    }

    override fun onStart() {
        super.onStart()
        if (!app.session.isLoggedIn) return
        realtimeAuthJob?.cancel()
        realtimeAuthJob = lifecycleScope.launch {
            while (true) {
                runCatching {
                    app.api.refreshSessionIfNeeded()
                    if (app.session.accessToken.isNotBlank()) {
                        realtime.start(app.session.accessToken)
                        realtime.updateAccessToken(app.session.accessToken)
                    }
                }.onFailure { app.diagnostics.warn("realtime_auth_refresh_failed", mapOf("error" to it.message.orEmpty())) }
                delay(5 * 60_000L)
            }
        }
    }

    override fun onStop() {
        realtimeAuthJob?.cancel()
        realtimeAuthJob = null
        realtime.stop()
        super.onStop()
    }

    override fun onResume() {
        super.onResume()
        if (app.session.isLoggedIn) lifecycleScope.launch { checkPendingAlerts() }
    }

    private fun renderForRole() {
        val profile = app.session.profile ?: return
        val effective = app.session.effectiveRole
        val mode = if (profile.role == UserRole.ADMIN && effective != UserRole.ADMIN) " • TEST ${effective.label.uppercase()}" else ""
        findViewById<TextView>(R.id.tvHeaderUser).text = "${profile.employeeCode} • ${profile.fullName} • ${effective.label}$mode"
        app.diagnostics.info("ui_role_render", mapOf("actual_role" to profile.role.wire, "effective_role" to effective.wire))
        when (effective) {
            UserRole.ADMIN -> showAdmin()
            UserRole.ADMIN_INVENT -> showAdminEvent()
            UserRole.INVENT -> showInventBoard()
            UserRole.PICKER -> showPicker()
        }
    }

    private fun page(title: String, screen: String): LinearLayout {
        currentScreen = screen
        container.removeAllViews()
        val scroll = ScrollView(this)
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(14), dp(14), dp(28))
        }
        scroll.addView(content, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        container.addView(scroll, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        content.addView(text(title, 22, true).apply { setPadding(0, 0, 0, dp(10)) })
        content.addView(infoBox("${app.session.effectiveRole.label} • ${BuildConfig.VERSION_NAME} • ${BuildConfig.OTA_CHANNEL.uppercase()}"))
        if (BuildConfig.UPDATE_MANIFEST_URL.isNotBlank()) {
            content.addView(button("KIỂM TRA CẬP NHẬT ${BuildConfig.OTA_CHANNEL.uppercase()}") {
                AppUpdater(this, app.diagnostics).check(showUpToDate = true)
            })
        }
        if (app.session.profile?.role == UserRole.ADMIN && app.session.adminTestRole != null) {
            content.addView(button("THOÁT CHẾ ĐỘ KIỂM THỬ") {
                app.repository.setAdminTestRole(null)
                renderForRole()
            })
        }
        return content
    }

    private fun showAdmin() {
        val content = page("ADMIN HỆ THỐNG", SCREEN_MENU)
        content.addView(infoBox("ADMIN duy nhất được bảo vệ. Mọi thay đổi quyền, cấu hình, tích hợp và release vẫn phải qua audit/server."))
        content.addView(button("SỰ KIỆN / ĐIỀU PHỐI") { showInventBoard() })
        content.addView(button("TỒN BIN") { showInventory() })
        content.addView(button("BÁO CÁO VẬN HÀNH") { showReports() })
        content.addView(button("NHÂN SỰ & QUYỀN") { showUsers() })
        content.addView(button("CẤU HÌNH HỆ THỐNG") { showConfig() })
        content.addView(button("IMPORT SKU.XLSX") { chooseSku.launch(XLSX_MIME) })
        content.addView(button("IMPORT NHÂN SỰ.XLSX") { chooseUsers.launch(XLSX_MIME) })
        content.addView(button("TẢI FILE NHÂN SỰ MẪU") { saveTemplate.launch("MAU_NHAN_SU_BAO_HANG_1291.xlsx") })
        content.addView(button("ĐỒNG BỘ GOOGLE SHEET") { syncSheet() })
        addDiagnosticsButton(content)
        content.addView(section("Kiểm thử giao diện + quyền server"))
        content.addView(infoBox("Test mode hạ quyền thật ở API; không chỉ ẩn nút giao diện."))
        content.addView(button("TEST • ADMIN EVENT") { enterTestRole(UserRole.ADMIN_INVENT) })
        content.addView(button("TEST • NGƯỜI BÁO HÀNG") { enterTestRole(UserRole.INVENT) })
        content.addView(button("TEST • PICKER / NGƯỜI LẤY HÀNG") { enterTestRole(UserRole.PICKER) })
    }

    private fun showAdminEvent() {
        val content = page("ADMIN EVENT", SCREEN_MENU)
        content.addView(button("SỰ KIỆN / ĐIỀU PHỐI") { showInventBoard() })
        content.addView(button("TỒN BIN") { showInventory() })
        content.addView(button("BÁO CÁO VẬN HÀNH") { showReports() })
        content.addView(button("NHÂN SỰ PICKER / NGƯỜI BÁO HÀNG") { showUsers() })
        content.addView(button("SLA VẬN HÀNH") { showOperationalSla() })
        content.addView(button("IMPORT SKU.XLSX") { chooseSku.launch(XLSX_MIME) })
        content.addView(button("IMPORT NHÂN SỰ.XLSX") { chooseUsers.launch(XLSX_MIME) })
        content.addView(button("ĐỒNG BỘ GOOGLE SHEET") { syncSheet() })
        addDiagnosticsButton(content)
    }

    private fun enterTestRole(role: UserRole) {
        runCatching { app.repository.setAdminTestRole(role) }
            .onSuccess { renderForRole() }
            .onFailure { toast(it.message ?: "Không bật được test mode") }
    }

    private fun showInventBoard() {
        val content = page("NGƯỜI BÁO HÀNG • SỰ KIỆN", SCREEN_INVENT)
        val status = text("Đang tải dữ liệu…", 14, false)
        val tabs = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
        val boardContainer = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        content.addView(status)
        content.addView(tabs)
        content.addView(boardContainer)
        addDiagnosticsButton(content)

        var board: IssueBoard? = null
        var selected = 0
        fun draw() {
            val data = board ?: return
            val list = when (selected) {
                1 -> data.claimed
                2 -> data.recent
                else -> data.open
            }
            boardContainer.removeAllViews()
            if (list.isEmpty()) boardContainer.addView(infoBox("Không có SKU ở nhóm này."))
            list.forEach { issue -> boardContainer.addView(issueCard(issue, selected) { loadInventBoard(status) { board = it; draw() } }) }
            status.text = when (selected) {
                1 -> "${list.size} SKU đang xử lý${if (app.session.effectiveRole == UserRole.INVENT) " của tôi" else ""}"
                2 -> "${list.size} SKU đã xử lý gần đây"
                else -> "${list.size} SKU chờ nhận"
            }
        }
        listOf("CHỜ NHẬN", "ĐANG XỬ LÝ", "ĐÃ XỬ LÝ").forEachIndexed { index, label ->
            tabs.addView(button(label) { selected = index; draw() }, LinearLayout.LayoutParams(0, dp(48), 1f).apply { setMargins(dp(2), dp(4), dp(2), dp(8)) })
        }
        loadInventBoard(status) { board = it; draw() }
    }

    private fun loadInventBoard(status: TextView, onLoaded: (IssueBoard) -> Unit) {
        status.text = "Đang tải dữ liệu…"
        lifecycleScope.launch {
            runCatching { app.repository.loadIssueBoard() }
                .onSuccess(onLoaded)
                .onFailure { status.text = "Lỗi: ${it.message}"; app.diagnostics.error("issue_board_load_failed", it) }
        }
    }

    private fun issueCard(issue: StockIssue, bucket: Int, refresh: () -> Unit): View {
        val elevated = app.session.effectiveRole in setOf(UserRole.ADMIN, UserRole.ADMIN_INVENT)
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), dp(10), dp(12), dp(10))
            setBackgroundResource(R.drawable.bg_card)
        }
        card.layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { setMargins(0, dp(5), 0, dp(5)) }
        val recurrent = if (issue.recurrence30m) " • TÁI PHÁT ≤30P" else ""
        card.addView(text("SKU ${issue.sku} • ${issue.reportCount} lượt • v${issue.issueVersion}$recurrent", 17, true))
        card.addView(text(issue.productName, 14, false))
        card.addView(text("${issue.status.label} • Báo đầu ${shortTime(issue.reportedAt)}${if (issue.assignedName.isNotBlank()) " • ${issue.assignedName}" else ""}", 12, false))
        card.addView(button("XEM TỒN SNAPSHOT") { showInventoryForSku(issue.sku) })
        if (bucket == 0) {
            card.addView(button("NHẬN XỬ LÝ") {
                lifecycleScope.launch {
                    runCatching { app.repository.claimIssue(issue.id) }
                        .onSuccess { toast("Đã nhận xử lý SKU ${issue.sku}"); refresh() }
                        .onFailure { toast(it.message ?: "Không nhận được SKU") }
                }
            })
            if (elevated) {
                val direct = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
                direct.addView(button("CHO SKIP") { confirmIssueUpdate(issue, "NOT_FOUND", refresh) }, LinearLayout.LayoutParams(0, dp(48), 1f))
                direct.addView(button("ĐÃ CÓ HÀNG") { confirmIssueUpdate(issue, "AVAILABLE", refresh) }, LinearLayout.LayoutParams(0, dp(48), 1f))
                card.addView(direct)
            }
        } else if (bucket == 1) {
            val actions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            actions.addView(button("KHÔNG THẤY • CHO SKIP") { confirmIssueUpdate(issue, "NOT_FOUND", refresh) }, LinearLayout.LayoutParams(0, dp(54), 1f))
            actions.addView(button("ĐÃ CÓ HÀNG / CHÂM BÙ") { confirmIssueUpdate(issue, "AVAILABLE", refresh) }, LinearLayout.LayoutParams(0, dp(54), 1f))
            card.addView(actions)
            if (elevated) card.addView(button("ĐIỀU PHỐI LẠI") { reassignIssue(issue, refresh) })
        }
        return card
    }

    private fun confirmIssueUpdate(issue: StockIssue, action: String, refresh: () -> Unit) {
        val isSkip = action == "NOT_FOUND"
        val firstMessage = if (isSkip) "Không tìm thấy SKU ${issue.sku}. Cho phép Picker SKIP?" else "Xác nhận SKU ${issue.sku} đã có hàng/châm bù?"
        AlertDialog.Builder(this).setTitle(if (isSkip) "CHO PHÉP SKIP" else "ĐÃ CÓ HÀNG")
            .setMessage(firstMessage).setNegativeButton("HỦY", null)
            .setPositiveButton("XÁC NHẬN") { _, _ ->
                if (isSkip) {
                    AlertDialog.Builder(this).setTitle("XÁC NHẬN LẦN 2")
                        .setMessage("Thao tác sẽ gửi cảnh báo bắt buộc ACK cho Picker. Cho phép SKIP SKU ${issue.sku}?")
                        .setNegativeButton("HỦY", null).setPositiveButton("CHO SKIP") { _, _ -> updateIssue(issue, action, refresh) }.show()
                } else updateIssue(issue, action, refresh)
            }.show()
    }

    private fun updateIssue(issue: StockIssue, action: String, refresh: () -> Unit) {
        lifecycleScope.launch {
            runCatching { app.repository.updateIssue(issue.id, action) }
                .onSuccess { toast("SKU ${issue.sku}: ${it.status.label}"); refresh() }
                .onFailure { toast(it.message ?: "Không cập nhật được SKU") }
        }
    }

    private fun reassignIssue(issue: StockIssue, refresh: () -> Unit) {
        lifecycleScope.launch {
            runCatching { app.repository.listUsers().filter { it.active && it.role in setOf(UserRole.INVENT, UserRole.ADMIN_INVENT) } }
                .onSuccess { users ->
                    if (users.isEmpty()) { toast("Không có Người báo hàng đang hoạt động"); return@onSuccess }
                    val labels = users.map { "${it.employeeCode} • ${it.fullName} • ${it.role.label}" }.toTypedArray()
                    AlertDialog.Builder(this@MainActivity).setTitle("Điều phối SKU ${issue.sku}")
                        .setItems(labels) { _, which -> askReassignReason(issue, users[which], refresh) }
                        .setNegativeButton("HỦY", null).show()
                }.onFailure { toast(it.message ?: "Không tải được nhân sự") }
        }
    }

    private fun askReassignReason(issue: StockIssue, target: UserProfile, refresh: () -> Unit) {
        val input = EditText(this).apply { hint = "Lý do điều phối (bắt buộc)"; setPadding(dp(14), dp(8), dp(14), dp(8)) }
        AlertDialog.Builder(this).setTitle("Chuyển cho ${target.fullName}")
            .setView(input).setNegativeButton("HỦY", null).setPositiveButton("ĐIỀU PHỐI") { _, _ ->
                val reason = input.text.toString().trim()
                if (reason.length < 3) { toast("Lý do cần ít nhất 3 ký tự"); return@setPositiveButton }
                lifecycleScope.launch {
                    runCatching { app.repository.reassignIssue(issue.id, target.id, reason) }
                        .onSuccess { toast("Đã điều phối SKU ${issue.sku} cho ${target.fullName}"); refresh() }
                        .onFailure { toast(it.message ?: "Không điều phối được") }
                }
            }.show()
    }

    private fun showPicker() {
        val content = page("PICKER / NGƯỜI LẤY HÀNG", SCREEN_PICKER)
        val input = AutoCompleteTextView(this).apply {
            hint = "Quét SKU hoặc nhập tên hàng"
            threshold = 1
            setSingleLine(true)
        }
        val selected = infoBox("Chưa chọn SKU")
        val stock = infoBox("Tồn snapshot: CHƯA XÁC ĐỊNH")
        val reportButton = button("BÁO THIẾU") { }
        reportButton.isEnabled = false
        val recent = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        var chosen: SkuItem? = null

        content.addView(input)
        content.addView(selected)
        content.addView(stock)
        content.addView(reportButton)
        content.addView(section("Báo gần đây của tôi"))
        content.addView(recent)
        addDiagnosticsButton(content)

        fun select(item: SkuItem) {
            chosen = item
            selected.text = "SKU ${item.sku}\n${item.productName}"
            reportButton.isEnabled = true
            input.setText("")
            lifecycleScope.launch {
                stock.text = "Đang lấy trạng thái tồn…"
                runCatching { app.repository.inventoryStatus(item.sku) }
                    .onSuccess { stock.text = pickerInventoryText(it) }
                    .onFailure { stock.text = "KHÔNG LẤY ĐƯỢC TỒN SNAPSHOT\nBạn vẫn được phép báo thiếu." }
            }
        }

        fun updateSuggestions(query: String) {
            searchJob?.cancel()
            searchJob = lifecycleScope.launch {
                delay(120)
                val local = withContext(Dispatchers.IO) { app.repository.searchSkus(query) }
                val items = if (local.isNotEmpty()) local else runCatching { app.repository.searchSkusOnline(query) }.getOrDefault(emptyList())
                input.setAdapter(ArrayAdapter(this@MainActivity, android.R.layout.simple_dropdown_item_1line, items))
                if (items.isNotEmpty()) input.showDropDown()
            }
        }
        input.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) { if (!s.isNullOrBlank()) updateSuggestions(s.toString()) }
            override fun afterTextChanged(s: Editable?) = Unit
        })
        input.setOnItemClickListener { parent, _, position, _ -> (parent.getItemAtPosition(position) as? SkuItem)?.let(::select) }
        reportButton.setOnClickListener {
            val item = chosen ?: return@setOnClickListener
            lifecycleScope.launch {
                reportButton.isEnabled = false
                runCatching { app.repository.reportShortage(item.sku) }
                    .onSuccess { result ->
                        toast(result.message)
                        chosen = null
                        selected.text = "Chưa chọn SKU"
                        stock.text = "Tồn snapshot: CHƯA XÁC ĐỊNH"
                        loadMyIssues(recent)
                        input.requestFocus()
                    }.onFailure { toast(it.message ?: "Không gửi được báo thiếu") }
                reportButton.isEnabled = chosen != null
            }
        }
        loadMyIssues(recent)
        input.requestFocus()
    }

    private fun pickerInventoryText(status: InventoryStatus): String {
        val label = when (status.stockStatus) {
            "AVAILABLE" -> "CÓ THỂ CÒN TỒN"
            "ZERO" -> "KHÔNG CÒN TỒN KHẢ DỤNG"
            "STALE" -> "DỮ LIỆU TỒN ĐÃ CŨ"
            else -> "CHƯA CÓ DỮ LIỆU TỒN"
        }
        val warning = if (status.freshnessStatus == "STALE") "\nKHÔNG DÙNG SỐ TỒN NÀY ĐỂ QUYẾT ĐỊNH." else ""
        return "$label\nSnapshot: ${status.snapshotCapturedAt?.let(::shortTime) ?: "—"}$warning"
    }

    private fun loadMyIssues(target: LinearLayout) {
        lifecycleScope.launch {
            runCatching { app.repository.loadMyIssues() }
                .onSuccess { issues ->
                    target.removeAllViews()
                    if (issues.isEmpty()) target.addView(infoBox("Chưa có báo thiếu."))
                    issues.take(50).forEach { issue -> target.addView(infoBox("${issue.status.label} • SKU ${issue.sku} • ${issue.reportCount} lượt • v${issue.issueVersion}\n${issue.productName}\n${shortTime(issue.reportedAt)}")) }
                }.onFailure { target.removeAllViews(); target.addView(infoBox("Không tải được lịch sử: ${it.message}")) }
        }
    }

    private fun showInventory() {
        val role = app.session.effectiveRole
        val content = page("TỒN BIN", SCREEN_INVENTORY)
        content.addView(infoBox("Database snapshot là nguồn hiện hành. Snapshot STALE/UNKNOWN không bao giờ được hiểu thành tồn bằng 0."))
        val input = EditText(this).apply { hint = "Nhập SKU"; setSingleLine(true) }
        val result = infoBox("Nhập SKU để tra tồn snapshot.")
        content.addView(input)
        content.addView(button("TRA TỒN") {
            val sku = input.text.toString().trim()
            if (sku.isNotBlank()) lifecycleScope.launch {
                result.text = "Đang tải…"
                runCatching { app.repository.inventoryStatus(sku) }
                    .onSuccess { result.text = inventoryText(it, role) }
                    .onFailure { result.text = "Lỗi: ${it.message}" }
            }
        })
        content.addView(result)
        if (role in setOf(UserRole.ADMIN, UserRole.ADMIN_INVENT)) {
            content.addView(section("Đồng bộ / recovery"))
            content.addView(button("ĐỒNG BỘ TỪ SUPRA") { startSupraSync() })
            content.addView(infoBox("Supra chỉ được bật sau read-only POC xác minh JSON/pagination/parity. Nếu contract chưa VERIFIED, server sẽ fail-closed và giữ snapshot cũ."))
            content.addView(button("IMPORT TỒN BIN XLSX • RECOVERY") { chooseInventory.launch(XLSX_MIME) })
        }
        addDiagnosticsButton(content)
    }

    private fun showInventoryForSku(sku: String) {
        lifecycleScope.launch {
            runCatching { app.repository.inventoryStatus(sku) }
                .onSuccess { AlertDialog.Builder(this@MainActivity).setTitle("Tồn SKU $sku").setMessage(inventoryText(it, app.session.effectiveRole)).setPositiveButton("ĐÓNG", null).show() }
                .onFailure { toast(it.message ?: "Không lấy được tồn") }
        }
    }

    private fun inventoryText(status: InventoryStatus, role: UserRole): String {
        val base = "Freshness: ${status.freshnessStatus}\nTrạng thái: ${status.stockStatus}\nSnapshot: ${status.snapshotCapturedAt?.let(::shortTime) ?: "—"}"
        if (!role.canSeeExactInventory || status.availableQty == null) return base
        return "$base\nTồn Bin pickable: ${status.pickableBinQty}\nTồn chờ Xuất: ${status.pendingOutQty}\nKhả dụng: ${status.availableQty}"
    }

    private fun startSupraSync() {
        lifecycleScope.launch {
            runCatching { app.api.invoke("inventory-sync-start", JSONObject().put("client_request_id", UUID.randomUUID().toString())) }
                .onSuccess { toast("Job Supra: ${it.optString("state", "đã tạo")}") }
                .onFailure { toast(it.message ?: "Không khởi tạo được job Supra") }
        }
    }

    private fun showReports() {
        val content = page("BÁO CÁO VẬN HÀNH", SCREEN_REPORTS)
        val body = infoBox("Đang tải…")
        content.addView(body)
        lifecycleScope.launch {
            runCatching { app.repository.reportsSummary() }
                .onSuccess { r ->
                    val statuses = r.optJSONObject("by_status") ?: JSONObject()
                    val statusText = statuses.keys().asSequence().joinToString("\n") { key -> "${IssueStatus.from(key).label}: ${statuses.optInt(key)}" }
                    body.text = "30 ngày\nĐợt báo thiếu: ${r.optInt("issues")}\nTổng lượt báo: ${r.optInt("reports")}\nClaim median: ${r.opt("median_claim_minutes") ?: "—"} phút\nXử lý median: ${r.opt("median_resolution_minutes") ?: "—"} phút\nXử lý P95: ${r.opt("p95_resolution_minutes") ?: "—"} phút\nTái phát: ${r.optInt("recurrent_episodes")}\n\n$statusText"
                }.onFailure { body.text = "Lỗi: ${it.message}" }
        }
    }

    private fun showOperationalSla() {
        val content = page("SLA VẬN HÀNH", SCREEN_CONFIG)
        val ack = numberInput("Nhắc nhận xử lý (phút)")
        val reminder = numberInput("Chu kỳ nhắc (phút)")
        val replenish = numberInput("Quá thời gian xử lý (phút)")
        val pickerAck = numberInput("Nhắc Picker ACK (phút)")
        listOf(ack.first, reminder.first, replenish.first, pickerAck.first).forEach(content::addView)
        val status = infoBox("Không auto-SKIP. Hết SLA chỉ nhắc/escalate.")
        content.addView(button("LƯU SLA VẬN HÀNH") {
            lifecycleScope.launch {
                runCatching {
                    app.repository.saveOperationalConfig(
                        OperationalConfig(ack.second.int(), reminder.second.int(), replenish.second.int(), pickerAck.second.int())
                    )
                }.onSuccess { toast("Đã lưu SLA vận hành") }.onFailure { toast(it.message ?: "Không lưu được SLA") }
            }
        })
        content.addView(status)
        lifecycleScope.launch {
            runCatching { app.repository.getOperationalConfig() }.onSuccess {
                ack.second.setText(it.acknowledgeMinutes.toString()); reminder.second.setText(it.reminderMinutes.toString())
                replenish.second.setText(it.replenishMinutes.toString()); pickerAck.second.setText(it.pickerAckReminderMinutes.toString())
            }.onFailure { status.text = "Lỗi: ${it.message}" }
        }
    }

    private fun showConfig() {
        val content = page("CẤU HÌNH HỆ THỐNG", SCREEN_CONFIG)
        val ack = numberInput("Nhắc nhận xử lý (phút)")
        val reminder = numberInput("Chu kỳ nhắc (phút)")
        val replenish = numberInput("Quá thời gian xử lý (phút)")
        val pickerAck = numberInput("Nhắc Picker ACK (phút)")
        val retention = numberInput("Retention nghiệp vụ (ngày)")
        val logRetention = numberInput("Retention log (ngày)")
        val fresh = numberInput("Tồn FRESH (phút)")
        val stale = numberInput("Tồn STALE sau (phút)")
        val interval = numberInput("Chu kỳ sync tồn (phút)")
        val start = numberInput("Giờ vận hành bắt đầu (0-23)")
        val end = numberInput("Giờ vận hành kết thúc (0-23)")
        val all = listOf(ack, reminder, replenish, pickerAck, retention, logRetention, fresh, stale, interval, start, end)
        all.forEach { content.addView(it.first) }
        val auto = CheckBox(this).apply { text = "Bật lịch tự động tồn bin khi kết nối Supra VERIFIED" }
        content.addView(auto)
        val status = infoBox("Đang tải cấu hình…")
        content.addView(button("LƯU CẤU HÌNH HỆ THỐNG") {
            lifecycleScope.launch {
                runCatching {
                    app.repository.saveConfig(
                        AppConfig(
                            acknowledgeMinutes = ack.second.int(), reminderMinutes = reminder.second.int(), replenishMinutes = replenish.second.int(),
                            pickerAckReminderMinutes = pickerAck.second.int(), diagnosticLogRetentionDays = logRetention.second.int(), retentionDays = retention.second.int(),
                            inventoryAutoSyncEnabled = auto.isChecked, inventorySyncIntervalMinutes = interval.second.int(), inventoryOperatingStartHour = start.second.int(),
                            inventoryOperatingEndHour = end.second.int(), inventoryFreshMinutes = fresh.second.int(), inventoryStaleMinutes = stale.second.int()
                        )
                    )
                }.onSuccess { toast("Đã lưu cấu hình hệ thống") }.onFailure { toast(it.message ?: "Không lưu được cấu hình") }
            }
        })
        content.addView(status)
        lifecycleScope.launch {
            runCatching { app.repository.getConfig() }.onSuccess { c ->
                ack.second.setText(c.acknowledgeMinutes.toString()); reminder.second.setText(c.reminderMinutes.toString()); replenish.second.setText(c.replenishMinutes.toString())
                pickerAck.second.setText(c.pickerAckReminderMinutes.toString()); retention.second.setText(c.retentionDays.toString()); logRetention.second.setText(c.diagnosticLogRetentionDays.toString())
                fresh.second.setText(c.inventoryFreshMinutes.toString()); stale.second.setText(c.inventoryStaleMinutes.toString()); interval.second.setText(c.inventorySyncIntervalMinutes.toString())
                start.second.setText(c.inventoryOperatingStartHour.toString()); end.second.setText(c.inventoryOperatingEndHour.toString()); auto.isChecked = c.inventoryAutoSyncEnabled
                status.text = "Không auto-SKIP. Credential Supra không được lưu/hiển thị trong APK."
            }.onFailure { status.text = "Lỗi: ${it.message}" }
        }
    }

    private fun showUsers() {
        val content = page("NHÂN SỰ", SCREEN_USERS)
        val list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        content.addView(button("LÀM MỚI") { showUsers() })
        content.addView(button("IMPORT NHÂN SỰ.XLSX") { chooseUsers.launch(XLSX_MIME) })
        content.addView(list)
        lifecycleScope.launch {
            runCatching { app.repository.listUsers() }.onSuccess { users ->
                if (users.isEmpty()) list.addView(infoBox("Không có nhân sự trong phạm vi quyền."))
                users.forEach { user ->
                    val row = LinearLayout(this@MainActivity).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(10), dp(8), dp(10), dp(8)); setBackgroundResource(R.drawable.bg_card) }
                    row.addView(text("${user.employeeCode} • ${user.fullName}", 16, true))
                    row.addView(text("${user.role.label} • ${if (user.active) "HOẠT ĐỘNG" else "ĐÃ KHÓA"}${if (user.contractor.isNotBlank()) " • ${user.contractor}" else ""}", 12, false))
                    row.addView(button("CHỈNH SỬA") { editUser(user) { showUsers() } })
                    list.addView(row, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { setMargins(0, dp(4), 0, dp(4)) })
                }
            }.onFailure { list.addView(infoBox("Lỗi: ${it.message}")) }
        }
    }

    private fun editUser(user: UserProfile, refresh: () -> Unit) {
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16), 0, dp(16), 0) }
        val name = EditText(this).apply { hint = "Họ tên"; setText(user.fullName) }
        val contractor = EditText(this).apply { hint = "Nhà thầu"; setText(user.contractor) }
        val password = EditText(this).apply { hint = "Mật khẩu mới (để trống nếu giữ)"; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD }
        val active = CheckBox(this).apply { text = "Hoạt động"; isChecked = user.active; isEnabled = user.role != UserRole.ADMIN }
        val allowedRoles = when {
            user.role == UserRole.ADMIN -> listOf(UserRole.ADMIN)
            app.session.effectiveRole == UserRole.ADMIN -> listOf(UserRole.ADMIN_INVENT, UserRole.INVENT, UserRole.PICKER)
            else -> listOf(UserRole.INVENT, UserRole.PICKER)
        }
        val roleView = AutoCompleteTextView(this).apply {
            hint = "Vai trò"; threshold = 0
            setAdapter(ArrayAdapter(this@MainActivity, android.R.layout.simple_dropdown_item_1line, allowedRoles.map { it.label }))
            setText(user.role.label, false)
        }
        listOf(name, contractor, roleView, active, password).forEach(root::addView)
        AlertDialog.Builder(this).setTitle("${user.employeeCode} • ${user.fullName}").setView(root)
            .setNegativeButton("HỦY", null).setPositiveButton("LƯU") { _, _ ->
                val role = allowedRoles.firstOrNull { it.label == roleView.text.toString() } ?: user.role
                lifecycleScope.launch {
                    runCatching { app.repository.updateUser(user, user.employeeCode, name.text.toString().trim(), contractor.text.toString().trim(), role, active.isChecked, password.text.toString()) }
                        .onSuccess { toast("Đã cập nhật ${it.employeeCode}"); refresh() }
                        .onFailure { toast(it.message ?: "Không cập nhật được") }
                }
            }.show()
    }

    private suspend fun checkPendingAlerts() {
        if (!app.session.isLoggedIn || app.session.effectiveRole != UserRole.PICKER) return
        runCatching { app.repository.pendingAlerts() }.onSuccess { alerts ->
            val alert = alerts.firstOrNull() ?: return@onSuccess
            runCatching { app.repository.markAlertReceived(alert.eventId) }
            val dialog = AlertDialog.Builder(this@MainActivity)
                .setTitle(alert.title.ifBlank { alert.status.label })
                .setMessage("${alert.message}\n\nServer v${alert.issueVersion}")
                .setCancelable(false)
                .setPositiveButton("ĐÃ HIỂU") { _, _ -> lifecycleScope.launch { app.repository.acknowledgeAlert(alert.eventId) } }
                .create()
            dialog.setOnShowListener { lifecycleScope.launch { runCatching { app.repository.markAlertDisplayed(alert.eventId) } } }
            if (!isFinishing && !isDestroyed) dialog.show()
        }.onFailure { app.diagnostics.warn("pending_alert_check_failed", mapOf("error" to it.message.orEmpty())) }
    }

    private fun syncSheet() {
        lifecycleScope.launch {
            runCatching { app.repository.syncGoogleSheet() }
                .onSuccess { toast("Đã xuất ${it.optInt("exported")} • còn ${it.optInt("remaining")} sự kiện") }
                .onFailure { toast(it.message ?: "Không đồng bộ được Google Sheet") }
        }
    }

    private fun addDiagnosticsButton(content: LinearLayout) {
        content.addView(button("GỬI LOG CHẨN ĐOÁN") {
            lifecycleScope.launch {
                runCatching { app.repository.sendDiagnosticLog() }
                    .onSuccess { toast(if (it.optBoolean("uploaded")) "Đã gửi log an toàn" else it.optString("message", "Chưa có log")) }
                    .onFailure { toast(it.message ?: "Không gửi được log") }
            }
        })
    }

    private fun importSkuFile(uri: Uri) {
        lifecycleScope.launch {
            toast("Đang đọc file SKU…")
            runCatching {
                val items = withContext(Dispatchers.IO) { XlsxImporter(contentResolver).parseSkuFile(uri) }
                var imported = 0
                items.chunked(1000).forEach { batch -> app.repository.importSkus(batch); imported += batch.size }
                imported
            }.onSuccess { toast("Hoàn tất $it SKU") }.onFailure { toast("Lỗi: ${it.message}") }
        }
    }

    private fun importUserFile(uri: Uri) {
        lifecycleScope.launch {
            toast("Đang đọc file nhân sự…")
            runCatching {
                val items = withContext(Dispatchers.IO) { XlsxImporter(contentResolver).parseUserFile(uri) }
                var imported = 0
                items.chunked(200).forEach { batch ->
                    val result = app.repository.importUsers(batch)
                    if (result.optInt("failed", 0) > 0) error(result.optJSONArray("errors")?.optString(0) ?: "Dữ liệu nhân sự lỗi")
                    imported += batch.size
                }
                imported
            }.onSuccess { toast("Hoàn tất $it nhân sự") }.onFailure { toast("Lỗi: ${it.message}") }
        }
    }

    private fun importInventoryFile(uri: Uri) {
        lifecycleScope.launch {
            toast("Đang đọc file Tồn Bin recovery…")
            runCatching {
                val items = withContext(Dispatchers.IO) { XlsxImporter(contentResolver).parseInventoryFile(uri) }
                val start = app.api.invoke("inventory-recovery-start", JSONObject().put("client_request_id", UUID.randomUUID().toString()))
                if (start.optBoolean("existing_active_job", false)) error("Đang có job Tồn Bin khác chạy; không ghi đè staging của job đó")
                val jobId = start.getJSONObject("job").getString("id")
                items.chunked(500).forEachIndexed { batchIndex, batch ->
                    app.api.invoke(
                        "inventory-recovery-stage",
                        JSONObject().put("job_id", jobId).put("batch_index", batchIndex).put("items", batch.toJson())
                    )
                }
                val result = app.api.invoke(
                    "inventory-recovery-finalize",
                    JSONObject().put("job_id", jobId).put("source_captured_at", Instant.now().toString())
                )
                "${items.size} dòng • ${result.optString("state")}" 
            }.onSuccess { toast("Tồn Bin: $it") }.onFailure { toast("Lỗi: ${it.message}") }
        }
    }

    private fun List<InventoryImportRow>.toJson(): JSONArray = JSONArray().also { array ->
        forEach { item ->
            array.put(
                JSONObject().put("row_key", item.rowKey).put("sku", item.sku).put("bin_code", item.binCode)
                    .put("storage_type", item.storageType).put("is_pickable", item.isPickable)
                    .put("bin_qty", item.binQty).put("pending_out_qty", item.pendingOutQty)
            )
        }
    }

    private fun writeTemplate(uri: Uri) {
        runCatching {
            contentResolver.openOutputStream(uri)?.use { output -> resources.openRawResource(R.raw.mau_nhan_su_bao_hang_1291).use { it.copyTo(output) } }
                ?: error("Không ghi được file")
        }.onSuccess { toast("Đã lưu file nhân sự mẫu") }.onFailure { toast(it.message ?: "Không lưu được") }
    }

    private fun numberInput(label: String): Pair<LinearLayout, EditText> {
        val input = EditText(this).apply { inputType = InputType.TYPE_CLASS_NUMBER; setSingleLine(true) }
        val wrapper = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(text(label, 13, true))
            addView(input)
            setPadding(0, dp(5), 0, dp(5))
        }
        return wrapper to input
    }

    private fun EditText.int(): Int = text.toString().toIntOrNull() ?: 0

    private fun button(label: String, action: () -> Unit): Button = Button(this).apply {
        text = label
        setOnClickListener { action() }
        isAllCaps = false
        setTypeface(typeface, Typeface.BOLD)
        setPadding(dp(8), 0, dp(8), 0)
    }

    private fun text(value: String, size: Int, bold: Boolean): TextView = TextView(this).apply {
        text = value
        textSize = size.toFloat()
        if (bold) setTypeface(typeface, Typeface.BOLD)
        setTextColor(getColor(R.color.navy_900))
    }

    private fun section(value: String): TextView = text(value, 16, true).apply { setPadding(0, dp(18), 0, dp(6)) }

    private fun infoBox(value: String): TextView = text(value, 14, false).apply {
        setPadding(dp(12), dp(10), dp(12), dp(10))
        setBackgroundResource(R.drawable.bg_card)
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { setMargins(0, dp(4), 0, dp(4)) }
    }

    private fun shortTime(iso: String): String = iso.replace('T', ' ').take(16)
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private fun toast(message: String) = Toast.makeText(this, message, Toast.LENGTH_LONG).show()

    companion object {
        private const val XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        private const val SCREEN_MENU = "menu"
        private const val SCREEN_INVENT = "invent"
        private const val SCREEN_PICKER = "picker"
        private const val SCREEN_INVENTORY = "inventory"
        private const val SCREEN_REPORTS = "reports"
        private const val SCREEN_CONFIG = "config"
        private const val SCREEN_USERS = "users"
    }
}
