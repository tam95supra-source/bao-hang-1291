from pathlib import Path
import re

ROOT=Path('.')
def rd(path): return (ROOT/path).read_text(encoding='utf-8')
def wr(path,text): (ROOT/path).write_text(text,encoding='utf-8')
def once(text,old,new,label):
    count=text.count(old)
    if count!=1: raise SystemExit(f'{label}: expected 1 anchor, got {count}')
    return text.replace(old,new,1)
def brace_end(text,open_index):
    depth=0; quote=None; escape=False; line=False; block=False; i=open_index
    while i < len(text):
        c=text[i]; n=text[i+1] if i+1 < len(text) else ''
        if line:
            if c=='\n': line=False
            i+=1; continue
        if block:
            if c=='*' and n=='/': block=False; i+=2; continue
            i+=1; continue
        if quote:
            if escape: escape=False
            elif c=='\\': escape=True
            elif c==quote: quote=None
            i+=1; continue
        if c=='/' and n=='/': line=True; i+=2; continue
        if c=='/' and n=='*': block=True; i+=2; continue
        if c in ('"',"'",'`'): quote=c; i+=1; continue
        if c=='{': depth+=1
        elif c=='}':
            depth-=1
            if depth==0: return i+1
        i+=1
    raise SystemExit('Unbalanced braces')
def replace_function(text,name,new_text):
    patterns=[f'    private fun {name}(',f'    private suspend fun {name}(',f'    suspend fun {name}(',f'    fun {name}(']
    starts=[text.find(p) for p in patterns if text.find(p)>=0]
    if not starts: raise SystemExit(f'Function not found: {name}')
    start=min(starts); opening=text.find('{',start); end=brace_end(text,opening)
    return text[:start]+new_text+text[end:]
def remove_function(text,name):
    try:
        patterns=[f'    private fun {name}(',f'    private suspend fun {name}(',f'    suspend fun {name}(',f'    fun {name}(']
        starts=[text.find(p) for p in patterns if text.find(p)>=0]
        if not starts:return text
        start=min(starts); opening=text.find('{',start); end=brace_end(text,opening)
        while end<len(text) and text[end] in '\r\n': end+=1
        return text[:start]+text[end:]
    except Exception: raise

def replace_class_block(text,start_marker,end_marker,new_text,label):
    a=text.find(start_marker); b=text.find(end_marker,a+len(start_marker)) if a>=0 else -1
    if a<0 or b<0: raise SystemExit(f'{label}: block anchors missing')
    return text[:a]+new_text+text[b:]

