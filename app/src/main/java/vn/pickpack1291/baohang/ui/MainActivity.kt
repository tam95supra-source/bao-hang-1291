package vn.pickpack1291.baohang.ui

import android.app.AlertDialog
import android.content.Intent
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.text.Editable
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
import org.json.JSONObject
import vn.pickpack1291.baohang.BaoHangApplication
import vn.pickpack1291.baohang.BuildConfig
import vn.pickpack1291.baohang.R
import vn.pickpack1291.baohang.data.AppConfig
import vn.pickpack1291.baohang.data.IssueBoard
import vn.pickpack1291.baohang.data.SkuItem
import vn.pickpack1291.baohang.data.StockIssue
import vn.pickpack1291.baohang.data.UserProfile
import vn.pickpack1291.baohang.data.UserRole
import vn.pickpack1291.baohang.importer.XlsxImporter
import vn.pickpack1291.baohang.update.AppUpdater

class MainActivity : AppCompatActivity() {
    private val app by lazy { application as BaoHangApplication }
    private lateinit var container: FrameLayout
    private var searchJob: Job? = null

    private val chooseSku = registerForActivityResult(ActivityResultContracts.GetContent()) { uri -> uri?.let(::importSkuFile) }
    private val chooseUsers = registerForActivityResult(ActivityResultContracts.GetContent()) { uri -> uri?.let(::importUserFile) }
    private val saveTemplate = registerForActivityResult(ActivityResultContracts.CreateDocument("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")) { uri -> uri?.let(::writeTemplate) }

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
            runCatching { app.repository.flushOutbox() }
            runCatching { app.repository.syncCatalog() }
        }
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
            UserRole.ADMIN_INVENT -> showAdminInvent()
            UserRole.INVENT -> showInventBoard()
            UserRole.PICKER -> showPicker()
        }
    }

    private fun page(title: String): LinearLayout {
        container.removeAllViews()
        val scroll = ScrollView(this)
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(14), dp(14), dp(28))
        }
        scroll.addView(content, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        container.addView(scroll, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        content.addView(text(title, 22, true).apply { setPadding(0, 0, 0, dp(10)) })
        content.addView(infoBox("Phiên bản ${BuildConfig.VERSION_NAME} • Kênh ${BuildConfig.OTA_CHANNEL.uppercase()}"))
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
        val content = page("ADMIN • Toàn quyền hệ thống")
        content.addView(infoBox("Tài khoản ADMIN là duy nhất. Không thể tạo thêm, hạ quyền hoặc vô hiệu hóa bằng import."))
        content.addView(button("BÁO HÀNG INVENT") { showInventBoard() })
        content.addView(button("GIAO DIỆN NGƯỜI LẤY HÀNG") { showPicker() })
        content.addView(button("BÁO CÁO 30 NGÀY") { showReports() })
        content.addView(button("CẤU HÌNH HỆ THỐNG") { showConfig() })
        content.addView(button("QUẢN LÝ NHÂN SỰ") { showUsers() })
        content.addView(button("IMPORT SKU.EXCEL") { chooseSku.launch(XLSX_MIME) })
        content.addView(button("IMPORT NHÂN SỰ.EXCEL") { chooseUsers.launch(XLSX_MIME) })
        content.addView(button("TẢI FILE NHÂN SỰ MẪU") { saveTemplate.launch("MAU_NHAN_SU_BAO_HANG_1291.xlsx") })
        content.addView(button("ĐỒNG BỘ GOOGLE SHEET") { syncSheet() })
        addDiagnosticsButton(content)
        content.addView(section("Kiểm thử giao diện + quyền thực tế"))
        content.addView(infoBox("Khi bật test mode, cả giao diện và API đều bị giới hạn đúng theo quyền đang giả lập."))
        content.addView(button("TEST • ADMIN INVENT") { enterTestRole(UserRole.ADMIN_INVENT) })
        content.addView(button("TEST • BÁO HÀNG INVENT") { enterTestRole(UserRole.INVENT) })
        content.addView(button("TEST • NGƯỜI LẤY HÀNG") { enterTestRole(UserRole.PICKER) })
    }

    private fun showAdminInvent() {
        val content = page("ADMIN INVENT")
        content.addView(button("BÁO HÀNG") { showInventBoard() })
        content.addView(button("BÁO CÁO 30 NGÀY") { showReports() })
        content.addView(button("QUẢN LÝ NHÂN SỰ") { showUsers() })
        content.addView(button("IMPORT SKU.EXCEL") { chooseSku.launch(XLSX_MIME) })
        content.addView(button("ĐỒNG BỘ GOOGLE SHEET") { syncSheet() })
        addDiagnosticsButton(content)
    }

    private fun enterTestRole(role: UserRole) {
        runCatching { app.repository.setAdminTestRole(role) }
            .onSuccess { renderForRole() }
            .onFailure { toast(it.message ?: "Không bật được test mode") }
    }

    private fun showInventBoard() {
        val content = page("BÁO HÀNG INVENT")
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
            val list = when (selected) { 1 -> data.skipped; 2 -> data.available; else -> data.open }
            boardContainer.removeAllViews()
            if (list.isEmpty()) boardContainer.addView(infoBox("Không có SKU ở trạng thái này."))
            list.forEach { issue -> boardContainer.addView(issueCard(issue, selected) { loadInventBoard(status) { board = it; draw() } }) }
            status.text = when (selected) { 1 -> "${list.size} SKU đã cho SKIP"; 2 -> "${list.size} SKU đã châm bù"; else -> "${list.size} SKU đang báo thiếu" }
        }
        listOf("BÁO THIẾU", "SKIP", "ĐÃ CHÂM").forEachIndexed { index, label ->
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
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), dp(10), dp(12), dp(10))
            setBackgroundResource(R.drawable.bg_card)
        }
        card.layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { setMargins(0, dp(5), 0, dp(5)) }
        card.addView(text("SKU ${issue.sku} • ${issue.reportCount} lượt", 17, true))
        card.addView(text(issue.productName, 14, false))
        card.addView(text("Báo đầu: ${shortTime(issue.reportedAt)}${if (issue.assignedName.isNotBlank()) " • Xử lý: ${issue.assignedName}" else ""}", 12, false))
        if (bucket == 0) {
            val actions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            actions.addView(button("SKIP") { updateIssue(issue, "NOT_FOUND", refresh) }, LinearLayout.LayoutParams(0, dp(48), 1f))
            actions.addView(button("ĐÃ CHÂM BÙ") { updateIssue(issue, "AVAILABLE", refresh) }, LinearLayout.LayoutParams(0, dp(48), 1f))
            card.addView(actions)
            if (issue.assignedName.isBlank()) card.addView(button("Nhận xử lý (khóa nội bộ)") {
                lifecycleScope.launch {
                    runCatching { app.repository.claimIssue(issue.id) }
                        .onSuccess { toast("Đã nhận xử lý SKU ${issue.sku}"); refresh() }
                        .onFailure { toast(it.message ?: "Không nhận được SKU") }
                }
            })
        } else if (bucket == 1) {
            card.addView(button("ĐÃ TÌM THẤY / ĐÃ CHÂM BÙ") { updateIssue(issue, "AVAILABLE", refresh) })
        }
        return card
    }

    private fun updateIssue(issue: StockIssue, action: String, refresh: () -> Unit) {
        val label = if (action == "NOT_FOUND") "Cho phép SKIP SKU ${issue.sku}?" else "Xác nhận SKU ${issue.sku} đã có hàng/châm bù?"
        AlertDialog.Builder(this).setMessage(label).setNegativeButton("HỦY", null).setPositiveButton("XÁC NHẬN") { _, _ ->
            lifecycleScope.launch {
                runCatching { app.repository.updateIssue(issue.id, action) }
                    .onSuccess { toast("Đã cập nhật: ${it.status.label}"); refresh() }
                    .onFailure { toast(it.message ?: "Không cập nhật được") }
            }
        }.show()
    }

    private fun showPicker() {
        val content = page("NGƯỜI LẤY HÀNG")
        content.addView(infoBox("Gõ bất kỳ phần nào của SKU hoặc tên hàng. Ví dụ SKU abcde có thể tìm bằng b, c hoặc cd."))
        val search = AutoCompleteTextView(this).apply {
            hint = "Tìm SKU / tên hàng"
            threshold = 1
            setPadding(dp(12), dp(10), dp(12), dp(10))
            setBackgroundResource(R.drawable.bg_input)
        }
        val selected = text("Chưa chọn SKU", 15, true)
        val report = button("BÁO THIẾU") { }.apply { isEnabled = false }
        val myReports = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        var selectedSku: SkuItem? = null
        fun select(item: SkuItem) {
            selectedSku = item
            selected.text = "SKU ${item.sku}\n${item.productName}"
            report.isEnabled = true
        }
        search.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                selectedSku = null; report.isEnabled = false
                searchJob?.cancel()
                searchJob = lifecycleScope.launch {
                    delay(120)
                    val query = s?.toString().orEmpty()
                    if (query.isBlank()) return@launch
                    val local = withContext(Dispatchers.IO) { app.repository.searchSkus(query) }
                    val results = if (local.isNotEmpty()) local else runCatching { app.repository.searchSkusOnline(query) }.getOrDefault(emptyList())
                    search.setAdapter(ArrayAdapter(this@MainActivity, android.R.layout.simple_dropdown_item_1line, results))
                    if (search.hasFocus() && results.isNotEmpty()) search.showDropDown()
                }
            }
            override fun afterTextChanged(s: Editable?) = Unit
        })
        search.setOnItemClickListener { parent, _, position, _ -> select(parent.getItemAtPosition(position) as SkuItem) }
        report.setOnClickListener {
            val item = selectedSku ?: return@setOnClickListener
            AlertDialog.Builder(this).setTitle("Báo thiếu hàng?").setMessage("SKU ${item.sku}\n${item.productName}")
                .setNegativeButton("HỦY", null).setPositiveButton("BÁO THIẾU") { _, _ ->
                    lifecycleScope.launch {
                        report.isEnabled = false
                        runCatching { app.repository.reportShortage(item.sku) }
                            .onSuccess { toast((if (it.wasAlreadyReported) "SKU đã có báo thiếu. " else "") + it.message); loadMyIssues(myReports) }
                            .onFailure { toast(it.message ?: "Không báo được") }
                        report.isEnabled = true
                    }
                }.show()
        }
        content.addView(search, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)).apply { setMargins(0, dp(4), 0, dp(8)) })
        content.addView(selected)
        content.addView(report)
        content.addView(section("Báo thiếu của tôi"))
        content.addView(myReports)
        addDiagnosticsButton(content)
        loadMyIssues(myReports)
        lifecycleScope.launch { checkPendingAlerts() }
    }

    private fun loadMyIssues(target: LinearLayout) {
        lifecycleScope.launch {
            val issues = app.repository.loadMyIssues()
            target.removeAllViews()
            if (issues.isEmpty()) target.addView(infoBox("Chưa có báo thiếu."))
            issues.take(50).forEach { issue ->
                target.addView(infoBox("${issue.status.label} • SKU ${issue.sku} • ${issue.reportCount} lượt\n${issue.productName}\n${shortTime(issue.reportedAt)}"))
            }
        }
    }

    private suspend fun checkPendingAlerts() {
        if (!app.session.isLoggedIn) return
        runCatching { app.repository.pendingAlerts() }.onSuccess { alerts ->
            val alert = alerts.firstOrNull() ?: return@onSuccess
            if (isFinishing || isDestroyed) return@onSuccess
            AlertDialog.Builder(this)
                .setTitle(alert.title.ifBlank { alert.status.label })
                .setMessage(alert.message)
                .setCancelable(false)
                .setPositiveButton("ĐÃ HIỂU") { _, _ -> lifecycleScope.launch { app.repository.acknowledgeAlert(alert.eventId) } }
                .show()
        }
    }


    private fun showUsers() {
        val content = page("QUẢN LÝ NHÂN SỰ")
        content.addView(button("← VỀ MENU QUYỀN") { renderForRole() })
        content.addView(infoBox("Admin có thể sửa mọi tài khoản nhưng ADMIN duy nhất vẫn không thể bị hạ quyền/vô hiệu hóa. Admin Invent chỉ sửa tài khoản Báo hàng Invent và Người lấy hàng."))
        val status = text("Đang tải nhân sự…", 14, false)
        val list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        content.addView(button("LÀM MỚI") { loadUsers(list, status) })
        content.addView(status)
        content.addView(list)
        addDiagnosticsButton(content)
        loadUsers(list, status)
    }

    private fun loadUsers(target: LinearLayout, status: TextView) {
        lifecycleScope.launch {
            status.text = "Đang tải nhân sự…"
            runCatching { app.repository.listUsers() }
                .onSuccess { users ->
                    target.removeAllViews()
                    status.text = "${users.size} tài khoản"
                    if (users.isEmpty()) target.addView(infoBox("Chưa có tài khoản."))
                    users.forEach { user ->
                        val card = LinearLayout(this@MainActivity).apply {
                            orientation = LinearLayout.VERTICAL
                            setPadding(dp(12), dp(10), dp(12), dp(10))
                            setBackgroundResource(R.drawable.bg_card)
                            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { setMargins(0, dp(4), 0, dp(4)) }
                        }
                        card.addView(text("${user.employeeCode} • ${user.fullName}", 16, true))
                        card.addView(text("${user.role.label} • ${if (user.active) "Đang hoạt động" else "Đã khóa"}${if (user.contractor.isNotBlank()) " • ${user.contractor}" else ""}", 13, false))
                        val canEdit = when (app.session.effectiveRole) {
                            UserRole.ADMIN -> true
                            UserRole.ADMIN_INVENT -> user.role in setOf(UserRole.INVENT, UserRole.PICKER)
                            else -> false
                        }
                        if (canEdit) card.addView(button("CHỈNH SỬA") { editUser(user) { loadUsers(target, status) } })
                        target.addView(card)
                    }
                }
                .onFailure { error ->
                    status.text = "Lỗi: ${error.message}"
                    app.diagnostics.error("user_list_failed", error)
                }
        }
    }

    private fun editUser(user: UserProfile, refresh: () -> Unit) {
        val effective = app.session.effectiveRole
        val allowedRoles = when {
            user.role == UserRole.ADMIN -> listOf(UserRole.ADMIN)
            effective == UserRole.ADMIN -> listOf(UserRole.ADMIN_INVENT, UserRole.INVENT, UserRole.PICKER)
            else -> listOf(UserRole.INVENT, UserRole.PICKER)
        }
        val wrap = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(8), dp(20), 0) }
        fun field(hintText: String, value: String): EditText = EditText(this).apply {
            hint = hintText
            setText(value)
            wrap.addView(this)
        }
        val employeeCode = field("Mã nhân viên", user.employeeCode)
        val fullName = field("Họ tên", user.fullName)
        val contractor = field("Nhà thầu", user.contractor)
        val roleField = AutoCompleteTextView(this).apply {
            hint = "Quyền"
            threshold = 0
            setText(user.role.wire, false)
            setAdapter(ArrayAdapter(this@MainActivity, android.R.layout.simple_dropdown_item_1line, allowedRoles.map { it.wire }))
            setOnClickListener { showDropDown() }
            isEnabled = user.role != UserRole.ADMIN
            wrap.addView(this)
        }
        val active = CheckBox(this).apply {
            text = "Tài khoản đang hoạt động"
            isChecked = user.active
            isEnabled = user.role != UserRole.ADMIN
            wrap.addView(this)
        }
        val password = EditText(this).apply {
            hint = "Mật khẩu mới (để trống nếu giữ nguyên)"
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
            wrap.addView(this)
        }
        AlertDialog.Builder(this)
            .setTitle("Chỉnh sửa ${user.employeeCode}")
            .setView(wrap)
            .setNegativeButton("HỦY", null)
            .setPositiveButton("LƯU") { _, _ ->
                val roleWire = roleField.text.toString().trim().uppercase()
                val selectedRole = allowedRoles.firstOrNull { it.wire == roleWire }
                if (selectedRole == null) {
                    toast("Quyền không hợp lệ")
                    return@setPositiveButton
                }
                lifecycleScope.launch {
                    runCatching {
                        app.repository.updateUser(
                            user,
                            employeeCode.text.toString().trim(),
                            fullName.text.toString().trim(),
                            contractor.text.toString().trim(),
                            selectedRole,
                            active.isChecked,
                            password.text.toString()
                        )
                    }.onSuccess { updated ->
                        toast("Đã cập nhật ${updated.employeeCode}")
                        if (updated.id == app.session.profile?.id) runCatching { app.repository.refreshProfile() }
                        refresh()
                    }.onFailure { error -> toast(error.message ?: "Không cập nhật được nhân sự") }
                }
            }
            .show()
    }

    private fun showReports() {
        lifecycleScope.launch {
            runCatching { app.repository.reportsSummary() }
                .onSuccess { data ->
                    val status = data.optJSONObject("by_status") ?: JSONObject()
                    val message = buildString {
                        appendLine("30 ngày gần nhất")
                        appendLine("Đợt báo thiếu: ${data.optInt("issues")}")
                        appendLine("Tổng lượt báo: ${data.optInt("reports")}")
                        appendLine("Đang mở: ${status.optInt("OPEN") + status.optInt("CLAIMED") + status.optInt("SEARCHING") + status.optInt("REPLENISHING")}")
                        appendLine("SKIP: ${status.optInt("SKIP_ALLOWED")}")
                        appendLine("Đã châm bù: ${status.optInt("AVAILABLE")}")
                        if (!data.isNull("average_resolution_minutes")) append("Xử lý TB: ${data.optInt("average_resolution_minutes")} phút")
                    }
                    AlertDialog.Builder(this@MainActivity).setTitle("Báo cáo Báo hàng 1291").setMessage(message).setPositiveButton("ĐÓNG", null).show()
                }
                .onFailure { toast(it.message ?: "Không tải được báo cáo") }
        }
    }

    private fun showConfig() {
        val wrap = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(8), dp(20), 0) }
        fun field(label: String): EditText = EditText(this).apply { hint = label; inputType = android.text.InputType.TYPE_CLASS_NUMBER; wrap.addView(this) }
        val ack = field("Nhắc Invent nhận xử lý (phút)")
        val reminder = field("Chu kỳ nhắc Invent (phút)")
        val replenish = field("Quá thời gian xử lý (phút)")
        val pickerAck = field("Nhắc Picker chưa xác nhận (phút)")
        val retention = field("Lưu log server (ngày)")
        lifecycleScope.launch {
            runCatching { app.repository.getConfig() }.onSuccess { cfg ->
                ack.setText(cfg.acknowledgeMinutes.toString())
                reminder.setText(cfg.reminderMinutes.toString())
                replenish.setText(cfg.replenishMinutes.toString())
                pickerAck.setText(cfg.pickerAckReminderMinutes.toString())
                retention.setText(cfg.diagnosticLogRetentionDays.toString())
            }
        }
        AlertDialog.Builder(this).setTitle("Cấu hình hệ thống").setView(wrap).setNegativeButton("HỦY", null)
            .setPositiveButton("LƯU") { _, _ ->
                val cfg = AppConfig(
                    ack.text.toString().toIntOrNull() ?: 15,
                    reminder.text.toString().toIntOrNull() ?: 5,
                    replenish.text.toString().toIntOrNull() ?: 15,
                    pickerAck.text.toString().toIntOrNull() ?: 3,
                    retention.text.toString().toIntOrNull() ?: 14
                )
                lifecycleScope.launch {
                    runCatching { app.repository.saveConfig(cfg) }
                        .onSuccess { toast("Đã lưu cấu hình") }
                        .onFailure { toast(it.message ?: "Không lưu được") }
                }
            }.show()
    }

    private fun addDiagnosticsButton(content: LinearLayout) {
        content.addView(section("Hỗ trợ kỹ thuật"))
        content.addView(button("GỬI LOG CHẨN ĐOÁN") {
            lifecycleScope.launch {
                toast("Đang nén và gửi log…")
                runCatching { app.repository.sendDiagnosticLog() }
                    .onSuccess { result -> toast(if (result.optBoolean("uploaded")) "Đã gửi log; log cũ trên máy đã được xóa" else result.optString("message", "Chưa có log")) }
                    .onFailure { toast("Gửi log lỗi: ${it.message}") }
            }
        })
    }

    private fun syncSheet() {
        lifecycleScope.launch {
            runCatching { app.repository.syncGoogleSheet() }
                .onSuccess { toast("Đã đồng bộ Google Sheet") }
                .onFailure { toast(it.message ?: "Đồng bộ lỗi") }
        }
    }

    private fun importSkuFile(uri: Uri) {
        lifecycleScope.launch {
            toast("Đang đọc file SKU…")
            runCatching {
                val items = withContext(Dispatchers.IO) { XlsxImporter(contentResolver).parseSkuFile(uri) }
                items.chunked(1000).forEach { app.repository.importSkus(it) }
                withContext(Dispatchers.IO) { app.repository.syncCatalog() }
                items.size
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

    private fun writeTemplate(uri: Uri) {
        runCatching {
            contentResolver.openOutputStream(uri)?.use { output ->
                resources.openRawResource(R.raw.mau_nhan_su_bao_hang_1291).use { it.copyTo(output) }
            } ?: error("Không ghi được file")
        }.onSuccess { toast("Đã lưu file nhân sự mẫu") }.onFailure { toast(it.message ?: "Không lưu được") }
    }

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

    companion object { private const val XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
}
