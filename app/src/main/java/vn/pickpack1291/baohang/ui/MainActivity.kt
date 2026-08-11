package vn.pickpack1291.baohang.ui

import android.app.AlertDialog
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.LayoutInflater
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.ArrayAdapter
import android.widget.AutoCompleteTextView
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ListView
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
import vn.pickpack1291.baohang.BaoHangApplication
import vn.pickpack1291.baohang.R
import vn.pickpack1291.baohang.data.AppConfig
import vn.pickpack1291.baohang.data.IssueStatus
import vn.pickpack1291.baohang.data.SkuItem
import vn.pickpack1291.baohang.data.StockIssue
import vn.pickpack1291.baohang.data.UserRole
import vn.pickpack1291.baohang.importer.XlsxImporter
import vn.pickpack1291.baohang.update.AppUpdater

class MainActivity : AppCompatActivity() {
    private val app by lazy { application as BaoHangApplication }
    private lateinit var container: FrameLayout
    private var skuImportUri: Uri? = null
    private var userImportUri: Uri? = null

    private val chooseSku = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        uri?.let { skuImportUri = it; importSkuFile(it) }
    }
    private val chooseUsers = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        uri?.let { userImportUri = it; importUserFile(it) }
    }
    private val saveTemplate = registerForActivityResult(
        ActivityResultContracts.CreateDocument("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    ) { uri -> uri?.let(::writeTemplate) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!app.session.isLoggedIn) {
            startActivity(Intent(this, LoginActivity::class.java)); finish(); return
        }
        setContentView(R.layout.activity_main)
        container = findViewById(R.id.contentContainer)
        val profile = app.session.profile!!
        findViewById<TextView>(R.id.tvHeaderUser).text =
            "${profile.employeeCode} • ${profile.fullName} • ${profile.contractor}"
        findViewById<TextView>(R.id.btnLogout).setOnClickListener {
            AlertDialog.Builder(this).setMessage("Đăng xuất khỏi thiết bị này?")
                .setNegativeButton("HỦY", null).setPositiveButton("ĐĂNG XUẤT") { _, _ ->
                    app.repository.logout()
                    startActivity(Intent(this, LoginActivity::class.java)); finish()
                }.show()
        }
        when (profile.role) {
            UserRole.PICKER -> showPicker()
            UserRole.INVENT_USER -> showInvent()
            UserRole.INVENT_ADMIN -> showAdmin()
        }
        AppUpdater(this).check()
        lifecycleScope.launch(Dispatchers.IO) {
            runCatching { app.repository.flushOutbox() }
            runCatching { app.repository.syncCatalog() }
        }
    }

    private fun replace(layout: Int): View {
        container.removeAllViews()
        return LayoutInflater.from(this).inflate(layout, container, true)
    }

    private fun showPicker() {
        val root = replace(R.layout.view_picker)
        val search = root.findViewById<AutoCompleteTextView>(R.id.acSkuSearch)
        val selectedSku = root.findViewById<TextView>(R.id.tvSelectedSku)
        val selectedProduct = root.findViewById<TextView>(R.id.tvSelectedProduct)
        val report = root.findViewById<Button>(R.id.btnReportShortage)
        val list = root.findViewById<ListView>(R.id.listMyReports)
        val issueAdapter = IssueAdapter(this)
        list.adapter = issueAdapter
        var selected: SkuItem? = null
        var searchJob: Job? = null

        fun select(item: SkuItem) {
            selected = item
            selectedSku.text = "SKU ${item.sku}"
            selectedProduct.text = item.productName
            report.isEnabled = true
        }
        search.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                selected = null; report.isEnabled = false
                searchJob?.cancel()
                searchJob = lifecycleScope.launch {
                    delay(120)
                    val results = withContext(Dispatchers.IO) { app.repository.searchSkus(s.orEmpty().toString()) }
                    val adapter = ArrayAdapter(this@MainActivity, android.R.layout.simple_dropdown_item_1line, results)
                    search.setAdapter(adapter)
                    if (search.hasFocus() && results.isNotEmpty()) search.showDropDown()
                }
            }
            override fun afterTextChanged(s: Editable?) = Unit
        })
        search.setOnItemClickListener { parent, _, position, _ -> select(parent.getItemAtPosition(position) as SkuItem) }
        search.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_SEARCH) {
                lifecycleScope.launch {
                    val found = withContext(Dispatchers.IO) { app.repository.searchSkus(search.text.toString()) }
                    found.firstOrNull { it.sku.equals(search.text.toString().trim(), true) }?.let(::select)
                        ?: Toast.makeText(this@MainActivity, "Không tìm thấy đúng SKU", Toast.LENGTH_SHORT).show()
                }
                true
            } else false
        }
        report.setOnClickListener {
            val item = selected ?: return@setOnClickListener
            AlertDialog.Builder(this).setTitle("Báo hết hàng?")
                .setMessage("SKU ${item.sku}\n${item.productName}")
                .setNegativeButton("HỦY", null).setPositiveButton("BÁO HẾT HÀNG") { _, _ ->
                    report.isEnabled = false
                    lifecycleScope.launch {
                        runCatching { app.repository.reportShortage(item.sku) }
                            .onSuccess { result ->
                                val prefix = if (result.wasAlreadyReported) "SKU đã được báo trước. " else ""
                                Toast.makeText(this@MainActivity, prefix + result.message, Toast.LENGTH_LONG).show()
                                loadMyIssues(issueAdapter)
                            }
                            .onFailure { Toast.makeText(this@MainActivity, it.message, Toast.LENGTH_LONG).show() }
                        report.isEnabled = true
                    }
                }.show()
        }
        loadMyIssues(issueAdapter)
    }

    private fun loadMyIssues(adapter: IssueAdapter) {
        lifecycleScope.launch {
            val issues = app.repository.loadMyIssues()
            adapter.submit(issues)
        }
    }

    private fun showInvent() {
        val root = replace(R.layout.view_invent)
        val list = root.findViewById<ListView>(R.id.listIssues)
        val summary = root.findViewById<TextView>(R.id.tvIssueSummary)
        val adapter = IssueAdapter(this)
        list.adapter = adapter
        fun refresh() {
            summary.text = "Đang tải…"
            lifecycleScope.launch {
                val issues = app.repository.loadActiveIssues()
                adapter.submit(issues)
                summary.text = "${issues.size} SKU đang chờ/xử lý • chạm một dòng để cập nhật"
            }
        }
        root.findViewById<Button>(R.id.btnRefreshIssues).setOnClickListener { refresh() }
        list.setOnItemClickListener { _, _, position, _ -> showIssueActions(adapter.getItem(position), ::refresh) }
        refresh()
    }

    private fun showIssueActions(issue: StockIssue, onDone: () -> Unit) {
        val actions = mutableListOf<Pair<String, String>>()
        if (issue.status == IssueStatus.OPEN) actions += "XÁC NHẬN NHẬN TIN" to "CLAIM"
        actions += "ĐANG TÌM HÀNG" to "SEARCHING"
        actions += "ĐANG CHÂM HÀNG" to "REPLENISHING"
        actions += "ĐÃ CÓ HÀNG" to "AVAILABLE"
        actions += "KHÔNG THẤY — CHO PHÉP SKIP" to "NOT_FOUND"
        AlertDialog.Builder(this).setTitle("SKU ${issue.sku}")
            .setItems(actions.map { it.first }.toTypedArray()) { _, which ->
                lifecycleScope.launch {
                    runCatching { app.repository.updateIssue(issue.id, actions[which].second) }
                        .onSuccess { Toast.makeText(this@MainActivity, "Đã cập nhật ${it.status.label}", Toast.LENGTH_SHORT).show(); onDone() }
                        .onFailure { Toast.makeText(this@MainActivity, it.message, Toast.LENGTH_LONG).show() }
                }
            }.setNegativeButton("ĐÓNG", null).show()
    }

    private fun showAdmin() {
        val root = replace(R.layout.view_admin)
        val status = root.findViewById<TextView>(R.id.tvAdminStatus)
        val ack = root.findViewById<EditText>(R.id.etAckMinutes)
        val reminder = root.findViewById<EditText>(R.id.etReminderMinutes)
        val skip = root.findViewById<EditText>(R.id.etSkipMinutes)
        val replenish = root.findViewById<EditText>(R.id.etReplenishMinutes)
        lifecycleScope.launch {
            runCatching { app.repository.getConfig() }.onSuccess {
                ack.setText(it.acknowledgeMinutes.toString()); reminder.setText(it.reminderMinutes.toString())
                skip.setText(it.skipMinutes.toString()); replenish.setText(it.replenishMinutes.toString())
            }.onFailure { status.text = it.message }
        }
        root.findViewById<Button>(R.id.btnSaveConfig).setOnClickListener {
            val config = AppConfig(
                ack.text.toString().toIntOrNull() ?: 15,
                reminder.text.toString().toIntOrNull() ?: 5,
                skip.text.toString().toIntOrNull() ?: 30,
                replenish.text.toString().toIntOrNull() ?: 15
            )
            if (listOf(config.acknowledgeMinutes, config.reminderMinutes, config.skipMinutes, config.replenishMinutes).any { it !in 1..480 }) {
                status.text = "Mỗi mốc phải từ 1 đến 480 phút"; return@setOnClickListener
            }
            status.text = "Đang lưu cấu hình…"
            lifecycleScope.launch {
                runCatching { app.repository.saveConfig(config) }
                    .onSuccess { status.text = "✓ Đã lưu cấu hình SLA" }
                    .onFailure { status.text = it.message }
            }
        }
        root.findViewById<Button>(R.id.btnImportSku).setOnClickListener { chooseSku.launch("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") }
        root.findViewById<Button>(R.id.btnImportUsers).setOnClickListener { chooseUsers.launch("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") }
        root.findViewById<Button>(R.id.btnDownloadUserTemplate).setOnClickListener { saveTemplate.launch("MAU_NHAN_SU_BAO_HANG_1291.xlsx") }
        root.findViewById<Button>(R.id.btnSyncSheet).setOnClickListener {
            status.text = "Đang đồng bộ Google Sheet…"
            lifecycleScope.launch {
                runCatching { app.repository.syncGoogleSheet() }
                    .onSuccess { status.text = "✓ Đã yêu cầu đồng bộ Google Sheet" }
                    .onFailure { status.text = it.message }
            }
        }
        root.findViewById<Button>(R.id.btnOpenInventQueue).setOnClickListener { showInvent() }
    }

    private fun importSkuFile(uri: Uri) {
        val status = findViewById<TextView>(R.id.tvAdminStatus)
        status.text = "Đang đọc file SKU…"
        lifecycleScope.launch {
            runCatching {
                val items = withContext(Dispatchers.IO) { XlsxImporter(contentResolver).parseSkuFile(uri) }
                var imported = 0
                items.chunked(1000).forEach { batch -> app.repository.importSkus(batch); imported += batch.size; status.text = "Đã đồng bộ $imported/${items.size} SKU…" }
                withContext(Dispatchers.IO) { app.repository.syncCatalog() }
                items.size
            }.onSuccess { status.text = "✓ Hoàn tất $it SKU; SKU trùng đã được gộp" }
                .onFailure { status.text = "Lỗi: ${it.message}" }
        }
    }

    private fun importUserFile(uri: Uri) {
        val status = findViewById<TextView>(R.id.tvAdminStatus)
        status.text = "Đang đọc file nhân sự…"
        lifecycleScope.launch {
            runCatching {
                val items = withContext(Dispatchers.IO) { XlsxImporter(contentResolver).parseUserFile(uri) }
                var imported = 0
                items.chunked(200).forEach { batch ->
                    val result = app.repository.importUsers(batch)
                    if (result.optInt("failed", 0) > 0) {
                        val errors = result.optJSONArray("errors")
                        val first = if (errors != null && errors.length() > 0) errors.optString(0) else "Dữ liệu không hợp lệ"
                        error("${result.optInt("failed")} dòng lỗi. $first")
                    }
                    imported += batch.size
                    status.text = "Đã đồng bộ $imported/${items.size} nhân sự…"
                }
                items.size
            }.onSuccess { status.text = "✓ Hoàn tất $it nhân sự; mật khẩu chỉ áp dụng cho tài khoản mới" }
                .onFailure { status.text = "Lỗi: ${it.message}" }
        }
    }

    private fun writeTemplate(uri: Uri) {
        runCatching {
            contentResolver.openOutputStream(uri)?.use { output ->
                resources.openRawResource(R.raw.mau_nhan_su_bao_hang_1291).use { it.copyTo(output) }
            } ?: error("Không ghi được file")
        }.onSuccess { Toast.makeText(this, "Đã lưu file nhân sự mẫu", Toast.LENGTH_LONG).show() }
            .onFailure { Toast.makeText(this, it.message, Toast.LENGTH_LONG).show() }
    }
}