# ---- Models ----
p=Path('app/src/main/java/vn/pickpack1291/baohang/data/Models.kt'); s=rd(p)
s=s.replace('    val canSeeExactInventory: Boolean get() = this != PICKER\n','')
s=s.replace('AVAILABLE("AVAILABLE", "ĐÃ CÓ HÀNG / CHÂM BÙ", true),','AVAILABLE("AVAILABLE", "ĐÃ CÓ HÀNG • QUAY LẠI LẤY HÀNG", true),')
s=s.replace('SKIP_ALLOWED("SKIP_ALLOWED", "ĐƯỢC PHÉP SKIP", true),','SKIP_ALLOWED("SKIP_ALLOWED", "CHO PHÉP SKIP • TIẾP TỤC CÔNG VIỆC", true),')
s=once(s,'    val role: UserRole,\n    val active: Boolean = true\n) {','    val role: UserRole,\n    val active: Boolean = true,\n    val sourceKind: String = "MANUAL",\n    val sourcePosition: String = "",\n    val protectedAccount: Boolean = false\n) {','profile fields')
s=once(s,'            role = UserRole.from(json.optString("role")),\n            active = json.optBoolean("active", true)\n        )','            role = UserRole.from(json.optString("role")),\n            active = json.optBoolean("active", true),\n            sourceKind = json.optString("source_kind", "MANUAL"),\n            sourcePosition = json.optString("source_position"),\n            protectedAccount = json.optBoolean("protected_account", false)\n        )','profile parse')
start=s.index('data class OperationalConfig('); end=s.index('\ndata class ReportResult(',start)
config_block="""data class OperationalConfig(
    val acknowledgeMinutes: Int = 15,
    val reminderMinutes: Int = 5,
    val replenishMinutes: Int = 15,
    val pickerAckReminderMinutes: Int = 3,
    val autoSkipEnabled: Boolean = false,
    val autoSkipAfterMinutes: Int = 120
) {
    fun toJson() = JSONObject()
        .put("acknowledge_minutes", acknowledgeMinutes)
        .put("reminder_minutes", reminderMinutes)
        .put("replenish_minutes", replenishMinutes)
        .put("picker_ack_reminder_minutes", pickerAckReminderMinutes)
        .put("auto_skip_enabled", autoSkipEnabled)
        .put("auto_skip_after_minutes", autoSkipAfterMinutes)
    companion object {
        fun fromJson(json: JSONObject) = OperationalConfig(
            acknowledgeMinutes = json.optInt("acknowledge_minutes", 15),
            reminderMinutes = json.optInt("reminder_minutes", 5),
            replenishMinutes = json.optInt("replenish_minutes", 15),
            pickerAckReminderMinutes = json.optInt("picker_ack_reminder_minutes", 3),
            autoSkipEnabled = json.optBoolean("auto_skip_enabled", false),
            autoSkipAfterMinutes = json.optInt("auto_skip_after_minutes", 120)
        )
    }
}

data class AppConfig(
    val acknowledgeMinutes: Int = 15,
    val reminderMinutes: Int = 5,
    val replenishMinutes: Int = 15,
    val pickerAckReminderMinutes: Int = 3,
    val diagnosticLogRetentionDays: Int = 14,
    val retentionDays: Int = 60,
    val autoSkipEnabled: Boolean = false,
    val autoSkipAfterMinutes: Int = 120,
    val staffAutoSyncEnabled: Boolean = true,
    val staffSyncIntervalMinutes: Int = 60
) {
    fun toJson() = JSONObject()
        .put("acknowledge_minutes", acknowledgeMinutes)
        .put("reminder_minutes", reminderMinutes)
        .put("replenish_minutes", replenishMinutes)
        .put("picker_ack_reminder_minutes", pickerAckReminderMinutes)
        .put("diagnostic_log_retention_days", diagnosticLogRetentionDays)
        .put("retention_days", retentionDays)
        .put("auto_skip_enabled", autoSkipEnabled)
        .put("auto_skip_after_minutes", autoSkipAfterMinutes)
        .put("staff_auto_sync_enabled", staffAutoSyncEnabled)
        .put("staff_sync_interval_minutes", staffSyncIntervalMinutes)
    companion object {
        fun fromJson(json: JSONObject) = AppConfig(
            acknowledgeMinutes = json.optInt("acknowledge_minutes", 15),
            reminderMinutes = json.optInt("reminder_minutes", 5),
            replenishMinutes = json.optInt("replenish_minutes", 15),
            pickerAckReminderMinutes = json.optInt("picker_ack_reminder_minutes", 3),
            diagnosticLogRetentionDays = json.optInt("diagnostic_log_retention_days", 14),
            retentionDays = json.optInt("retention_days", 60),
            autoSkipEnabled = json.optBoolean("auto_skip_enabled", false),
            autoSkipAfterMinutes = json.optInt("auto_skip_after_minutes", 120),
            staffAutoSyncEnabled = json.optBoolean("staff_auto_sync_enabled", true),
            staffSyncIntervalMinutes = json.optInt("staff_sync_interval_minutes", 60)
        )
    }
}
"""
s=s[:start]+config_block+s[end:]
wr(p,s)

# ---- Local catalog DB ----
p=Path('app/src/main/java/vn/pickpack1291/baohang/data/AppDatabase.kt'); s=rd(p)
s=once(s,'    fun skuCount(): Int = readableDatabase.rawQuery("SELECT COUNT(*) FROM sku_catalog", null).use { if (it.moveToFirst()) it.getInt(0) else 0 }','    fun skuCount(): Int = readableDatabase.rawQuery("SELECT COUNT(*) FROM sku_catalog", null).use { if (it.moveToFirst()) it.getInt(0) else 0 }\n    fun clearSkus() { writableDatabase.delete("sku_catalog", null, null) }','db clear')
wr(p,s)

