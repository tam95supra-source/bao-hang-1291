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
import java.net.HttpURLConnection
import java.net.URI
import java.nio.charset.StandardCharsets
import java.time.Instant

class MainActivity : AppCompatActivity() {
    private val app by lazy { application as BaoHangApplication }
    private lateinit var container: FrameLayout
    private var searchJob: Job? = null
    private var realtimeAuthJob: Job? = null
    private var currentScreen = ""
    private var inventSelectedTab = 0
    private var inventRefresh: (() -> Unit)? = null
    private var inventRenderSignature = ""
    private var activeAlertEventId: String? = null

    private enum class ButtonTone { PRIMARY, SECONDARY, SUCCESS, DANGER }

    private val realtime by lazy {
        RealtimeClient(
            diagnostics = app.diagnostics,
            onIssueChanged = {
                runOnUiThread {
                    when (currentScreen) {
                        SCREEN_INVENT -> inventRefresh?.invoke()
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
            onConfigChanged = {
                runOnUiThread {
                    when (currentScreen) {
                        SCREEN_SLA -> showOperationalSla()
                        SCREEN_CONFIG -> showConfig()
                    }
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
                .setNegativeButton("Hủy", null).setPositiveButton("Đăng xuất") { _, _ ->
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
        val mode = if (profile.role == UserRole.ADMIN && effective != UserRole.ADMIN) " • KIỂM THỬ ${effective.label}" else ""
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
        if (screen != SCREEN_INVENT) {
            inventRefresh = null
            inventRenderSignature = ""
        }
        container.removeAllViews()
        updateBackButton()
        val scroll = ScrollView(this).apply { isFillViewport = true }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(14), dp(14), dp(30))
        }
        scroll.addView(content, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        container.addView(scroll, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        content.addView(text(title, 23, true).apply { setPadding(0, 0, 0, dp(10)) })
        if (app.session.profile?.role == UserRole.ADMIN && app.session.adminTestRole != null) {
            content.addView(infoBox("Đang kiểm thử với quyền ${app.session.effectiveRole.label}. Mọi quyền API được giới hạn tương ứng."))
            content.addView(button("Thoát chế độ kiểm thử", ButtonTone.SECONDARY) {
                app.repository.setAdminTestRole(null)
                renderForRole()
            })
        }
        return content
    }

    private fun addMaintenanceActions(content: LinearLayout) {
        content.addView(section("Hỗ trợ hệ thống"))
        if (BuildConfig.UPDATE_MANIFEST_URL.isNotBlank()) {
            content.addView(button("Kiểm tra cập nhật ${BuildConfig.OTA_CHANNEL.uppercase()}", ButtonTone.SECONDARY) {
                AppUpdater(this, app.diagnostics).check(showUpToDate = true)
            })
        }
        addDiagnosticsButton(content)
    }

    private fun showAdmin() {
        val content = page("Quản trị hệ thống", SCREEN_MENU)
        content.addView(infoBox("Theo dõi vận hành, nhân sự, cấu hình và dung lượng của Báo hàng 1291."))
        content.addView(section("Vận hành"))
        content.addView(button("Xử lý báo hàng") { showInventBoard() })
        content.addView(button("Danh mục SKU & tên hàng") { showCatalog() })
        content.addView(button("Báo cáo vận hành") { showReports() })
        content.addView(section("Quản trị"))
        content.addView(button("Nhân sự & quyền") { showUsers() })
        content.addView(button("Tài khoản dự phòng") { showBackupAccounts() })
        content.addView(button("Mốc thời gian vận hành") { showOperationalSla() })
        content.addView(button("Cấu hình hệ thống") { showConfig() })
        content.addView(section("Hệ thống"))
        content.addView(button("Dung lượng & dịch vụ") { showServiceMetrics() })
        content.addView(button("Đồng bộ Google Sheet báo cáo", ButtonTone.SECONDARY) { syncSheet() })
        addMaintenanceActions(content)
        content.addView(section("Kiểm thử phân quyền"))
        content.addView(button("Admin Invent") { enterTestRole(UserRole.ADMIN_INVENT) })
        content.addView(button("Người báo hàng") { enterTestRole(UserRole.INVENT) })
        content.addView(button("Picker") { enterTestRole(UserRole.PICKER) })
    }

    private fun showAdminEvent() {
        val content = page("Điều phối sự kiện", SCREEN_MENU)
        content.addView(infoBox("Ưu tiên xử lý báo thiếu và điều phối nhân sự tại hiện trường."))
        content.addView(section("Vận hành"))
        content.addView(button("Xử lý báo hàng", ButtonTone.PRIMARY) { showInventBoard() })
        content.addView(button("Danh mục SKU & tên hàng") { showCatalog() })
        content.addView(button("Báo cáo vận hành") { showReports() })
        content.addView(section("Quản lý"))
        content.addView(button("Nhân sự") { showUsers() })
        content.addView(button("Mốc thời gian vận hành") { showOperationalSla() })
        content.addView(button("Dung lượng & dịch vụ") { showServiceMetrics() })
        addMaintenanceActions(content)
    }

    private fun enterTestRole(role: UserRole) {
        runCatching { app.repository.setAdminTestRole(role) }
            .onSuccess { renderForRole() }
            .onFailure { toast(it.message ?: "Không bật được chế độ kiểm thử") }
    }

    private fun showInventBoard() {
        val content = page("Xử lý báo hàng", SCREEN_INVENT)
        if (content.childCount > 0) content.removeViewAt(0)
        val titleRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        val title = text("Xử lý báo hàng", 23, true)
        val totalBadge = text("0 SKU", 14, true).apply {
            gravity = Gravity.CENTER
            setPadding(dp(11), dp(7), dp(11), dp(7))
            setBackgroundResource(R.drawable.bg_button_secondary)
        }
        titleRow.addView(title, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        titleRow.addView(totalBadge, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        content.addView(titleRow, 0)

        val status = text("Đang tải dữ liệu…", 13, false).apply { setTextColor(getColor(R.color.text_secondary)) }
        val tabs = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val boardContainer = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        content.addView(status)
        content.addView(tabs)
        content.addView(boardContainer)
        addDiagnosticsButton(content)

        var board: IssueBoard? = null
        inventRenderSignature = ""
        val tabButtons = mutableListOf<Button>()

        fun updateTabs() {
            tabButtons.forEachIndexed { index, tab ->
                val active = index == inventSelectedTab
                tab.setBackgroundResource(if (active) R.drawable.bg_button_primary else R.drawable.bg_button_secondary)
                tab.setTextColor(getColor(if (active) R.color.white else R.color.navy_900))
            }
        }

        fun draw(force: Boolean = false) {
            val data = board ?: return
            val list = when (inventSelectedTab) {
                1 -> data.claimed
                2 -> data.available
                3 -> data.skipped
                else -> data.open
            }
            totalBadge.text = "${data.open.size + data.claimed.size} SKU"
            status.text = when (inventSelectedTab) {
                1 -> "${list.size} SKU đang xử lý${if (app.session.effectiveRole == UserRole.INVENT) " của tôi" else ""}"
                2 -> "${list.size} SKU đã có hàng"
                3 -> "${list.size} SKU đã được cho phép bỏ qua"
                else -> "${list.size} SKU đang chờ xử lý"
            }
            updateTabs()

            val signature = buildString {
                append(inventSelectedTab).append('|')
                list.forEach { append(it.id).append(':').append(it.status.wire).append(':').append(it.reportCount).append(':').append(it.issueVersion).append(';') }
            }
            if (!force && signature == inventRenderSignature) return
            inventRenderSignature = signature

            val scroll = content.parent as? ScrollView
            val oldScrollY = scroll?.scrollY ?: 0
            boardContainer.removeAllViews()
            if (list.isEmpty()) boardContainer.addView(infoBox("Không có SKU trong nhóm này."))
            list.forEach { issue -> boardContainer.addView(issueCard(issue, inventSelectedTab) { inventRefresh?.invoke() }) }
            scroll?.post { scroll.scrollTo(0, oldScrollY) }
        }

        fun refreshBoard(initial: Boolean) {
            if (initial && board == null) status.text = "Đang tải dữ liệu…"
            lifecycleScope.launch {
                runCatching { app.repository.loadIssueBoard() }
                    .onSuccess {
                        board = it
                        draw(false)
                    }
                    .onFailure {
                        app.diagnostics.error("issue_board_load_failed", it)
                        if (board == null) status.text = "Không tải được dữ liệu: ${it.message}"
                    }
            }
        }

        val labels = listOf("Chờ xử lý", "Đang xử lý", "Đã có hàng", "Đã bỏ qua")
        labels.chunked(2).forEachIndexed { rowIndex, rowLabels ->
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
            rowLabels.forEachIndexed { columnIndex, label ->
                val index = rowIndex * 2 + columnIndex
                val tab = button(label) {
                    inventSelectedTab = index
                    inventRenderSignature = ""
                    draw(true)
                }
                tabButtons += tab
                row.addView(tab, LinearLayout.LayoutParams(0, dp(48), 1f).apply { setMargins(dp(2), dp(3), dp(2), dp(3)) })
            }
            tabs.addView(row, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }
        tabs.setPadding(0, dp(3), 0, dp(7))
        updateTabs()
        inventRefresh = { refreshBoard(false) }
        refreshBoard(true)
    }

    private fun loadInventBoard(status: TextView, onLoaded: (IssueBoard) -> Unit) {
        status.text = "Đang tải dữ liệu…"
        lifecycleScope.launch {
            runCatching { app.repository.loadIssueBoard() }
                .onSuccess(onLoaded)
                .onFailure { status.text = "Không tải được dữ liệu: ${it.message}"; app.diagnostics.error("issue_board_load_failed", it) }
        }
    }

    private fun issueCard(issue: StockIssue, bucket: Int, refresh: () -> Unit): View {
        val elevated = app.session.effectiveRole in setOf(UserRole.ADMIN, UserRole.ADMIN_INVENT)
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(13), dp(11), dp(13), dp(11))
            setBackgroundResource(R.drawable.bg_card)
        }
        card.layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { setMargins(0, dp(5), 0, dp(5)) }
        val recurrent = if (issue.recurrence30m) " • TÁI PHÁT ≤30 PHÚT" else ""
        card.addView(text("SKU ${issue.sku}", 18, true))
        card.addView(text(issue.productName, 14, false).apply { setPadding(0, dp(2), 0, dp(4)) })
        card.addView(text("${issue.status.label} • ${issue.reportCount} lượt • v${issue.issueVersion}$recurrent", 12, false).apply { setTextColor(getColor(R.color.text_secondary)) })
        card.addView(text("Báo lúc ${shortTime(issue.reportedAt)}${if (issue.assignedName.isNotBlank()) " • Xử lý: ${issue.assignedName}" else ""}", 12, false).apply { setTextColor(getColor(R.color.text_secondary)) })
        if (bucket == 0) {
            card.addView(button("Nhận xử lý", ButtonTone.PRIMARY) {
                lifecycleScope.launch {
                    runCatching { app.repository.claimIssue(issue.id) }
                        .onSuccess { toast("Đã nhận xử lý SKU ${issue.sku}"); refresh() }
                        .onFailure { toast(it.message ?: "Không nhận được SKU") }
                }
            })
            if (elevated) {
                val direct = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
                direct.addView(button("CÓ HÀNG", ButtonTone.SUCCESS) { confirmIssueUpdate(issue, "AVAILABLE", refresh) }, LinearLayout.LayoutParams(0, dp(50), 1f).apply { setMargins(0, dp(5), dp(2), 0) })
                direct.addView(button("SKIP HÀNG", ButtonTone.DANGER) { confirmIssueUpdate(issue, "NOT_FOUND", refresh) }, LinearLayout.LayoutParams(0, dp(50), 1f).apply { setMargins(dp(2), dp(5), 0, 0) })
                card.addView(direct)
            }
        } else if (bucket == 1) {
            val actions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            actions.addView(button("CÓ HÀNG", ButtonTone.SUCCESS) { confirmIssueUpdate(issue, "AVAILABLE", refresh) }, LinearLayout.LayoutParams(0, dp(50), 1f).apply { setMargins(0, dp(5), dp(2), 0) })
            actions.addView(button("SKIP HÀNG", ButtonTone.DANGER) { confirmIssueUpdate(issue, "NOT_FOUND", refresh) }, LinearLayout.LayoutParams(0, dp(50), 1f).apply { setMargins(dp(2), dp(5), 0, 0) })
            card.addView(actions)
            if (elevated) card.addView(button("Điều phối lại") { reassignIssue(issue, refresh) })
        } else if (bucket == 3) {
            val canRestore = elevated || (app.session.effectiveRole == UserRole.INVENT && issue.assignedId == app.session.profile?.id)
            if (canRestore) card.addView(button("Báo lại đã có hàng", ButtonTone.SUCCESS) { confirmRestoreSkipped(issue, refresh) })
        }
        return card
    }

    private fun confirmIssueUpdate(issue: StockIssue, action: String, refresh: () -> Unit) {
        val isSkip = action == "NOT_FOUND"
        val firstMessage = if (isSkip) "Không tìm thấy SKU ${issue.sku}. Cho phép Người lấy hàng bỏ qua SKU này?" else "Xác nhận SKU ${issue.sku} đã có hàng hoặc đã châm hàng?"
        AlertDialog.Builder(this).setTitle(if (isSkip) "Cho phép bỏ qua" else "Đã có hàng")
            .setMessage(firstMessage).setNegativeButton("Hủy", null)
            .setPositiveButton("Xác nhận") { _, _ ->
                if (isSkip) {
                    AlertDialog.Builder(this).setTitle("Xác nhận lần cuối")
                        .setMessage("Người lấy hàng sẽ nhận cảnh báo bắt buộc xác nhận trước khi tiếp tục. Cho phép bỏ qua SKU ${issue.sku}?")
                        .setNegativeButton("Hủy", null).setPositiveButton("Cho phép") { _, _ -> updateIssue(issue, action, refresh) }.show()
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

    private fun confirmRestoreSkipped(issue: StockIssue, refresh: () -> Unit) {
        AlertDialog.Builder(this)
            .setTitle("Báo lại đã có hàng")
            .setMessage("SKU ${issue.sku} trước đó đã được cho phép bỏ qua. Xác nhận hiện đã tìm thấy hàng?\n\nQuyền bỏ qua cũ sẽ bị hủy và toàn bộ Người lấy hàng đã báo SKU này sẽ nhận cảnh báo ĐÃ CÓ HÀNG.")
            .setNegativeButton("Hủy", null)
            .setPositiveButton("Xác nhận đã có hàng") { _, _ ->
                lifecycleScope.launch {
                    runCatching { restoreSkippedIssue(issue.id) }
                        .onSuccess { toast("SKU ${issue.sku} đã chuyển sang ĐÃ CÓ HÀNG"); refresh() }
                        .onFailure { toast(it.message ?: "Không báo lại được trạng thái đã có hàng") }
                }
            }.show()
    }

    private suspend fun restoreSkippedIssue(issueId: String): StockIssue = withContext(Dispatchers.IO) {
        app.api.refreshSessionIfNeeded()
        val baseUrl = BuildConfig.SUPABASE_URL.trimEnd('/')
        val connection = URI("$baseUrl/functions/v1/admin-ops/restore-skipped").toURL().openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 15_000
            connection.readTimeout = 30_000
            connection.doOutput = true
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            connection.setRequestProperty("apikey", BuildConfig.SUPABASE_ANON_KEY)
            connection.setRequestProperty("Authorization", "Bearer ${app.session.accessToken}")
            app.session.adminTestRole?.let { connection.setRequestProperty("x-admin-test-role", it.wire) }
            val payload = JSONObject().put("issue_id", issueId).put("reason", "Đã tìm thấy hàng sau khi cho phép bỏ qua")
            connection.outputStream.use { it.write(payload.toString().toByteArray(StandardCharsets.UTF_8)) }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val raw = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            val json = runCatching { JSONObject(raw) }.getOrElse { JSONObject().put("error", raw) }
            if (code !in 200..299) throw IllegalStateException(json.optString("error", "Lỗi máy chủ $code"))
            StockIssue.fromJson(json.getJSONObject("issue"))
        } finally { connection.disconnect() }
    }

    private fun reassignIssue(issue: StockIssue, refresh: () -> Unit) {
        lifecycleScope.launch {
            runCatching { app.repository.listUsers().filter { it.active && it.role in setOf(UserRole.INVENT, UserRole.ADMIN_INVENT) } }
                .onSuccess { users ->
                    if (users.isEmpty()) { toast("Không có Người báo hàng đang hoạt động"); return@onSuccess }
                    val labels = users.map { "${it.employeeCode} • ${it.fullName} • ${it.role.label}" }.toTypedArray()
                    AlertDialog.Builder(this@MainActivity).setTitle("Điều phối SKU ${issue.sku}")
                        .setItems(labels) { _, which -> askReassignReason(issue, users[which], refresh) }
                        .setNegativeButton("Hủy", null).show()
                }.onFailure { toast(it.message ?: "Không tải được nhân sự") }
        }
    }

    private fun askReassignReason(issue: StockIssue, target: UserProfile, refresh: () -> Unit) {
        val input = EditText(this).apply { hint = "Lý do điều phối (bắt buộc)" }
        AlertDialog.Builder(this).setTitle("Chuyển cho ${target.fullName}")
            .setView(input).setNegativeButton("Hủy", null).setPositiveButton("Điều phối") { _, _ ->
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
        val content = page("Báo thiếu hàng", SCREEN_PICKER)
        content.addView(text("Quét SKU hoặc nhập tên hàng", 14, true).apply { setPadding(0, 0, 0, dp(5)) })
        val input = AutoCompleteTextView(this).apply { hint = "Quét SKU / nhập tên sản phẩm"; threshold = 1; setSingleLine(true) }
        val selected = infoBox("Chưa chọn SKU")
        val reportButton = button("Báo thiếu", ButtonTone.DANGER) {}
        reportButton.isEnabled = false
        val recent = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        var chosen: SkuItem? = null
        content.addView(input)
        content.addView(selected)
        content.addView(reportButton, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(56)).apply { setMargins(0, dp(4), 0, dp(2)) })
        content.addView(section("Báo gần đây"))
        content.addView(recent)
        addDiagnosticsButton(content)
        fun select(item: SkuItem) {
            chosen = item
            selected.text = "SKU ${item.sku}\n${item.productName}"
            reportButton.isEnabled = true
            input.setText("")
        }
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
                    .onSuccess {
                        toast(it.message)
                        chosen = null
                        selected.text = "Chưa chọn SKU"
                        loadMyIssues(recent)
                        input.requestFocus()
                    }
                    .onFailure { toast(it.message ?: "Không gửi được báo thiếu") }
                reportButton.isEnabled = chosen != null
            }
        }
        loadMyIssues(recent); input.requestFocus()
    }

    private fun loadMyIssues(target: LinearLayout) {
        lifecycleScope.launch {
            runCatching { app.repository.loadMyIssues() }
                .onSuccess { issues ->
                    target.removeAllViews()
                    if (issues.isEmpty()) target.addView(infoBox("Chưa có báo thiếu."))
                    issues.take(50).forEach { issue ->
                        target.addView(infoBox("${issue.status.label} • SKU ${issue.sku}\n${issue.productName}\n${shortTime(issue.reportedAt)}"))
                    }
                }.onFailure { target.removeAllViews(); target.addView(infoBox("Không tải được lịch sử: ${it.message}")) }
        }
    }

    private fun showCatalog() {
        val content = page("Danh mục SKU & tên hàng", SCREEN_CATALOG)
        content.addView(infoBox("Danh mục chỉ lưu SKU và tên sản phẩm; không lưu số tồn, bin hoặc vị trí."))
        content.addView(text("${app.repository.skuCount()} SKU đang lưu trên thiết bị", 13, false).apply { setTextColor(getColor(R.color.text_secondary)) })
        if (app.session.effectiveRole in setOf(UserRole.ADMIN, UserRole.ADMIN_INVENT)) {
            content.addView(button("Cập nhật từ file Tồn Bin XLSX", ButtonTone.PRIMARY) { chooseSku.launch(XLSX_MIME) })
        }
        val input = EditText(this).apply { hint = "Tìm theo SKU hoặc tên sản phẩm"; setSingleLine(true) }
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
        val content = page("Báo cáo vận hành kho", SCREEN_REPORTS)
        val body = infoBox("Đang tổng hợp dữ liệu vận hành…")
        content.addView(body)
        lifecycleScope.launch {
            runCatching { app.repository.reportsSummary() }.onSuccess { report ->
                val day = report.optJSONObject("last_24h") ?: JSONObject()
                val top = report.optJSONArray("top_skus") ?: JSONArray()
                val topLines = buildString {
                    for (i in 0 until minOf(10, top.length())) {
                        val item = top.getJSONObject(i)
                        append("\n${i + 1}. ${item.optString("sku")} • ${item.optString("product_name")} • ${item.optInt("reports")} lượt báo")
                    }
                }
                body.text = "24 GIỜ GẦN NHẤT\n" +
                    "Lượt báo thiếu: ${day.optInt("reports")} • Đợt báo thiếu: ${day.optInt("issues")} • Đã xử lý xong: ${day.optInt("resolved")}\n" +
                    "Đã có hàng / đã châm hàng: ${day.optInt("available")} • Đã cho phép bỏ qua: ${day.optInt("skipped")}\n\n" +
                    "CHẤT LƯỢNG XỬ LÝ 30 NGÀY\n" +
                    "Đang cần xử lý: ${report.optInt("active_now")} • Quá thời gian tiếp nhận: ${report.optInt("overdue_now")}\n" +
                    "Thời gian nhận xử lý trung vị: ${report.opt("median_claim_minutes") ?: "—"} phút • 95% được nhận trong: ${report.opt("p95_claim_minutes") ?: "—"} phút\n" +
                    "Thời gian xử lý xong trung vị: ${report.opt("median_resolution_minutes") ?: "—"} phút • 95% xử lý xong trong: ${report.opt("p95_resolution_minutes") ?: "—"} phút\n" +
                    "Đợt tái phát: ${report.optInt("recurrent_episodes")} • Tự cho phép bỏ qua do quá thời gian: ${report.optInt("auto_skip_count_30d")}\n\n" +
                    "SKU PHÁT SINH BÁO THIẾU NHIỀU$topLines"
            }.onFailure { body.text = "Không tải được báo cáo: ${it.message}" }
        }
    }

    private fun showOperationalSla() {
        val content = page("Mốc thời gian vận hành", SCREEN_SLA)
        val ack = numberInput("Thời gian nhận xử lý (phút)")
        val reminder = numberInput("Chu kỳ nhắc xử lý (phút)")
        val replenish = numberInput("Thời gian châm hàng (phút)")
        val pickerAck = numberInput("Nhắc Picker xác nhận (phút)")
        listOf(ack.first, reminder.first, replenish.first, pickerAck.first).forEach(content::addView)
        content.addView(infoBox("Hết mốc chỉ nhắc/escalate. Hệ thống không tự cho phép SKIP."))
        content.addView(button("Lưu mốc thời gian", ButtonTone.PRIMARY) {
            lifecycleScope.launch { runCatching { app.repository.saveOperationalConfig(OperationalConfig(ack.second.int(), reminder.second.int(), replenish.second.int(), pickerAck.second.int(), false, 0)) }.onSuccess { toast("Đã lưu mốc thời gian vận hành") }.onFailure { toast(it.message ?: "Không lưu được") } }
        })
        lifecycleScope.launch { runCatching { app.repository.getOperationalConfig() }.onSuccess { cfg ->
            ack.second.setText(cfg.acknowledgeMinutes.toString()); reminder.second.setText(cfg.reminderMinutes.toString()); replenish.second.setText(cfg.replenishMinutes.toString()); pickerAck.second.setText(cfg.pickerAckReminderMinutes.toString())
        }.onFailure { toast(it.message ?: "Không tải được cấu hình") } }
    }

    private fun showConfig() {
        val content = page("Cấu hình hệ thống", SCREEN_CONFIG)
        val logRetention = numberInput("Lưu log chẩn đoán (ngày)")
        val staffInterval = numberInput("Chu kỳ đồng bộ nhân sự (phút)")
        val staffAuto = CheckBox(this).apply { text = "Tự động đồng bộ danh mục nhân sự" }
        content.addView(infoBox("Lịch sử nghiệp vụ giữ 45 ngày. OPEN/CLAIMED, event chưa ACK và conflict không bị xóa theo tuổi."))
        content.addView(logRetention.first); content.addView(staffAuto); content.addView(staffInterval.first)
        content.addView(button("Lưu cấu hình", ButtonTone.PRIMARY) {
            lifecycleScope.launch { runCatching { val old=app.repository.getConfig(); app.repository.saveConfig(old.copy(retentionDays=45,diagnosticLogRetentionDays=logRetention.second.int(),staffAutoSyncEnabled=staffAuto.isChecked,staffSyncIntervalMinutes=staffInterval.second.int(),autoSkipEnabled=false,autoSkipAfterMinutes=0)) }.onSuccess { toast("Đã lưu cấu hình hệ thống") }.onFailure { toast(it.message ?: "Không lưu được") } }
        })
        lifecycleScope.launch { runCatching { app.repository.getConfig() }.onSuccess { cfg -> logRetention.second.setText(cfg.diagnosticLogRetentionDays.toString()); staffAuto.isChecked=cfg.staffAutoSyncEnabled; staffInterval.second.setText(cfg.staffSyncIntervalMinutes.toString()) }.onFailure { toast(it.message ?: "Không tải được cấu hình") } }
    }

    private fun showUsers() {
        val content = page("Nhân sự & quyền", SCREEN_USERS)
        val list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        content.addView(button("Đồng bộ danh mục nhân sự", ButtonTone.PRIMARY) {
            lifecycleScope.launch { runCatching { app.api.invoke("staff-sync-now", JSONObject()) }.onSuccess { toast("Đồng bộ nhân sự: ${it.optString("status")}"); showUsers() }.onFailure { toast(it.message ?: "Không đồng bộ được") } }
        })
        content.addView(button("Tạo tài khoản ngoài danh sách nguồn") { createExtraUser { showUsers() } })
        content.addView(infoBox("Nhân sự từ Google Sheet được quản lý theo nguồn. Khi mất khỏi nguồn, tài khoản ngừng hoạt động nhưng lịch sử nghiệp vụ vẫn được giữ. Tài khoản 6281280 được bảo vệ."))
        content.addView(list)
        lifecycleScope.launch {
            runCatching { app.repository.listUsers() }.onSuccess { users ->
                if (users.isEmpty()) list.addView(infoBox("Không có nhân sự trong phạm vi quyền."))
                users.forEach { user ->
                    val row = LinearLayout(this@MainActivity).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(11), dp(9), dp(11), dp(9)); setBackgroundResource(R.drawable.bg_card) }
                    row.addView(text("${user.employeeCode} • ${user.fullName}${if (user.protectedAccount) " • BẢO VỆ" else ""}", 16, true))
                    row.addView(text("${user.role.label} • ${if (user.active) "Hoạt động" else "Ngừng"} • ${if (user.sourceKind == "GSHEET") "Google Sheet" else "Tạo thêm"}${if (user.sourcePosition.isNotBlank()) " • ${user.sourcePosition}" else ""}", 12, false).apply { setTextColor(getColor(R.color.text_secondary)) })
                    if (!user.protectedAccount && user.sourceKind != "GSHEET" && (app.session.effectiveRole == UserRole.ADMIN || user.role == UserRole.PICKER)) {
                        row.addView(button("Chỉnh sửa") { editUser(user) { showUsers() } })
                        row.addView(button("Ngừng tài khoản", ButtonTone.DANGER) { lifecycleScope.launch { runCatching { app.api.invoke("delete-user", JSONObject().put("id", user.id)) }.onSuccess { toast("Đã ngừng ${user.employeeCode}"); showUsers() }.onFailure { toast(it.message ?: "Không xử lý được") } } })
                    }
                    list.addView(row, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { setMargins(0, dp(4), 0, dp(4)) })
                }
            }.onFailure { list.addView(infoBox("Không tải được nhân sự: ${it.message}")) }
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
            else -> listOf(UserRole.PICKER)
        }
        val roleView = AutoCompleteTextView(this).apply {
            hint = "Vai trò"; threshold = 0
            setAdapter(ArrayAdapter(this@MainActivity, android.R.layout.simple_dropdown_item_1line, allowedRoles.map { it.label }))
            setText(user.role.label, false)
        }
        listOf(name, contractor, roleView, active, password).forEach(root::addView)
        AlertDialog.Builder(this).setTitle("${user.employeeCode} • ${user.fullName}").setView(root)
            .setNegativeButton("Hủy", null).setPositiveButton("Lưu") { _, _ ->
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
        AlertDialog.Builder(this).setTitle("Tạo tài khoản ngoài nguồn").setView(root).setNegativeButton("Hủy", null).setPositiveButton("Tạo") { _, _ ->
            val selectedRole = roles.firstOrNull { it.label == roleView.text.toString() } ?: roles.first()
            lifecycleScope.launch {
                val row = vn.pickpack1291.baohang.data.ImportUserRow(code.text.toString().trim(), name.text.toString().trim(), contractor.text.toString().trim(), selectedRole, true, password.text.toString())
                runCatching { app.repository.importUsers(listOf(row)) }.onSuccess { result ->
                    if (result.optInt("failed") > 0) toast(result.optJSONArray("errors")?.optString(0) ?: "Không tạo được") else { toast("Đã tạo tài khoản"); refresh() }
                }.onFailure { toast(it.message ?: "Không tạo được") }
            }
        }.show()
    }

    private fun showBackupAccounts() {
        if (app.session.effectiveRole != UserRole.ADMIN) { toast("Chỉ Admin hệ thống được quản lý tài khoản dự phòng"); return }
        val content = page("Tài khoản dự phòng", SCREEN_BACKUP)
        content.addView(infoBox("Danh tính kỹ thuật dùng khi Service lỗi. Không tính nhân sự/năng suất; mật khẩu không lưu trong App, Sheet hoặc log."))
        content.addView(button("Tạo tài khoản dự phòng", ButtonTone.PRIMARY) { createBackupAccount { showBackupAccounts() } })
        val list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }; content.addView(list)
        lifecycleScope.launch { runCatching { app.repository.listBackupAccounts() }.onSuccess { rows ->
            if (rows.length()==0) list.addView(infoBox("Chưa có tài khoản dự phòng."))
            for (i in 0 until rows.length()) { val a=rows.getJSONObject(i); val row=LinearLayout(this@MainActivity).apply { orientation=LinearLayout.VERTICAL; setPadding(dp(11),dp(9),dp(11),dp(9)); setBackgroundResource(R.drawable.bg_card) }
                row.addView(text("${a.optString("username")} • ${a.optString("display_name")}",16,true)); row.addView(text("${UserRole.from(a.optString("role")).label} • ${a.optString("status")} • thiết bị ${a.optString("device_scope","*")}",12,false))
                val id=a.optString("id"); if(a.optString("status")=="ACTIVE") { row.addView(button("Đặt lại mật khẩu") { backupPasswordDialog(id,false) { showBackupAccounts() } }); row.addView(button("Khóa",ButtonTone.DANGER) { lifecycleScope.launch { runCatching { app.repository.lockBackupAccount(id) }.onSuccess { showBackupAccounts() }.onFailure { toast(it.message?:"Không khóa được") } } }) } else row.addView(button("Mở khóa + đặt mật khẩu",ButtonTone.PRIMARY) { backupPasswordDialog(id,true) { showBackupAccounts() } })
                list.addView(row,LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,ViewGroup.LayoutParams.WRAP_CONTENT).apply { setMargins(0,dp(4),0,dp(4)) })
            }
        }.onFailure { list.addView(infoBox("Không tải được tài khoản dự phòng: ${it.message}")) } }
    }

    private fun createBackupAccount(refresh:()->Unit) {
        val root=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL; setPadding(dp(16),0,dp(16),0) }
        val username=EditText(this).apply { hint="Username dự phòng" }; val display=EditText(this).apply { hint="Tên hiển thị" }; val device=EditText(this).apply { hint="Device scope (* hoặc device ID)"; setText("*") }; val days=EditText(this).apply { hint="Thời hạn ngày"; inputType=InputType.TYPE_CLASS_NUMBER; setText("30") }; val password=EditText(this).apply { hint="Mật khẩu (>=14 ký tự)"; inputType=InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD }
        val roles=listOf(UserRole.ADMIN,UserRole.ADMIN_INVENT,UserRole.INVENT,UserRole.PICKER); val role=AutoCompleteTextView(this).apply { threshold=0; setAdapter(ArrayAdapter(this@MainActivity,android.R.layout.simple_dropdown_item_1line,roles.map{it.label})); setText(UserRole.INVENT.label,false) }; listOf(username,display,role,device,days,password).forEach(root::addView)
        AlertDialog.Builder(this).setTitle("Tạo tài khoản dự phòng").setView(root).setNegativeButton("Hủy",null).setPositiveButton("Tạo") { _,_-> val p=password.text.toString(); if(p.length<14){toast("Mật khẩu cần ít nhất 14 ký tự");return@setPositiveButton}; val selected=roles.firstOrNull{it.label==role.text.toString()}?:UserRole.INVENT; val expiry=Instant.now().plusSeconds((days.text.toString().toLongOrNull()?:30L).coerceAtLeast(1L)*86400L).toString(); lifecycleScope.launch { runCatching { app.repository.createBackupAccount(username.text.toString().trim().lowercase(),display.text.toString().trim(),selected,device.text.toString().trim().ifBlank{"*"},p,expiry) }.onSuccess { toast("Đã tạo tài khoản dự phòng"); refresh() }.onFailure { toast(it.message?:"Không tạo được") } } }.show()
    }

    private fun backupPasswordDialog(id:String,unlock:Boolean,refresh:()->Unit){ val input=EditText(this).apply { hint="Mật khẩu mới (>=14 ký tự)"; inputType=InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD }; AlertDialog.Builder(this).setTitle(if(unlock)"Mở khóa tài khoản dự phòng" else "Đặt lại mật khẩu").setView(input).setNegativeButton("Hủy",null).setPositiveButton("Xác nhận") { _,_-> val p=input.text.toString(); if(p.length<14){toast("Mật khẩu cần ít nhất 14 ký tự");return@setPositiveButton}; lifecycleScope.launch { runCatching { if(unlock) app.repository.unlockBackupAccount(id,p) else app.repository.resetBackupAccount(id,p) }.onSuccess { refresh() }.onFailure { toast(it.message?:"Không cập nhật được") } } }.show() }

    private fun showServiceMetrics() {
        val content = page("Dung lượng & dịch vụ", SCREEN_SERVICES)
        val body = infoBox("Đang đọc số liệu hệ thống…")
        content.addView(body)
        lifecycleScope.launch {
            runCatching { app.api.invoke("service-metrics", JSONObject()) }.onSuccess { data ->
                val usage = data.optJSONObject("usage") ?: JSONObject(); val limits = data.optJSONObject("free_limits") ?: JSONObject()
                val dbBytes = usage.optLong("database_bytes"); val dbLimit = limits.optLong("database_bytes", 1L).coerceAtLeast(1L); val percent = dbBytes * 100.0 / dbLimit
                body.text = "GÓI MIỄN PHÍ • KHÔNG TỰ BẬT THANH TOÁN\n\n" +
                    "Database: %.1f MB / %.0f MB (%.1f%%)\n".format(dbBytes / 1048576.0, dbLimit / 1048576.0, percent) +
                    "SKU hoạt động: ${usage.optInt("sku_active")}\nNhân sự hoạt động: ${usage.optInt("profiles_active")}\nSự kiện đang mở: ${usage.optInt("issues_active")}\n" +
                    "Thiết bị nhận thông báo: ${usage.optInt("active_device_tokens")}\nGoogle Sheet chờ: ${usage.optInt("sheet_pending")}\nLog chẩn đoán: %.2f MB".format(usage.optLong("diagnostic_log_bytes") / 1048576.0)
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
        if (!app.session.isLoggedIn || activeAlertEventId != null) return
        runCatching { app.repository.pendingAlerts() }.onSuccess { alerts ->
            val effectiveRole = app.session.effectiveRole
            val alert = alerts.firstOrNull {
                when (it.status) {
                    IssueStatus.OPEN -> effectiveRole in setOf(UserRole.INVENT, UserRole.ADMIN_INVENT, UserRole.ADMIN)
                    IssueStatus.AVAILABLE, IssueStatus.SKIP_ALLOWED -> true
                    else -> false
                }
            } ?: return@onSuccess
            activeAlertEventId = alert.eventId
            runCatching { app.repository.markAlertReceived(alert.eventId) }

            if (alert.status == IssueStatus.OPEN) {
                val sku = alert.issue?.sku.orEmpty()
                val dialog = AlertDialog.Builder(this@MainActivity)
                    .setTitle(alert.title.ifBlank { "CÓ SKU CẦN XỬ LÝ" })
                    .setMessage("${alert.message}\n\nCảnh báo này chỉ hiển thị lần đầu của đợt SKU.")
                    .setNegativeButton("ĐỂ SAU", null)
                    .setPositiveButton("NHẬN XỬ LÝ") { _, _ ->
                        val issueId = alert.issue?.id.orEmpty()
                        if (issueId.isNotBlank()) {
                            lifecycleScope.launch {
                                runCatching { app.repository.claimIssue(issueId) }
                                    .onSuccess {
                                        toast("Đã nhận xử lý SKU ${sku.ifBlank { it.sku }}")
                                        inventRefresh?.invoke()
                                    }
                                    .onFailure { toast(it.message ?: "Không nhận được SKU") }
                            }
                        }
                    }
                    .create()
                dialog.setOnShowListener {
                    lifecycleScope.launch { runCatching { app.repository.markAlertDisplayed(alert.eventId) } }
                }
                dialog.setOnDismissListener { activeAlertEventId = null }
                if (!isFinishing && !isDestroyed) dialog.show() else activeAlertEventId = null
            } else {
                val dialog = AlertDialog.Builder(this@MainActivity)
                    .setTitle(alert.title.ifBlank { alert.status.label })
                    .setMessage("${alert.message}\n\nTrạng thái v${alert.issueVersion}")
                    .setCancelable(false)
                    .setPositiveButton("Xác nhận") { _, _ -> lifecycleScope.launch { app.repository.acknowledgeAlert(alert.eventId) } }
                    .create()
                dialog.setOnShowListener { lifecycleScope.launch { runCatching { app.repository.markAlertDisplayed(alert.eventId) } } }
                dialog.setOnDismissListener { activeAlertEventId = null }
                if (!isFinishing && !isDestroyed) dialog.show() else activeAlertEventId = null
            }
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
        content.addView(button("Gửi chẩn đoán", ButtonTone.SECONDARY) {
            lifecycleScope.launch {
                runCatching { app.repository.sendDiagnosticLog() }
                    .onSuccess { toast(if (it.optBoolean("uploaded")) "Đã gửi dữ liệu chẩn đoán" else it.optString("message", "Chưa có dữ liệu chẩn đoán")) }
                    .onFailure { toast(it.message ?: "Không gửi được dữ liệu chẩn đoán") }
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
            }.onSuccess { toast("Đã cập nhật $it SKU và tên sản phẩm"); showCatalog() }.onFailure { toast("Lỗi: ${it.message}") }
        }
    }

    private fun numberInput(label: String): Pair<LinearLayout, EditText> {
        val input = EditText(this).apply { inputType = InputType.TYPE_CLASS_NUMBER; setSingleLine(true) }
        val wrapper = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(text(label, 13, true))
            addView(input)
            setPadding(0, dp(5), 0, dp(7))
        }
        return wrapper to input
    }

    private fun EditText.int(): Int = text.toString().toIntOrNull() ?: 0

    private fun button(label: String, tone: ButtonTone = ButtonTone.SECONDARY, action: () -> Unit): Button = Button(this).apply {
        text = label
        setOnClickListener { action() }
        isAllCaps = false
        typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        setPadding(dp(10), 0, dp(10), 0)
        minHeight = dp(48)
        setBackgroundResource(
            when (tone) {
                ButtonTone.PRIMARY -> R.drawable.bg_button_primary
                ButtonTone.SUCCESS -> R.drawable.bg_button_success
                ButtonTone.DANGER -> R.drawable.bg_button_danger
                ButtonTone.SECONDARY -> R.drawable.bg_button_secondary
            }
        )
        setTextColor(getColor(if (tone == ButtonTone.SECONDARY) R.color.navy_900 else R.color.white))
    }

    private fun text(value: String, size: Int, bold: Boolean): TextView = TextView(this).apply {
        text = value
        textSize = size.toFloat()
        typeface = Typeface.create(if (bold) "sans-serif-medium" else "sans-serif", Typeface.NORMAL)
        setTextColor(getColor(R.color.text_primary))
        setLineSpacing(0f, 1.08f)
    }

    private fun section(value: String): TextView = text(value, 15, true).apply {
        setTextColor(getColor(R.color.navy_700))
        setPadding(0, dp(18), 0, dp(6))
    }

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
        private const val SCREEN_SLA = "sla"
        private const val SCREEN_CONFIG = "config"
        private const val SCREEN_USERS = "users"
        private const val SCREEN_BACKUP = "backup"
    }
}
