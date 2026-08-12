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
import androidx.activity.OnBackPressedCallback
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
            onCatalogChanged = {
                lifecycleScope.launch(Dispatchers.IO) {
                    runCatching { app.repository.syncCatalog() }
                    runOnUiThread { if (currentScreen == SCREEN_CATALOG) showCatalog() }
                }
            },
            onStaffChanged = {
                lifecycleScope.launch {
                    runCatching { app.repository.refreshProfile() }
                    runOnUiThread { if (currentScreen == SCREEN_USERS) showUsers() }
                }
            },
            onStatus = { app.diagnostics.info("realtime_status", mapOf("status" to it.name)) }
        )
    }

    private val chooseSku = registerForActivityResult(ActivityResultContracts.GetContent()) { uri -> uri?.let(::importSkuFile) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!app.session.isLoggedIn) {
            startActivity(Intent(this, LoginActivity::class.java)); finish(); return
        }
        setContentView(R.layout.activity_main)
        container = findViewById(R.id.contentContainer)
        findViewById<TextView>(R.id.btnBack).setOnClickListener { navigateBack() }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { if (isRoleRoot()) finish() else renderForRole() }
        })
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
        updateBackButton()
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
        content.addView(infoBox("Quản trị vận hành Báo hàng 1291. Tồn Bin chỉ được dùng làm file nguồn SKU / tên sản phẩm; không sử dụng phiên hoặc credential Supra."))
        content.addView(button("SỰ KIỆN / ĐIỀU PHỐI") { showInventBoard() })
        content.addView(button("DANH MỤC SKU / TÊN HÀNG") { showCatalog() })
        content.addView(button("BÁO CÁO VẬN HÀNH") { showReports() })
        content.addView(button("NHÂN SỰ & QUYỀN") { showUsers() })
        content.addView(button("MỐC THỜI GIAN VẬN HÀNH") { showOperationalSla() })
        content.addView(button("HỆ THỐNG & DUNG LƯỢNG") { showServiceMetrics() })
        content.addView(button("CẤU HÌNH HỆ THỐNG") { showConfig() })
        content.addView(button("ĐỒNG BỘ GOOGLE SHEET BÁO CÁO") { syncSheet() })
        addDiagnosticsButton(content)
        content.addView(section("Kiểm thử quyền"))
        content.addView(button("TEST • ADMIN EVENT") { enterTestRole(UserRole.ADMIN_INVENT) })
        content.addView(button("TEST • NGƯỜI BÁO HÀNG") { enterTestRole(UserRole.INVENT) })
        content.addView(button("TEST • PICKER") { enterTestRole(UserRole.PICKER) })
    }    private fun showAdminEvent() {
        val content = page("ADMIN EVENT", SCREEN_MENU)
        content.addView(button("SỰ KIỆN / ĐIỀU PHỐI") { showInventBoard() })
        content.addView(button("DANH MỤC SKU / TÊN HÀNG") { showCatalog() })
        content.addView(button("BÁO CÁO VẬN HÀNH") { showReports() })
        content.addView(button("NHÂN SỰ") { showUsers() })
        content.addView(button("MỐC THỜI GIAN VẬN HÀNH") { showOperationalSla() })
        content.addView(button("HỆ THỐNG & DUNG LƯỢNG") { showServiceMetrics() })
        addDiagnosticsButton(content)
    }    private fun enterTestRole(role: UserRole) {
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
        content.addView(infoBox("Quét hoặc tìm theo SKU / tên sản phẩm. Ứng dụng chỉ bật cảnh báo nổi bật khi ĐÃ CÓ HÀNG hoặc được CHO PHÉP SKIP."))
        val input = AutoCompleteTextView(this).apply { hint = "Quét SKU hoặc nhập tên sản phẩm"; threshold = 1; setSingleLine(true) }
        val selected = infoBox("Chưa chọn SKU")
        val reportButton = button("BÁO THIẾU") {}
        reportButton.isEnabled = false
        val recent = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        var chosen: SkuItem? = null
        content.addView(input); content.addView(selected); content.addView(reportButton)
        content.addView(section("Giao dịch gần đây của tôi")); content.addView(recent); addDiagnosticsButton(content)
        fun select(item: SkuItem) { chosen = item; selected.text = "SKU ${item.sku}\n${item.productName}"; reportButton.isEnabled = true; input.setText("") }
        fun suggestions(query: String) {
            searchJob?.cancel(); searchJob = lifecycleScope.launch {
                delay(120)
                val local = withContext(Dispatchers.IO) { app.repository.searchSkus(query) }
                val items = if (local.isNotEmpty()) local else runCatching { app.repository.searchSkusOnline(query) }.getOrDefault(emptyList())
                input.setAdapter(ArrayAdapter(this@MainActivity, android.R.layout.simple_dropdown_item_1line, items)); if (items.isNotEmpty()) input.showDropDown()
            }
        }
        input.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(v: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(v: CharSequence?, start: Int, before: Int, count: Int) { if (!v.isNullOrBlank()) suggestions(v.toString()) }
            override fun afterTextChanged(v: Editable?) = Unit
        })
        input.setOnItemClickListener { parent, _, position, _ -> (parent.getItemAtPosition(position) as? SkuItem)?.let(::select) }
        reportButton.setOnClickListener {
            val item = chosen ?: return@setOnClickListener
            lifecycleScope.launch {
                reportButton.isEnabled = false
                runCatching { app.repository.reportShortage(item.sku) }
                    .onSuccess { toast(it.message); chosen = null; selected.text = "Chưa chọn SKU"; loadMyIssues(recent); input.requestFocus() }
                    .onFailure { toast(it.message ?: "Không gửi được báo thiếu") }
                reportButton.isEnabled = chosen != null
            }
        }
        loadMyIssues(recent); input.requestFocus()
    }    private fun loadMyIssues(target: LinearLayout) {
        lifecycleScope.launch {
            runCatching { app.repository.loadMyIssues() }
                .onSuccess { issues ->
                    target.removeAllViews()
                    if (issues.isEmpty()) target.addView(infoBox("Chưa có báo thiếu."))
                    issues.take(50).forEach { issue -> target.addView(infoBox("${issue.status.label} • SKU ${issue.sku} • ${issue.reportCount} lượt • v${issue.issueVersion}\n${issue.productName}\n${shortTime(issue.reportedAt)}")) }
                }.onFailure { target.removeAllViews(); target.addView(infoBox("Không tải được lịch sử: ${it.message}")) }
        }
    }

    private fun showCatalog() {
        val content = page("DANH MỤC SKU / TÊN HÀNG", SCREEN_CATALOG)
        content.addView(infoBox("File Tồn Bin chỉ lấy SKU và Tên SKU / Tên sản phẩm. Không lưu số lượng tồn, bin, chờ xuất hoặc vị trí."))
        content.addView(infoBox("SKU đang lưu trên máy: ${app.repository.skuCount()}"))
        if (app.session.effectiveRole in setOf(UserRole.ADMIN, UserRole.ADMIN_INVENT)) {
            content.addView(button("CẬP NHẬT TỪ FILE TỒN BIN XLSX") { chooseSku.launch(XLSX_MIME) })
        }
        val input = EditText(this).apply { hint = "Tra SKU hoặc tên sản phẩm"; setSingleLine(true) }
        val result = infoBox("Nhập từ khóa để tra cứu.")
        content.addView(input); content.addView(result)
        input.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(v: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun afterTextChanged(v: Editable?) = Unit
            override fun onTextChanged(v: CharSequence?, start: Int, before: Int, count: Int) {
                searchJob?.cancel()
                if (v.isNullOrBlank()) { result.text = "Nhập từ khóa để tra cứu."; return }
                searchJob = lifecycleScope.launch {
                    delay(120)
                    val items = withContext(Dispatchers.IO) { app.repository.searchSkus(v.toString()) }
                    result.text = if (items.isEmpty()) "Không tìm thấy SKU phù hợp." else items.take(20).joinToString("\n") { "${it.sku} • ${it.productName}" }
                }
            }
        })
    }

    private fun showReports() {
        val content = page("BÁO CÁO VẬN HÀNH KHO", SCREEN_REPORTS)
        val body = infoBox("Đang tổng hợp dữ liệu vận hành…")
        content.addView(body)
        lifecycleScope.launch {
            runCatching { app.repository.reportsSummary() }.onSuccess { report ->
                val day = report.optJSONObject("last_24h") ?: JSONObject()
                val top = report.optJSONArray("top_skus") ?: JSONArray()
                val topLines = buildString {
                    for (i in 0 until minOf(10, top.length())) {
                        val item = top.getJSONObject(i)
                        append("\n${i + 1}. ${item.optString("sku")} • ${item.optString("product_name")} • ${item.optInt("reports")} lượt")
                    }
                }
                body.text = "TỔNG QUAN 24 GIỜ\n" +
                    "Lượt báo: ${day.optInt("reports")} • Ticket: ${day.optInt("issues")} • Hoàn tất: ${day.optInt("resolved")}\n" +
                    "Đã có hàng/châm bù: ${day.optInt("available")} • Cho SKIP: ${day.optInt("skipped")}\n\n" +
                    "CHẤT LƯỢNG 30 NGÀY\n" +
                    "Đang mở: ${report.optInt("active_now")} • Quá mốc phản hồi: ${report.optInt("overdue_now")}\n" +
                    "Trung vị nhận xử lý: ${report.opt("median_claim_minutes") ?: "—"} phút • P95: ${report.opt("p95_claim_minutes") ?: "—"} phút\n" +
                    "Trung vị hoàn tất: ${report.opt("median_resolution_minutes") ?: "—"} phút • P95: ${report.opt("p95_resolution_minutes") ?: "—"} phút\n" +
                    "Tái phát: ${report.optInt("recurrent_episodes")} • Auto SKIP: ${report.optInt("auto_skip_count_30d")}\n\n" +
                    "SKU PHÁT SINH NHIỀU$topLines"
            }.onFailure { body.text = "Không tải được báo cáo: ${it.message}" }
        }
    }    private fun showOperationalSla() {
        val content = page("MỐC THỜI GIAN VẬN HÀNH", SCREEN_CONFIG)
        val ack = numberInput("Thời gian nhận xử lý (phút)")
        val reminder = numberInput("Chu kỳ nhắc xử lý (phút)")
        val replenish = numberInput("Thời gian châm hàng (phút)")
        val pickerAck = numberInput("Nhắc Picker xác nhận (phút)")
        val autoAfter = numberInput("Mốc tự động cho phép SKIP (phút)")
        val auto = CheckBox(this).apply { text = "Bật tự động cho phép SKIP khi quá mốc" }
        listOf(ack.first, reminder.first, replenish.first, pickerAck.first).forEach(content::addView)
        content.addView(infoBox("Thời gian nhận: từ lúc Picker báo đến khi có người nhận. Chu kỳ nhắc: khoảng cách nhắc ticket còn mở. Thời gian châm: mốc theo dõi sau khi nhận. Nhắc Picker chỉ áp dụng cảnh báo ĐÃ CÓ HÀNG hoặc SKIP."))
        content.addView(auto); content.addView(autoAfter.first); content.addView(infoBox("Ví dụ 120 phút = 2 giờ. Có thể tắt hoàn toàn auto SKIP."))
        content.addView(button("LƯU MỐC THỜI GIAN") {
            lifecycleScope.launch {
                runCatching { app.repository.saveOperationalConfig(OperationalConfig(ack.second.int(), reminder.second.int(), replenish.second.int(), pickerAck.second.int(), auto.isChecked, autoAfter.second.int())) }
                    .onSuccess { toast("Đã lưu mốc thời gian vận hành") }.onFailure { toast(it.message ?: "Không lưu được") }
            }
        })
        lifecycleScope.launch { runCatching { app.repository.getOperationalConfig() }.onSuccess { cfg ->
            ack.second.setText(cfg.acknowledgeMinutes.toString()); reminder.second.setText(cfg.reminderMinutes.toString()); replenish.second.setText(cfg.replenishMinutes.toString()); pickerAck.second.setText(cfg.pickerAckReminderMinutes.toString()); auto.isChecked = cfg.autoSkipEnabled; autoAfter.second.setText(cfg.autoSkipAfterMinutes.toString())
        }.onFailure { toast(it.message ?: "Không tải được cấu hình") } }
    }    private fun showConfig() {
        val content = page("CẤU HÌNH HỆ THỐNG", SCREEN_CONFIG)
        val retention = numberInput("Lưu lịch sử nghiệp vụ (ngày)")
        val logRetention = numberInput("Lưu log chẩn đoán (ngày)")
        val staffInterval = numberInput("Chu kỳ đồng bộ nhân sự (phút)")
        val autoAfter = numberInput("Mốc tự động SKIP (phút)")
        val staffAuto = CheckBox(this).apply { text = "Tự động đồng bộ DANH MỤC NHÂN SỰ" }
        val autoSkip = CheckBox(this).apply { text = "Bật tự động cho phép SKIP" }
        content.addView(retention.first); content.addView(infoBox("Ticket và audit được giữ theo chu kỳ kể cả khi nhân sự đã ngừng hoạt động."))
        content.addView(logRetention.first); content.addView(staffAuto); content.addView(staffInterval.first); content.addView(infoBox("Nguồn nhân sự: Site 1291 / Kho HY1. Khuyến nghị 60 phút để giảm network/quota."))
        content.addView(autoSkip); content.addView(autoAfter.first)
        content.addView(button("LƯU CẤU HÌNH HỆ THỐNG") {
            lifecycleScope.launch {
                runCatching {
                    val old = app.repository.getConfig()
                    app.repository.saveConfig(old.copy(retentionDays = retention.second.int(), diagnosticLogRetentionDays = logRetention.second.int(), staffAutoSyncEnabled = staffAuto.isChecked, staffSyncIntervalMinutes = staffInterval.second.int(), autoSkipEnabled = autoSkip.isChecked, autoSkipAfterMinutes = autoAfter.second.int()))
                }.onSuccess { toast("Đã lưu cấu hình hệ thống") }.onFailure { toast(it.message ?: "Không lưu được") }
            }
        })
        lifecycleScope.launch { runCatching { app.repository.getConfig() }.onSuccess { cfg ->
            retention.second.setText(cfg.retentionDays.toString()); logRetention.second.setText(cfg.diagnosticLogRetentionDays.toString()); staffAuto.isChecked = cfg.staffAutoSyncEnabled; staffInterval.second.setText(cfg.staffSyncIntervalMinutes.toString()); autoSkip.isChecked = cfg.autoSkipEnabled; autoAfter.second.setText(cfg.autoSkipAfterMinutes.toString())
        }.onFailure { toast(it.message ?: "Không tải được cấu hình") } }
    }    private fun showUsers() {
        val content = page("NHÂN SỰ & QUYỀN", SCREEN_USERS)
        val list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        content.addView(button("ĐỒNG BỘ DANH MỤC NHÂN SỰ NGAY") {
            lifecycleScope.launch { runCatching { app.api.invoke("staff-sync-now", JSONObject()) }.onSuccess { toast("Đồng bộ nhân sự: ${it.optString("status")}"); showUsers() }.onFailure { toast(it.message ?: "Không đồng bộ được") } }
        })
        content.addView(button("TẠO TÀI KHOẢN NGOÀI DANH SÁCH NGUỒN") { createExtraUser { showUsers() } })
        content.addView(infoBox("Nhân sự Google Sheet được quản lý từ nguồn. Nếu mất khỏi nguồn, tài khoản chỉ ngừng hoạt động; lịch sử nghiệp vụ vẫn giữ. User 6281280 được bảo vệ tuyệt đối."))
        content.addView(list)
        lifecycleScope.launch {
            runCatching { app.repository.listUsers() }.onSuccess { users ->
                if (users.isEmpty()) list.addView(infoBox("Không có nhân sự trong phạm vi quyền."))
                users.forEach { user ->
                    val row = LinearLayout(this@MainActivity).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(10), dp(8), dp(10), dp(8)); setBackgroundResource(R.drawable.bg_card) }
                    row.addView(text("${user.employeeCode} • ${user.fullName}${if (user.protectedAccount) " • BẢO VỆ" else ""}", 16, true))
                    row.addView(text("${user.role.label} • ${if (user.active) "HOẠT ĐỘNG" else "NGỪNG"} • ${if (user.sourceKind == "GSHEET") "GOOGLE SHEET" else "TẠO THÊM"}${if (user.sourcePosition.isNotBlank()) " • ${user.sourcePosition}" else ""}", 12, false))
                    if (!user.protectedAccount && user.sourceKind != "GSHEET" && (app.session.effectiveRole == UserRole.ADMIN || user.role == UserRole.PICKER)) {
                        row.addView(button("CHỈNH SỬA") { editUser(user) { showUsers() } })
                        row.addView(button("NGỪNG TÀI KHOẢN") { lifecycleScope.launch { runCatching { app.api.invoke("delete-user", JSONObject().put("id", user.id)) }.onSuccess { toast("Đã ngừng ${user.employeeCode}"); showUsers() }.onFailure { toast(it.message ?: "Không xử lý được") } } })
                    }
                    list.addView(row, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { setMargins(0, dp(4), 0, dp(4)) })
                }
            }.onFailure { list.addView(infoBox("Lỗi: ${it.message}")) }
        }
    }    private fun editUser(user: UserProfile, refresh: () -> Unit) {
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16), 0, dp(16), 0) }
        val name = EditText(this).apply { hint = "Họ tên"; setText(user.fullName) }
        val contractor = EditText(this).apply { hint = "Nhà thầu"; setText(user.contractor) }
        val password = EditText(this).apply { hint = "Mật khẩu mới (để trống nếu giữ)"; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD }
        val active = CheckBox(this).apply { text = "Hoạt động"; isChecked = user.active; isEnabled = user.role != UserRole.ADMIN }
        val allowedRoles = when {
            user.role == UserRole.ADMIN -> listOf(UserRole.ADMIN)
            app.session.effectiveRole == UserRole.ADMIN -> listOf(UserRole.ADMIN_INVENT, UserRole.INVENT, UserRole.PICKER)
            else -> listOf(UserRole.PICKER)
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

    private fun createExtraUser(refresh: () -> Unit) {
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16), 0, dp(16), 0) }
        val code = EditText(this).apply { hint = "Mã nhân viên" }
        val name = EditText(this).apply { hint = "Họ tên" }
        val contractor = EditText(this).apply { hint = "Nhà thầu" }
        val password = EditText(this).apply { hint = "Mật khẩu riêng (để trống dùng mặc định)"; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD }
        val roles = if (app.session.effectiveRole == UserRole.ADMIN) listOf(UserRole.ADMIN_INVENT, UserRole.INVENT, UserRole.PICKER) else listOf(UserRole.PICKER)
        val roleView = AutoCompleteTextView(this).apply { threshold = 0; setAdapter(ArrayAdapter(this@MainActivity, android.R.layout.simple_dropdown_item_1line, roles.map { it.label })); setText(roles.first().label, false) }
        listOf(code, name, contractor, roleView, password).forEach(root::addView)
        AlertDialog.Builder(this).setTitle("Tạo tài khoản ngoài nguồn").setView(root).setNegativeButton("HỦY", null).setPositiveButton("TẠO") { _, _ ->
            val selectedRole = roles.firstOrNull { it.label == roleView.text.toString() } ?: roles.first()
            lifecycleScope.launch {
                val row = vn.pickpack1291.baohang.data.ImportUserRow(code.text.toString().trim(), name.text.toString().trim(), contractor.text.toString().trim(), selectedRole, true, password.text.toString())
                runCatching { app.repository.importUsers(listOf(row)) }.onSuccess { result ->
                    if (result.optInt("failed") > 0) toast(result.optJSONArray("errors")?.optString(0) ?: "Không tạo được") else { toast("Đã tạo tài khoản"); refresh() }
                }.onFailure { toast(it.message ?: "Không tạo được") }
            }
        }.show()
    }

    private fun showServiceMetrics() {
        val content = page("HỆ THỐNG & DUNG LƯỢNG", SCREEN_SERVICES)
        val body = infoBox("Đang đọc số liệu hệ thống…")
        content.addView(body)
        lifecycleScope.launch {
            runCatching { app.api.invoke("service-metrics", JSONObject()) }.onSuccess { data ->
                val usage = data.optJSONObject("usage") ?: JSONObject(); val limits = data.optJSONObject("free_limits") ?: JSONObject()
                val dbBytes = usage.optLong("database_bytes"); val dbLimit = limits.optLong("database_bytes", 1L).coerceAtLeast(1L); val percent = dbBytes * 100.0 / dbLimit
                body.text = "FREE 0đ • KHÔNG TỰ BẬT BILLING\n\n" +
                    "Database: %.1f MB / %.0f MB (%.1f%%)\n".format(dbBytes / 1048576.0, dbLimit / 1048576.0, percent) +
                    "SKU hoạt động: ${usage.optInt("sku_active")}\nNhân sự hoạt động: ${usage.optInt("profiles_active")}\nTicket đang mở: ${usage.optInt("issues_active")}\n" +
                    "FCM token hoạt động: ${usage.optInt("active_device_tokens")}\nGoogle Sheet chờ: ${usage.optInt("sheet_pending")}\nLog chẩn đoán: %.2f MB".format(usage.optLong("diagnostic_log_bytes") / 1048576.0)
            }.onFailure { body.text = "Không đọc được số liệu hệ thống: ${it.message}" }
        }
    }

    private fun isRoleRoot(): Boolean = when (app.session.effectiveRole) {
        UserRole.ADMIN, UserRole.ADMIN_INVENT -> currentScreen == SCREEN_MENU
        UserRole.INVENT -> currentScreen == SCREEN_INVENT
        UserRole.PICKER -> currentScreen == SCREEN_PICKER
    }
    private fun updateBackButton() { findViewById<TextView>(R.id.btnBack)?.visibility = if (isRoleRoot()) View.GONE else View.VISIBLE }
    private fun navigateBack() { if (isRoleRoot()) finish() else renderForRole() }

    private suspend fun checkPendingAlerts() {
        if (!app.session.isLoggedIn || app.session.effectiveRole != UserRole.PICKER) return
        runCatching { app.repository.pendingAlerts() }.onSuccess { alerts ->
            val alert = alerts.firstOrNull { it.status in setOf(IssueStatus.AVAILABLE, IssueStatus.SKIP_ALLOWED) } ?: return@onSuccess
            runCatching { app.repository.markAlertReceived(alert.eventId) }
            val dialog = AlertDialog.Builder(this@MainActivity)
                .setTitle(alert.title.ifBlank { alert.status.label })
                .setMessage("${alert.message}\n\nServer v${alert.issueVersion}")
                .setCancelable(false)
                .setPositiveButton("ĐÃ XÁC NHẬN") { _, _ -> lifecycleScope.launch { app.repository.acknowledgeAlert(alert.eventId) } }
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
            toast("Đang đọc SKU và tên sản phẩm…")
            runCatching {
                val items = withContext(Dispatchers.IO) { XlsxImporter(contentResolver).parseSkuFile(uri) }
                app.repository.replaceCatalog(items, "Tồn Bin XLSX")
                items.size
            }.onSuccess { toast("Đã thay danh mục bằng $it SKU / tên sản phẩm"); showCatalog() }.onFailure { toast("Lỗi: ${it.message}") }
        }
    }    private fun numberInput(label: String): Pair<LinearLayout, EditText> {
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
        private const val SCREEN_CATALOG = "catalog"
        private const val SCREEN_SERVICES = "services"
        private const val SCREEN_REPORTS = "reports"
        private const val SCREEN_CONFIG = "config"
        private const val SCREEN_USERS = "users"
    }
}