# ---- ApiClient ----
p=Path('app/src/main/java/vn/pickpack1291/baohang/network/ApiClient.kt'); s=rd(p)
s=s.replace('import vn.pickpack1291.baohang.data.InventoryStatus\n','')
s=s.replace('    data class CatalogPage(val items: List<SkuItem>, val hasMore: Boolean, val syncUntil: String)','    data class CatalogPage(val items: List<SkuItem>, val hasMore: Boolean, val syncUntil: String, val revision: Long)')
s=once(s,'        return CatalogPage(result, response.optBoolean("has_more", result.size == limit), response.getString("sync_until"))','        return CatalogPage(result, response.optBoolean("has_more", result.size == limit), response.getString("sync_until"), response.optLong("catalog_revision", 1L))','catalog page')
s=re.sub(r'\n    suspend fun inventoryStatus\(sku: String\): InventoryStatus = InventoryStatus\.fromJson\(\n        invoke\("inventory-status", JSONObject\(\)\.put\("sku", sku\)\)\n    \)\n','\n',s)
anchor="""    suspend fun importSkus(items: List<SkuItem>): JSONObject {
        val array = JSONArray()
        items.forEach { array.put(JSONObject().put("sku", it.sku).put("product_name", it.productName)) }
        return invoke("import-skus", JSONObject().put("items", array))
    }
"""
replacement=anchor+"""
    suspend fun replaceCatalog(items: List<SkuItem>, sourceName: String): JSONObject {
        val array = JSONArray()
        items.forEach { array.put(JSONObject().put("sku", it.sku).put("product_name", it.productName)) }
        return invoke("replace-catalog", JSONObject().put("items", array).put("source_name", sourceName))
    }
"""
s=once(s,anchor,replacement,'api replace catalog')
s=s.replace('&select=id,employee_code,full_name,contractor,role,active','&select=id,employee_code,full_name,contractor,role,active,source_kind,source_position,protected_account')
wr(p,s)

# ---- Repository ----
p=Path('app/src/main/java/vn/pickpack1291/baohang/data/AppRepository.kt'); s=rd(p)
s=re.sub(r'\n    suspend fun inventoryStatus\(sku: String\): InventoryStatus = api\.inventoryStatus\(sku\)\n','\n',s)
s=replace_function(s,'syncCatalog',"""    suspend fun syncCatalog(onPage: ((count: Int) -> Unit)? = null): Int {
        var syncUntil: String? = null
        var afterSku: String? = null
        var count = 0
        var revision: Long? = null
        var hasMore = true
        diagnostics.info("catalog_sync_start", mapOf("mode" to "active_full"))
        while (hasMore) {
            val page = api.catalogPage(afterSku, null, syncUntil)
            syncUntil = page.syncUntil
            if (revision == null) {
                revision = page.revision
                val localRevision = database.metadata("catalog_revision")?.toLongOrNull()
                if (localRevision != page.revision) database.clearSkus()
            }
            database.upsertSkus(page.items)
            count += page.items.size
            afterSku = page.items.lastOrNull()?.sku ?: afterSku
            onPage?.invoke(count)
            hasMore = page.hasMore && page.items.isNotEmpty()
        }
        syncUntil?.let { database.setMetadata("catalog_last_sync", it) }
        revision?.let { database.setMetadata("catalog_revision", it.toString()) }
        diagnostics.info("catalog_sync_success", mapOf("received" to count, "local_count" to database.skuCount(), "revision" to (revision ?: 0L)))
        return count
    }""")
s=once(s,'    suspend fun importSkus(items: List<SkuItem>) = api.importSkus(items)','    suspend fun importSkus(items: List<SkuItem>) = api.importSkus(items)\n\n    suspend fun replaceCatalog(items: List<SkuItem>, sourceName: String): JSONObject {\n        val result = api.replaceCatalog(items, sourceName)\n        database.clearSkus()\n        database.setMetadata("catalog_revision", "0")\n        syncCatalog()\n        return result\n    }','repo replace')
wr(p,s)

# ---- Realtime foreground ----
p=Path('app/src/main/java/vn/pickpack1291/baohang/realtime/RealtimeClient.kt'); s=rd(p)
s=s.replace('    private val onInventoryChanged: () -> Unit,','    private val onCatalogChanged: () -> Unit,\n    private val onStaffChanged: () -> Unit,')
s=s.replace('            join(webSocket, INVENTORY_TOPIC)','            join(webSocket, CATALOG_TOPIC)\n            join(webSocket, STAFF_TOPIC)')
s=s.replace('                        topic == INVENTORY_TOPIC && payload.optString("event") == "snapshot_published" -> onInventoryChanged()','                        topic == CATALOG_TOPIC && payload.optString("event") == "catalog_changed" -> onCatalogChanged()\n                        topic == STAFF_TOPIC && payload.optString("event") == "staff_changed" -> onStaffChanged()')
s=s.replace('        private const val INVENTORY_TOPIC = "realtime:site:1291:inventory"','        private const val CATALOG_TOPIC = "realtime:site:1291:catalog"\n        private const val STAFF_TOPIC = "realtime:site:1291:staff"')
wr(p,s)

# ---- XLSX: SKU/name only ----
p=Path('app/src/main/java/vn/pickpack1291/baohang/importer/XlsxImporter.kt'); s=rd(p)
s=s.replace('import vn.pickpack1291.baohang.data.InventoryImportRow\n','')
s=s.replace('val nameColumn = findHeader(headers, "ten san pham", "ten hang", "product name")','val nameColumn = findHeader(headers, "ten sku", "sku name", "ten san pham", "ten hang", "product name")')
s=remove_function(s,'parseInventoryFile')
s=remove_function(s,'parseNonNegative')
wr(p,s)
Path('app/src/main/java/vn/pickpack1291/baohang/data/InventoryImportRow.kt').unlink(missing_ok=True)

# ---- Back button layout ----
p=Path('app/src/main/res/layout/activity_main.xml'); s=rd(p)
needle='''        <ImageView
            android:layout_width="42dp"'''
back='''        <TextView
            android:id="@+id/btnBack"
            android:layout_width="44dp"
            android:layout_height="44dp"
            android:gravity="center"
            android:text="‹"
            android:textColor="@color/white"
            android:textSize="34sp"
            android:textStyle="bold"
            android:visibility="gone" />

        <ImageView
            android:layout_width="42dp"'''
s=once(s,needle,back,'back layout')
wr(p,s)

# ---- Alert appearance ----
Path('app/src/main/res/drawable/bg_overlay_available.xml').write_text('''<?xml version="1.0" encoding="utf-8"?>\n<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle"><solid android:color="#0B6B3A"/><corners android:radius="18dp"/><stroke android:width="1dp" android:color="#42D392"/><padding android:left="16dp" android:top="16dp" android:right="16dp" android:bottom="16dp"/></shape>\n''',encoding='utf-8')
Path('app/src/main/res/drawable/bg_overlay_skip.xml').write_text('''<?xml version="1.0" encoding="utf-8"?>\n<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle"><solid android:color="#9E221C"/><corners android:radius="18dp"/><stroke android:width="1dp" android:color="#F06A62"/><padding android:left="16dp" android:top="16dp" android:right="16dp" android:bottom="16dp"/></shape>\n''',encoding='utf-8')
p=Path('app/src/main/res/layout/overlay_alert.xml'); s=rd(p)
s=s.replace('android:textSize="20sp"','android:textSize="24sp"').replace('android:textSize="29sp"','android:textSize="32sp"').replace('android:textSize="15sp"','android:textSize="17sp"').replace('android:textSize="16sp"','android:textSize="18sp"')
s=s.replace('android:text="ĐÃ HIỂU"','android:text="ĐÃ XÁC NHẬN"').replace('android:text="Chạm vùng trống để ẩn"','android:text="Cảnh báo nghiệp vụ • vui lòng xác nhận"')
wr(p,s)

# ---- FCM final-state only ----
p=Path('app/src/main/java/vn/pickpack1291/baohang/notifications/StockMessagingService.kt'); s=rd(p)
anchor='        val status = data["status"].orEmpty()\n'
s=once(s,anchor,anchor+'        if (status !in setOf("AVAILABLE", "SKIP_ALLOWED")) {\n            app.diagnostics.info("picker_notification_suppressed", mapOf("status" to status))\n            return\n        }\n','fcm final guard')
s=s.replace('val canClaim = status == "OPEN" && app.session.effectiveRole in setOf(UserRole.ADMIN, UserRole.ADMIN_INVENT, UserRole.INVENT)','val canClaim = false')
wr(p,s)

# ---- Overlay final-state only ----
p=Path('app/src/main/java/vn/pickpack1291/baohang/notifications/OverlayAlertService.kt'); s=rd(p)
anchor='        val status = IssueStatus.from(intent.getStringExtra(EXTRA_STATUS))\n'
s=once(s,anchor,anchor+'        if (status !in setOf(IssueStatus.AVAILABLE, IssueStatus.SKIP_ALLOWED)) { dismiss(); return }\n','overlay final guard')
s=s.replace('val critical = intent.getBooleanExtra(EXTRA_CRITICAL, status.criticalForPicker)','val critical = true')
s=s.replace('val canClaim = intent.getBooleanExtra(EXTRA_CAN_CLAIM, false) && issueId.isNotBlank()','val canClaim = false')
s=s.replace('view.setBackgroundResource(if (critical) R.drawable.bg_overlay_critical else R.drawable.bg_overlay_info)','view.setBackgroundResource(if (status == IssueStatus.AVAILABLE) R.drawable.bg_overlay_available else R.drawable.bg_overlay_skip)')
s=s.replace('view.findViewById<TextView>(R.id.tvOverlayStatus).text = status.label','view.findViewById<TextView>(R.id.tvOverlayStatus).text = if (status == IssueStatus.AVAILABLE) "ĐÃ CÓ HÀNG • QUAY LẠI LẤY HÀNG" else "CHO PHÉP SKIP • TIẾP TỤC CÔNG VIỆC"')
s=s.replace('ack.visibility = if (critical || canClaim) View.VISIBLE else View.GONE','ack.visibility = View.VISIBLE')
s=s.replace('hint.visibility = if (critical) View.GONE else View.VISIBLE','hint.visibility = View.VISIBLE')
s=s.replace('ack.text = "ĐÃ HIỂU"','ack.text = "ĐÃ XÁC NHẬN"')
s=s.replace('val height = (resources.displayMetrics.heightPixels * if (critical) 0.40 else 0.34).toInt()','val height = (resources.displayMetrics.heightPixels * 0.40).toInt()')
wr(p,s)

# ---- MainActivity ----
p=Path('app/src/main/java/vn/pickpack1291/baohang/ui/MainActivity.kt'); s=rd(p)
s=once(s,'import androidx.activity.result.contract.ActivityResultContracts','import androidx.activity.OnBackPressedCallback\nimport androidx.activity.result.contract.ActivityResultContracts','back import')
s=s.replace('import vn.pickpack1291.baohang.data.InventoryImportRow\n','').replace('import vn.pickpack1291.baohang.data.InventoryStatus\n','').replace('import java.time.Instant\n','').replace('import java.util.UUID\n','')
old_rt='''            onInventoryChanged = {
                runOnUiThread { if (currentScreen == SCREEN_INVENTORY) showInventory() }
            },'''
new_rt='''            onCatalogChanged = {
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
            },'''
s=once(s,old_rt,new_rt,'realtime callbacks')
s=s.replace('    private val chooseUsers = registerForActivityResult(ActivityResultContracts.GetContent()) { uri -> uri?.let(::importUserFile) }\n','')
s=s.replace('    private val chooseInventory = registerForActivityResult(ActivityResultContracts.GetContent()) { uri -> uri?.let(::importInventoryFile) }\n','')
s=s.replace('    private val saveTemplate = registerForActivityResult(ActivityResultContracts.CreateDocument(XLSX_MIME)) { uri -> uri?.let(::writeTemplate) }\n','')
s=once(s,'        container = findViewById(R.id.contentContainer)','''        container = findViewById(R.id.contentContainer)
        findViewById<TextView>(R.id.btnBack).setOnClickListener { navigateBack() }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { if (isRoleRoot()) finish() else renderForRole() }
        })''','back onCreate')
s=once(s,'        currentScreen = screen\n        container.removeAllViews()','        currentScreen = screen\n        container.removeAllViews()\n        updateBackButton()','page back')

s=replace_function(s,'showAdmin',"""    private fun showAdmin() {
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
    }""")
s=replace_function(s,'showAdminEvent',"""    private fun showAdminEvent() {
        val content = page("ADMIN EVENT", SCREEN_MENU)
        content.addView(button("SỰ KIỆN / ĐIỀU PHỐI") { showInventBoard() })
        content.addView(button("DANH MỤC SKU / TÊN HÀNG") { showCatalog() })
        content.addView(button("BÁO CÁO VẬN HÀNH") { showReports() })
        content.addView(button("NHÂN SỰ") { showUsers() })
        content.addView(button("MỐC THỜI GIAN VẬN HÀNH") { showOperationalSla() })
        content.addView(button("HỆ THỐNG & DUNG LƯỢNG") { showServiceMetrics() })
        addDiagnosticsButton(content)
    }""")
s=s.replace('        card.addView(button("XEM TỒN SNAPSHOT") { showInventoryForSku(issue.sku) })\n','')

s=replace_function(s,'showPicker',"""    private fun showPicker() {
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
    }""")

for name in ['pickerInventoryText','showInventory','showInventoryForSku','inventoryText','startSupraSync','importInventoryFile']:
    s=remove_function(s,name)

catalog_fn="""    private fun showCatalog() {
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

"""
insert=s.find('    private fun showReports()')
if insert<0: raise SystemExit('showReports insertion anchor missing')
s=s[:insert]+catalog_fn+s[insert:]

s=replace_function(s,'showReports',"""    private fun showReports() {
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
    }""")

s=replace_function(s,'showOperationalSla',"""    private fun showOperationalSla() {
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
    }""")

s=replace_function(s,'showConfig',"""    private fun showConfig() {
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
    }""")

s=replace_function(s,'showUsers',"""    private fun showUsers() {
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
    }""")
s=s.replace('            else -> listOf(UserRole.INVENT, UserRole.PICKER)','            else -> listOf(UserRole.PICKER)')

s=replace_function(s,'importSkuFile',"""    private fun importSkuFile(uri: Uri) {
        lifecycleScope.launch {
            toast("Đang đọc SKU và tên sản phẩm…")
            runCatching {
                val items = withContext(Dispatchers.IO) { XlsxImporter(contentResolver).parseSkuFile(uri) }
                app.repository.replaceCatalog(items, "Tồn Bin XLSX")
                items.size
            }.onSuccess { toast("Đã thay danh mục bằng $it SKU / tên sản phẩm"); showCatalog() }.onFailure { toast("Lỗi: ${it.message}") }
        }
    }""")
s=remove_function(s,'importUserFile'); s=remove_function(s,'writeTemplate')

helper="""    private fun createExtraUser(refresh: () -> Unit) {
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

"""
anchor='    private suspend fun checkPendingAlerts() {'
if s.count(anchor)!=1: raise SystemExit('pending helper anchor missing')
s=s.replace(anchor,helper+anchor,1)
s=s.replace('            val alert = alerts.firstOrNull() ?: return@onSuccess','            val alert = alerts.firstOrNull { it.status in setOf(IssueStatus.AVAILABLE, IssueStatus.SKIP_ALLOWED) } ?: return@onSuccess')
s=s.replace('.setPositiveButton("ĐÃ HIỂU")','.setPositiveButton("ĐÃ XÁC NHẬN")')
s=s.replace('        private const val SCREEN_INVENTORY = "inventory"\n','        private const val SCREEN_CATALOG = "catalog"\n        private const val SCREEN_SERVICES = "services"\n')
for marker in ['inventory-sync-start','showInventory()','inventoryStatus(','TỒN SNAPSHOT','SCREEN_INVENTORY']:
    if marker in s: raise SystemExit(f'Legacy Android marker remains: {marker}')
wr(p,s)

print('ANDROID_V13_CLEAN_PATCH_OK')
