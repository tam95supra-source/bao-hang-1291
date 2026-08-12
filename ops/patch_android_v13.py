from pathlib import Path
import re
ROOT=Path('.')
def read(p): return (ROOT/p).read_text(encoding='utf-8')
def write(p,s): (ROOT/p).write_text(s,encoding='utf-8')
def once(s,old,new,label):
    if s.count(old)!=1: raise SystemExit(f'{label}: expected 1, got {s.count(old)}')
    return s.replace(old,new,1)
def brace_end(s,o):
    d=0;q=None;esc=False;line=False;block=False;i=o
    while i<len(s):
        c=s[i];n=s[i+1] if i+1<len(s) else ''
        if line:
            if c=='\n':line=False
            i+=1;continue
        if block:
            if c=='*' and n=='/':block=False;i+=2;continue
            i+=1;continue
        if q:
            if esc:esc=False
            elif c=='\\':esc=True
            elif c==q:q=None
            i+=1;continue
        if c=='/' and n=='/':line=True;i+=2;continue
        if c=='/' and n=='*':block=True;i+=2;continue
        if c in ('"',"'",'`'):q=c;i+=1;continue
        if c=='{':d+=1
        elif c=='}':
            d-=1
            if d==0:return i+1
        i+=1
    raise SystemExit('unbalanced')
def replfn(s,name,new):
    pats=[f'    private fun {name}(',f'    private suspend fun {name}(',f'    suspend fun {name}(',f'    fun {name}(']
    starts=[s.find(x) for x in pats if s.find(x)>=0]
    if not starts: raise SystemExit(f'missing function {name}')
    st=min(starts);o=s.find('{',st);en=brace_end(s,o);return s[:st]+new+s[en:]
def removefn(s,name):
    pats=[f'    private fun {name}(',f'    private suspend fun {name}(',f'    suspend fun {name}(',f'    fun {name}(']
    starts=[s.find(x) for x in pats if s.find(x)>=0]
    if not starts:return s
    st=min(starts);o=s.find('{',st);en=brace_end(s,o)
    while en<len(s) and s[en] in '\r\n':en+=1
    return s[:st]+s[en:]

# Models: source ownership, auto skip/staff sync config; remove quantity inventory model.
p=Path('app/src/main/java/vn/pickpack1291/baohang/data/Models.kt');s=read(p)
s=s.replace('    val canSeeExactInventory: Boolean get() = this != PICKER\n','')
s=once(s,'    val active: Boolean = true\n) {','    val active: Boolean = true,\n    val sourceKind: String = "MANUAL",\n    val sourcePosition: String = "",\n    val protectedAccount: Boolean = false\n) {','profile fields')
s=once(s,'            active = json.optBoolean("active", true)\n        )','            active = json.optBoolean("active", true),\n            sourceKind = json.optString("source_kind", "MANUAL"),\n            sourcePosition = json.optString("source_position"),\n            protectedAccount = json.optBoolean("protected_account", false)\n        )','profile parse')
start=s.index('data class OperationalConfig('); end=s.index('\ndata class ReportResult(',start)
new_models=r'''data class OperationalConfig(
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
            acknowledgeMinutes=json.optInt("acknowledge_minutes",15), reminderMinutes=json.optInt("reminder_minutes",5),
            replenishMinutes=json.optInt("replenish_minutes",15), pickerAckReminderMinutes=json.optInt("picker_ack_reminder_minutes",3),
            autoSkipEnabled=json.optBoolean("auto_skip_enabled",false), autoSkipAfterMinutes=json.optInt("auto_skip_after_minutes",120)
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
        .put("acknowledge_minutes", acknowledgeMinutes).put("reminder_minutes", reminderMinutes)
        .put("replenish_minutes", replenishMinutes).put("picker_ack_reminder_minutes", pickerAckReminderMinutes)
        .put("diagnostic_log_retention_days", diagnosticLogRetentionDays).put("retention_days", retentionDays)
        .put("auto_skip_enabled", autoSkipEnabled).put("auto_skip_after_minutes", autoSkipAfterMinutes)
        .put("staff_auto_sync_enabled", staffAutoSyncEnabled).put("staff_sync_interval_minutes", staffSyncIntervalMinutes)
    companion object {
        fun fromJson(json: JSONObject) = AppConfig(
            acknowledgeMinutes=json.optInt("acknowledge_minutes",15), reminderMinutes=json.optInt("reminder_minutes",5),
            replenishMinutes=json.optInt("replenish_minutes",15), pickerAckReminderMinutes=json.optInt("picker_ack_reminder_minutes",3),
            diagnosticLogRetentionDays=json.optInt("diagnostic_log_retention_days",14), retentionDays=json.optInt("retention_days",60),
            autoSkipEnabled=json.optBoolean("auto_skip_enabled",false), autoSkipAfterMinutes=json.optInt("auto_skip_after_minutes",120),
            staffAutoSyncEnabled=json.optBoolean("staff_auto_sync_enabled",true), staffSyncIntervalMinutes=json.optInt("staff_sync_interval_minutes",60)
        )
    }
}
'''
s=s[:start]+new_models+s[end:]
write(p,s)

# Local catalog replacement support.
p=Path('app/src/main/java/vn/pickpack1291/baohang/data/AppDatabase.kt');s=read(p)
s=once(s,'    fun skuCount(): Int = readableDatabase.rawQuery("SELECT COUNT(*) FROM sku_catalog", null).use { if (it.moveToFirst()) it.getInt(0) else 0 }','    fun skuCount(): Int = readableDatabase.rawQuery("SELECT COUNT(*) FROM sku_catalog", null).use { if (it.moveToFirst()) it.getInt(0) else 0 }\n    fun clearSkus() { writableDatabase.delete("sku_catalog", null, null) }','clear skus')
write(p,s)

# API client catalog revision/replace; quantity inventory endpoint retired.
p=Path('app/src/main/java/vn/pickpack1291/baohang/network/ApiClient.kt');s=read(p)
s=s.replace('import vn.pickpack1291.baohang.data.InventoryStatus\n','')
s=s.replace('    data class CatalogPage(val items: List<SkuItem>, val hasMore: Boolean, val syncUntil: String)','    data class CatalogPage(val items: List<SkuItem>, val hasMore: Boolean, val syncUntil: String, val revision: Long)')
s=once(s,'        return CatalogPage(result, response.optBoolean("has_more", result.size == limit), response.getString("sync_until"))','        return CatalogPage(result, response.optBoolean("has_more", result.size == limit), response.getString("sync_until"), response.optLong("catalog_revision", 1))','catalog page')
s=re.sub(r'\n    suspend fun inventoryStatus\(sku: String\): InventoryStatus = InventoryStatus\.fromJson\(\n        invoke\("inventory-status", JSONObject\(\)\.put\("sku", sku\)\)\n    \)\n','\n',s)
anchor='''    suspend fun importSkus(items: List<SkuItem>): JSONObject {
        val array = JSONArray()
        items.forEach { array.put(JSONObject().put("sku", it.sku).put("product_name", it.productName)) }
        return invoke("import-skus", JSONObject().put("items", array))
    }'''
replacement=anchor+r'''

    suspend fun replaceCatalog(items: List<SkuItem>, sourceName: String): JSONObject {
        val array = JSONArray()
        items.forEach { array.put(JSONObject().put("sku", it.sku).put("product_name", it.productName)) }
        return invoke("replace-catalog", JSONObject().put("items", array).put("source_name", sourceName))
    }'''
s=once(s,anchor,replacement,'replace catalog api')
write(p,s)

# Repository: full active catalog revision and no inventory status.
p=Path('app/src/main/java/vn/pickpack1291/baohang/data/AppRepository.kt');s=read(p)
s=re.sub(r'\n    suspend fun inventoryStatus\(sku: String\): InventoryStatus = api\.inventoryStatus\(sku\)\n','\n',s)
s=replfn(s,'syncCatalog',r'''    suspend fun syncCatalog(onPage: ((count: Int) -> Unit)? = null): Int {
        var syncUntil:String?=null;var count=0;var afterSku:String?=null;var hasMore=true;var revision:Long?=null;var cleared=false
        diagnostics.info("catalog_sync_start",mapOf("mode" to "active_full"))
        while(hasMore){
            val page=api.catalogPage(afterSku,null,syncUntil);syncUntil=page.syncUntil
            if(revision==null){revision=page.revision;val local=database.metadata("catalog_revision")?.toLongOrNull();if(local!=page.revision){database.clearSkus();cleared=true}}
            database.upsertSkus(page.items);count+=page.items.size;afterSku=page.items.lastOrNull()?.sku?:afterSku;onPage?.invoke(count);hasMore=page.hasMore&&page.items.isNotEmpty()
        }
        syncUntil?.let{database.setMetadata("catalog_last_sync",it)};revision?.let{database.setMetadata("catalog_revision",it.toString())}
        diagnostics.info("catalog_sync_success",mapOf("received" to count,"local_count" to database.skuCount(),"revision" to (revision?:0),"replaced" to cleared));return count
    }''')
s=once(s,'    suspend fun importSkus(items: List<SkuItem>) = api.importSkus(items)','    suspend fun importSkus(items: List<SkuItem>) = api.importSkus(items)\n    suspend fun replaceCatalog(items: List<SkuItem>, sourceName: String) = api.replaceCatalog(items, sourceName).also { database.clearSkus(); database.setMetadata("catalog_revision", "0"); syncCatalog() }','repo replace')
write(p,s)

# Realtime foreground: issue + catalog + staff only.
p=Path('app/src/main/java/vn/pickpack1291/baohang/realtime/RealtimeClient.kt');s=read(p)
s=s.replace('    private val onInventoryChanged: () -> Unit,','    private val onCatalogChanged: () -> Unit,\n    private val onStaffChanged: () -> Unit,')
s=s.replace('            join(webSocket, INVENTORY_TOPIC)','            join(webSocket, CATALOG_TOPIC)\n            join(webSocket, STAFF_TOPIC)')
s=s.replace('                        topic == INVENTORY_TOPIC && payload.optString("event") == "snapshot_published" -> onInventoryChanged()','                        topic == CATALOG_TOPIC && payload.optString("event") == "catalog_changed" -> onCatalogChanged()\n                        topic == STAFF_TOPIC && payload.optString("event") == "staff_changed" -> onStaffChanged()')
s=s.replace('        private const val INVENTORY_TOPIC = "realtime:site:1291:inventory"','        private const val CATALOG_TOPIC = "realtime:site:1291:catalog"\n        private const val STAFF_TOPIC = "realtime:site:1291:staff"')
write(p,s)

# XLSX: SKU/name only; support Tên SKU aliases and remove quantity parser.
p=Path('app/src/main/java/vn/pickpack1291/baohang/importer/XlsxImporter.kt');s=read(p)
s=s.replace('import vn.pickpack1291.baohang.data.InventoryImportRow\n','')
s=s.replace('val nameColumn = findHeader(headers, "ten san pham", "ten hang", "product name")','val nameColumn = findHeader(headers, "ten sku", "sku name", "ten san pham", "ten hang", "product name")')
# delete parseInventoryFile and helper
if '    fun parseInventoryFile(' in s:
    st=s.index('    fun parseInventoryFile('); o=s.index('{',st); en=brace_end(s,o)
    while en<len(s) and s[en] in '\r\n':en+=1
    s=s[:st]+s[en:]
if '    private fun parseNonNegative(' in s:
    st=s.index('    private fun parseNonNegative(');o=s.index('{',st);en=brace_end(s,o)
    while en<len(s) and s[en] in '\r\n':en+=1
    s=s[:st]+s[en:]
write(p,s)
Path('app/src/main/java/vn/pickpack1291/baohang/data/InventoryImportRow.kt').unlink(missing_ok=True)

# Header back affordance.
p=Path('app/src/main/res/layout/activity_main.xml');s=read(p)
needle='''        <ImageView
            android:layout_width="42dp"'''
insert='''        <TextView
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
s=once(s,needle,insert,'back xml');write(p,s)

# Overlay professional 40% final-state alert.
p=Path('app/src/main/res/layout/overlay_alert.xml');s=read(p)
s=s.replace('android:text="INVENT ĐANG TÌM"','android:text="CẬP NHẬT XỬ LÝ"').replace('android:textSize="20sp"','android:textSize="24sp"').replace('android:textSize="29sp"','android:textSize="32sp"').replace('android:textSize="15sp"','android:textSize="17sp"').replace('android:textSize="16sp"','android:textSize="18sp"').replace('android:text="ĐÃ HIỂU"','android:text="ĐÃ XÁC NHẬN"').replace('android:text="Chạm vùng trống để ẩn"','android:text="Cảnh báo nghiệp vụ • vui lòng xác nhận"')
write(p,s)
Path('app/src/main/res/drawable/bg_overlay_available.xml').write_text('''<?xml version="1.0" encoding="utf-8"?>\n<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle"><solid android:color="#0B6B3A"/><corners android:radius="18dp"/><stroke android:width="1dp" android:color="#42D392"/><padding android:left="16dp" android:top="16dp" android:right="16dp" android:bottom="16dp"/></shape>\n''',encoding='utf-8')
Path('app/src/main/res/drawable/bg_overlay_skip.xml').write_text('''<?xml version="1.0" encoding="utf-8"?>\n<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle"><solid android:color="#A32620"/><corners android:radius="18dp"/><stroke android:width="1dp" android:color="#F06A62"/><padding android:left="16dp" android:top="16dp" android:right="16dp" android:bottom="16dp"/></shape>\n''',encoding='utf-8')

# Overlay service only final statuses, fixed 40% screen.
p=Path('app/src/main/java/vn/pickpack1291/baohang/notifications/OverlayAlertService.kt');s=read(p)
s=once(s,'        val status = intent?.getStringExtra(EXTRA_STATUS).orEmpty()','        val status = intent?.getStringExtra(EXTRA_STATUS).orEmpty()\n        if (status !in setOf("AVAILABLE", "SKIP_ALLOWED")) { stopSelf(); return START_NOT_STICKY }','overlay guard')
s=s.replace('root.setBackgroundResource(if (critical) R.drawable.bg_overlay_critical else R.drawable.bg_overlay_info)','root.setBackgroundResource(if (status == "AVAILABLE") R.drawable.bg_overlay_available else R.drawable.bg_overlay_skip)')
s=s.replace('statusView.text = when (status) {\n            "OPEN" -> "INVENT ĐANG TÌM"\n            "CLAIMED", "SEARCHING", "REPLENISHING" -> "ĐANG XỬ LÝ"\n            "AVAILABLE" -> "ĐÃ CÓ HÀNG / CHÂM BÙ"\n            "SKIP_ALLOWED" -> "ĐƯỢC PHÉP SKIP"\n            else -> "CẬP NHẬT BÁO HÀNG"\n        }','statusView.text = if (status == "AVAILABLE") "ĐÃ CÓ HÀNG • QUAY LẠI LẤY HÀNG" else "CHO PHÉP SKIP • TIẾP TỤC CÔNG VIỆC"')
s=s.replace('ack.visibility = if (critical) View.VISIBLE else View.GONE','ack.visibility = View.VISIBLE')
s=s.replace('        if (!critical) root.setOnClickListener { stopSelf() }','')
s=s.replace('val height = if (critical) (resources.displayMetrics.heightPixels * 0.4f).toInt() else WindowManager.LayoutParams.WRAP_CONTENT','val height = (resources.displayMetrics.heightPixels * 0.4f).toInt()')
write(p,s)

# FCM: Picker only final prominent states.
p=Path('app/src/main/java/vn/pickpack1291/baohang/notifications/StockMessagingService.kt');s=read(p)
anchor='''        val status = message.data["status"].orEmpty()
        val issueId = message.data["issue_id"].orEmpty()'''
s=once(s,anchor,'''        val status = message.data["status"].orEmpty()
        if (status !in setOf("AVAILABLE", "SKIP_ALLOWED")) {
            app.diagnostics.info("picker_notification_suppressed", mapOf("status" to status))
            return
        }
        val issueId = message.data["issue_id"].orEmpty()''','fcm final guard')
s=s.replace('val canClaim = status == "OPEN" && effectiveRole in setOf(UserRole.ADMIN, UserRole.ADMIN_INVENT, UserRole.INVENT)','val canClaim = false')
s=s.replace('            if (critical) putExtra(OverlayAlertService.EXTRA_CRITICAL, true)','            putExtra(OverlayAlertService.EXTRA_CRITICAL, true)')
write(p,s)

# Main Activity navigation + lean catalog/users/config/report.
p=Path('app/src/main/java/vn/pickpack1291/baohang/ui/MainActivity.kt');s=read(p)
s=s.replace('import vn.pickpack1291.baohang.data.InventoryImportRow\n','').replace('import vn.pickpack1291.baohang.data.InventoryStatus\n','').replace('import java.time.Instant\n','').replace('import java.util.UUID\n','')
s=once(s,'import androidx.activity.result.contract.ActivityResultContracts','import androidx.activity.OnBackPressedCallback\nimport androidx.activity.result.contract.ActivityResultContracts','back import')
s=s.replace('            onInventoryChanged = {\n                runOnUiThread { if (currentScreen == SCREEN_INVENTORY) showInventory() }\n            },','            onCatalogChanged = { lifecycleScope.launch(Dispatchers.IO) { runCatching { app.repository.syncCatalog() }; runOnUiThread { if (currentScreen == SCREEN_CATALOG) showCatalog() } } },\n            onStaffChanged = { lifecycleScope.launch { runCatching { app.repository.refreshProfile() }; runOnUiThread { renderForRole() } } },')
s=s.replace('    private val chooseUsers = registerForActivityResult(ActivityResultContracts.GetContent()) { uri -> uri?.let(::importUserFile) }\n    private val chooseInventory = registerForActivityResult(ActivityResultContracts.GetContent()) { uri -> uri?.let(::importInventoryFile) }\n    private val saveTemplate = registerForActivityResult(ActivityResultContracts.CreateDocument(XLSX_MIME)) { uri -> uri?.let(::writeTemplate) }\n','')
# onCreate back setup after container
s=once(s,'        container = findViewById(R.id.contentContainer)','''        container = findViewById(R.id.contentContainer)
        findViewById<TextView>(R.id.btnBack).setOnClickListener { navigateBack() }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { if (isRoleRoot()) finish() else renderForRole() }
        })''','back setup')
# page updates visible back
s=once(s,'        currentScreen = screen\n        container.removeAllViews()','        currentScreen = screen\n        container.removeAllViews()\n        updateBackButton()','page back')
# replace admin menus
s=replfn(s,'showAdmin',r'''    private fun showAdmin() {
        val content=page("ADMIN HỆ THỐNG",SCREEN_MENU);content.addView(infoBox("Tài khoản quản trị cao nhất được bảo vệ. Hệ thống chỉ dùng danh mục SKU/tên hàng từ file; không dùng phiên/credential Supra."));
        content.addView(button("SỰ KIỆN / ĐIỀU PHỐI"){showInventBoard()});content.addView(button("DANH MỤC SKU / TÊN HÀNG"){showCatalog()});content.addView(button("BÁO CÁO VẬN HÀNH"){showReports()});content.addView(button("NHÂN SỰ & QUYỀN"){showUsers()});content.addView(button("MỐC THỜI GIAN VẬN HÀNH"){showOperationalSla()});content.addView(button("HỆ THỐNG & DUNG LƯỢNG"){showServiceMetrics()});content.addView(button("CẤU HÌNH HỆ THỐNG"){showConfig()});content.addView(button("ĐỒNG BỘ GOOGLE SHEET BÁO CÁO"){syncSheet()});addDiagnosticsButton(content);
        content.addView(section("Kiểm thử quyền"));content.addView(button("TEST • ADMIN EVENT"){enterTestRole(UserRole.ADMIN_INVENT)});content.addView(button("TEST • NGƯỜI BÁO HÀNG"){enterTestRole(UserRole.INVENT)});content.addView(button("TEST • PICKER"){enterTestRole(UserRole.PICKER)});
    }''')
s=replfn(s,'showAdminEvent',r'''    private fun showAdminEvent() {
        val content=page("ADMIN EVENT",SCREEN_MENU);content.addView(button("SỰ KIỆN / ĐIỀU PHỐI"){showInventBoard()});content.addView(button("DANH MỤC SKU / TÊN HÀNG"){showCatalog()});content.addView(button("BÁO CÁO VẬN HÀNH"){showReports()});content.addView(button("NHÂN SỰ"){showUsers()});content.addView(button("MỐC THỜI GIAN VẬN HÀNH"){showOperationalSla()});content.addView(button("HỆ THỐNG & DUNG LƯỢNG"){showServiceMetrics()});addDiagnosticsButton(content)
    }''')
# remove inventory button in issue card
s=s.replace('        card.addView(button("XEM TỒN SNAPSHOT") { showInventoryForSku(issue.sku) })\n','')
# picker lean function
s=replfn(s,'showPicker',r'''    private fun showPicker() {
        val content=page("PICKER / NGƯỜI LẤY HÀNG",SCREEN_PICKER);content.addView(infoBox("Quét hoặc tìm theo SKU / tên sản phẩm. Ứng dụng chỉ bật cảnh báo nổi bật khi ĐÃ CÓ HÀNG hoặc ĐƯỢC PHÉP SKIP."));
        val input=AutoCompleteTextView(this).apply{hint="Quét SKU hoặc nhập tên sản phẩm";threshold=1;setSingleLine(true)};val selected=infoBox("Chưa chọn SKU");val reportButton=button("BÁO THIẾU"){};reportButton.isEnabled=false;val recent=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL};var chosen:SkuItem?=null
        content.addView(input);content.addView(selected);content.addView(reportButton);content.addView(section("Giao dịch gần đây của tôi"));content.addView(recent);addDiagnosticsButton(content)
        fun select(item:SkuItem){chosen=item;selected.text="SKU ${item.sku}\n${item.productName}";reportButton.isEnabled=true;input.setText("")}
        fun suggestions(q:String){searchJob?.cancel();searchJob=lifecycleScope.launch{delay(120);val local=withContext(Dispatchers.IO){app.repository.searchSkus(q)};val items=if(local.isNotEmpty())local else runCatching{app.repository.searchSkusOnline(q)}.getOrDefault(emptyList());input.setAdapter(ArrayAdapter(this@MainActivity,android.R.layout.simple_dropdown_item_1line,items));if(items.isNotEmpty())input.showDropDown()}}
        input.addTextChangedListener(object:TextWatcher{override fun beforeTextChanged(s:CharSequence?,start:Int,count:Int,after:Int)=Unit;override fun onTextChanged(s:CharSequence?,start:Int,before:Int,count:Int){if(!s.isNullOrBlank())suggestions(s.toString())};override fun afterTextChanged(s:Editable?)=Unit});input.setOnItemClickListener{parent,_,position,_->(parent.getItemAtPosition(position) as? SkuItem)?.let(::select)}
        reportButton.setOnClickListener{val item=chosen?:return@setOnClickListener;lifecycleScope.launch{reportButton.isEnabled=false;runCatching{app.repository.reportShortage(item.sku)}.onSuccess{toast(it.message);chosen=null;selected.text="Chưa chọn SKU";loadMyIssues(recent);input.requestFocus()}.onFailure{toast(it.message?:"Không gửi được báo thiếu")};reportButton.isEnabled=chosen!=null}}
        loadMyIssues(recent);input.requestFocus()
    }''')
# delete inventory funcs
for fn in ['pickerInventoryText','showInventory','showInventoryForSku','inventoryText','startSupraSync','importInventoryFile']:
    s=removefn(s,fn)
# catalog screen replaces import behavior
catalog=r'''    private fun showCatalog() {
        val content=page("DANH MỤC SKU / TÊN HÀNG",SCREEN_CATALOG);content.addView(infoBox("Nguồn file chỉ lấy 2 trường: SKU và Tên SKU/Tên sản phẩm. Không lưu số lượng tồn, bin, chờ xuất hoặc vị trí."));
        content.addView(infoBox("SKU đang lưu trên máy: ${app.repository.skuCount()}"));if(app.session.effectiveRole in setOf(UserRole.ADMIN,UserRole.ADMIN_INVENT))content.addView(button("CẬP NHẬT TỪ FILE TỒN BIN XLSX"){chooseSku.launch(XLSX_MIME)});
        val input=AutoCompleteTextView(this).apply{hint="Tra SKU hoặc tên sản phẩm";threshold=1;setSingleLine(true)};val result=infoBox("Nhập từ khóa để tra cứu.");content.addView(input);content.addView(result);input.addTextChangedListener(object:TextWatcher{override fun beforeTextChanged(s:CharSequence?,a:Int,b:Int,c:Int)=Unit;override fun afterTextChanged(s:Editable?)=Unit;override fun onTextChanged(v:CharSequence?,a:Int,b:Int,c:Int){searchJob?.cancel();if(v.isNullOrBlank()){result.text="Nhập từ khóa để tra cứu.";return};searchJob=lifecycleScope.launch{delay(120);val items=withContext(Dispatchers.IO){app.repository.searchSkus(v.toString())};result.text=if(items.isEmpty())"Không tìm thấy SKU phù hợp." else items.take(20).joinToString("\n"){"${it.sku} • ${it.productName}"}}}})
    }
'''
# insert before showReports
idx=s.index('    private fun showReports()');s=s[:idx]+catalog+'\n'+s[idx:]
# reports professional
s=replfn(s,'showReports',r'''    private fun showReports() {
        val content=page("BÁO CÁO VẬN HÀNH KHO",SCREEN_REPORTS);val body=infoBox("Đang tổng hợp dữ liệu…");content.addView(body);lifecycleScope.launch{runCatching{app.repository.reportsSummary()}.onSuccess{r->val d=r.optJSONObject("last_24h")?:JSONObject();val top=r.optJSONArray("top_skus")?:JSONArray();val topText=buildString{for(i in 0 until minOf(10,top.length())){val x=top.getJSONObject(i);append("\n${i+1}. ${x.optString("sku")} • ${x.optString("product_name")} • ${x.optInt("reports")} lượt")}};body.text="TỔNG QUAN 24 GIỜ\nLượt báo: ${d.optInt("reports")} • Ticket: ${d.optInt("issues")} • Hoàn tất: ${d.optInt("resolved")}\nĐã có hàng/châm bù: ${d.optInt("available")} • Cho SKIP: ${d.optInt("skipped")}\n\nCHẤT LƯỢNG 30 NGÀY\nĐang mở: ${r.optInt("active_now")} • Quá mốc phản hồi: ${r.optInt("overdue_now")}\nTrung vị nhận xử lý: ${r.opt("median_claim_minutes")?:"—"} phút • P95 nhận: ${r.opt("p95_claim_minutes")?:"—"} phút\nTrung vị hoàn tất: ${r.opt("median_resolution_minutes")?:"—"} phút • P95 hoàn tất: ${r.opt("p95_resolution_minutes")?:"—"} phút\nTái phát: ${r.optInt("recurrent_episodes")} • Auto SKIP: ${r.optInt("auto_skip_count_30d")}\n\nSKU PHÁT SINH NHIỀU$topText"}.onFailure{body.text="Lỗi: ${it.message}"}}
    }''')
# SLA with auto skip
s=replfn(s,'showOperationalSla',r'''    private fun showOperationalSla() {
        val content=page("MỐC THỜI GIAN VẬN HÀNH",SCREEN_CONFIG);val ack=numberInput("Thời gian nhận xử lý (phút)"),rem=numberInput("Chu kỳ nhắc xử lý (phút)"),rep=numberInput("Thời gian châm hàng (phút)"),picker=numberInput("Nhắc Picker xác nhận (phút)"),autoAfter=numberInput("Mốc tự động cho phép SKIP (phút)");val auto=CheckBox(this).apply{text="Bật tự động cho phép SKIP khi quá mốc"};listOf(ack.first,rem.first,rep.first,picker.first).forEach(content::addView);content.addView(infoBox("Thời gian nhận: từ lúc Picker báo đến khi có người nhận. Chu kỳ nhắc: khoảng cách nhắc ticket còn mở. Thời gian châm: mốc theo dõi xử lý. Nhắc Picker chỉ áp dụng cảnh báo ĐÃ CÓ HÀNG hoặc SKIP."));content.addView(auto);content.addView(autoAfter.first);content.addView(infoBox("Ví dụ 120 phút = 2 giờ. Tắt tùy chọn để không tự động SKIP."));content.addView(button("LƯU MỐC THỜI GIAN"){lifecycleScope.launch{runCatching{app.repository.saveOperationalConfig(OperationalConfig(ack.second.int(),rem.second.int(),rep.second.int(),picker.second.int(),auto.isChecked,autoAfter.second.int()))}.onSuccess{toast("Đã lưu mốc thời gian vận hành")}.onFailure{toast(it.message?:"Không lưu được")}}});lifecycleScope.launch{runCatching{app.repository.getOperationalConfig()}.onSuccess{c->ack.second.setText(c.acknowledgeMinutes.toString());rem.second.setText(c.reminderMinutes.toString());rep.second.setText(c.replenishMinutes.toString());picker.second.setText(c.pickerAckReminderMinutes.toString());auto.isChecked=c.autoSkipEnabled;autoAfter.second.setText(c.autoSkipAfterMinutes.toString())}.onFailure{toast(it.message?:"Không tải được cấu hình")}}
    }''')
# system config lean
s=replfn(s,'showConfig',r'''    private fun showConfig() {
        val content=page("CẤU HÌNH HỆ THỐNG",SCREEN_CONFIG);val retention=numberInput("Lưu lịch sử nghiệp vụ (ngày)"),logs=numberInput("Lưu log chẩn đoán (ngày)"),staffInt=numberInput("Chu kỳ đồng bộ nhân sự (phút)"),autoAfter=numberInput("Mốc tự động SKIP (phút)");val staffAuto=CheckBox(this).apply{text="Tự động đồng bộ DANH MỤC NHÂN SỰ"};val autoSkip=CheckBox(this).apply{text="Bật tự động cho phép SKIP"};content.addView(retention.first);content.addView(infoBox("Ticket/audit giữ theo chu kỳ, kể cả nhân sự đã ngừng hoạt động."));content.addView(logs.first);content.addView(staffAuto);content.addView(staffInt.first);content.addView(infoBox("Khuyến nghị 60 phút để giảm network/quota. Nguồn: Site 1291 / Kho HY1."));content.addView(autoSkip);content.addView(autoAfter.first);content.addView(button("LƯU CẤU HÌNH HỆ THỐNG"){lifecycleScope.launch{runCatching{val old=app.repository.getConfig();app.repository.saveConfig(old.copy(retentionDays=retention.second.int(),diagnosticLogRetentionDays=logs.second.int(),staffAutoSyncEnabled=staffAuto.isChecked,staffSyncIntervalMinutes=staffInt.second.int(),autoSkipEnabled=autoSkip.isChecked,autoSkipAfterMinutes=autoAfter.second.int()))}.onSuccess{toast("Đã lưu cấu hình")}.onFailure{toast(it.message?:"Không lưu được")}}});lifecycleScope.launch{runCatching{app.repository.getConfig()}.onSuccess{c->retention.second.setText(c.retentionDays.toString());logs.second.setText(c.diagnosticLogRetentionDays.toString());staffAuto.isChecked=c.staffAutoSyncEnabled;staffInt.second.setText(c.staffSyncIntervalMinutes.toString());autoSkip.isChecked=c.autoSkipEnabled;autoAfter.second.setText(c.autoSkipAfterMinutes.toString())}.onFailure{toast(it.message?:"Không tải được cấu hình")}}
    }''')
# users source-aware + create/delete manual
s=replfn(s,'showUsers',r'''    private fun showUsers() {
        val content=page("NHÂN SỰ & QUYỀN",SCREEN_USERS);val list=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL};content.addView(button("ĐỒNG BỘ DANH MỤC NHÂN SỰ NGAY"){lifecycleScope.launch{runCatching{app.api.invoke("staff-sync-now",JSONObject())}.onSuccess{toast("Đồng bộ nhân sự: ${it.optString("status")}");showUsers()}.onFailure{toast(it.message?:"Không đồng bộ được")}}});content.addView(button("TẠO TÀI KHOẢN NGOÀI DANH SÁCH NGUỒN"){createExtraUser{showUsers()}});content.addView(infoBox("Nhân sự Google Sheet được quản lý từ nguồn. Khi mất khỏi nguồn, tài khoản chỉ ngừng hoạt động; lịch sử nghiệp vụ vẫn giữ. 6281280 được bảo vệ tuyệt đối."));content.addView(list);lifecycleScope.launch{runCatching{app.repository.listUsers()}.onSuccess{users->if(users.isEmpty())list.addView(infoBox("Không có nhân sự trong phạm vi quyền."));users.forEach{u->val row=LinearLayout(this@MainActivity).apply{orientation=LinearLayout.VERTICAL;setPadding(dp(10),dp(8),dp(10),dp(8));setBackgroundResource(R.drawable.bg_card)};row.addView(text("${u.employeeCode} • ${u.fullName}${if(u.protectedAccount)" • 🔒" else ""}",16,true));row.addView(text("${u.role.label} • ${if(u.active)"HOẠT ĐỘNG" else "NGỪNG"} • ${if(u.sourceKind=="GSHEET")"GOOGLE SHEET" else "TẠO THÊM"}${if(u.sourcePosition.isNotBlank())" • ${u.sourcePosition}" else ""}",12,false));if(!u.protectedAccount&&u.sourceKind!="GSHEET"&&(app.session.effectiveRole==UserRole.ADMIN||u.role==UserRole.PICKER)){row.addView(button("CHỈNH SỬA"){editUser(u){showUsers()}});row.addView(button("NGỪNG TÀI KHOẢN"){lifecycleScope.launch{runCatching{app.api.invoke("delete-user",JSONObject().put("id",u.id))}.onSuccess{toast("Đã ngừng ${u.employeeCode}");showUsers()}.onFailure{toast(it.message?:"Không xử lý được")}}})};list.addView(row,LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,ViewGroup.LayoutParams.WRAP_CONTENT).apply{setMargins(0,dp(4),0,dp(4))})}}.onFailure{list.addView(infoBox("Lỗi: ${it.message}"))}}
    }''')
# edit role Admin Invent only Picker
s=s.replace('            else -> listOf(UserRole.INVENT, UserRole.PICKER)','            else -> listOf(UserRole.PICKER)')
# import catalog replace
s=replfn(s,'importSkuFile',r'''    private fun importSkuFile(uri: Uri) {
        lifecycleScope.launch{toast("Đang đọc SKU và tên sản phẩm…");runCatching{val items=withContext(Dispatchers.IO){XlsxImporter(contentResolver).parseSkuFile(uri)};app.repository.replaceCatalog(items,"Tồn Bin XLSX");items.size}.onSuccess{toast("Đã thay danh mục bằng $it SKU / tên sản phẩm");showCatalog()}.onFailure{toast("Lỗi: ${it.message}")}}
    }''')
# remove unused legacy import/template functions
for fn in ['importUserFile','writeTemplate']:
    s=removefn(s,fn)
# helper functions inserted before checkPendingAlerts
helpers=r'''    private fun createExtraUser(refresh: () -> Unit) {
        val root=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL;setPadding(dp(16),0,dp(16),0)};val code=EditText(this).apply{hint="Mã nhân viên"};val name=EditText(this).apply{hint="Họ tên"};val contractor=EditText(this).apply{hint="Nhà thầu"};val password=EditText(this).apply{hint="Mật khẩu riêng (để trống dùng mặc định)";inputType=InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD};val roles=if(app.session.effectiveRole==UserRole.ADMIN)listOf(UserRole.ADMIN_INVENT,UserRole.INVENT,UserRole.PICKER) else listOf(UserRole.PICKER);val roleView=AutoCompleteTextView(this).apply{threshold=0;setAdapter(ArrayAdapter(this@MainActivity,android.R.layout.simple_dropdown_item_1line,roles.map{it.label}));setText(roles.first().label,false)};listOf(code,name,contractor,roleView,password).forEach(root::addView);AlertDialog.Builder(this).setTitle("Tạo tài khoản ngoài nguồn").setView(root).setNegativeButton("HỦY",null).setPositiveButton("TẠO"){_,_->val r=roles.firstOrNull{it.label==roleView.text.toString()}?:roles.first();lifecycleScope.launch{runCatching{app.repository.importUsers(listOf(vn.pickpack1291.baohang.data.ImportUserRow(code.text.toString().trim(),name.text.toString().trim(),contractor.text.toString().trim(),r,true,password.text.toString())))}.onSuccess{if(it.optInt("failed")>0)toast(it.optJSONArray("errors")?.optString(0)?:"Không tạo được") else {toast("Đã tạo tài khoản");refresh()}}.onFailure{toast(it.message?:"Không tạo được")}}}.show()
    }

    private fun showServiceMetrics() {
        val content=page("HỆ THỐNG & DUNG LƯỢNG",SCREEN_SERVICES);val body=infoBox("Đang đọc số liệu…");content.addView(body);lifecycleScope.launch{runCatching{app.api.invoke("service-metrics",JSONObject())}.onSuccess{d->val u=d.optJSONObject("usage")?:JSONObject(),l=d.optJSONObject("free_limits")?:JSONObject();val db=u.optLong("database_bytes"),limit=l.optLong("database_bytes",1);body.text="FREE 0đ • KHÔNG TỰ BẬT BILLING\n\nDatabase: ${"%.1f".format(db/1048576.0)} MB / ${"%.0f".format(limit/1048576.0)} MB (${"%.1f".format(db*100.0/limit)}%)\nSKU hoạt động: ${u.optInt("sku_active")}\nNhân sự hoạt động: ${u.optInt("profiles_active")}\nTicket đang mở: ${u.optInt("issues_active")}\nFCM token hoạt động: ${u.optInt("active_device_tokens")}\nGoogle Sheet chờ: ${u.optInt("sheet_pending")}\nLog chẩn đoán: ${"%.2f".format(u.optLong("diagnostic_log_bytes")/1048576.0)} MB\n\nNgưỡng tham chiếu: Storage 1 GB • Edge 500.000 lượt/tháng • Realtime 2.000.000 message/tháng • 200 kết nối đồng thời."}.onFailure{body.text="Lỗi: ${it.message}"}}
    }

    private fun isRoleRoot():Boolean=when(app.session.effectiveRole){UserRole.ADMIN,UserRole.ADMIN_INVENT->currentScreen==SCREEN_MENU;UserRole.INVENT->currentScreen==SCREEN_INVENT;UserRole.PICKER->currentScreen==SCREEN_PICKER}
    private fun updateBackButton(){findViewById<TextView>(R.id.btnBack)?.visibility=if(isRoleRoot())View.GONE else View.VISIBLE}
    private fun navigateBack(){if(isRoleRoot())finish() else renderForRole()}
'''
idx=s.index('    private suspend fun checkPendingAlerts()');s=s[:idx]+helpers+'\n'+s[idx:]
# visible ACK dialog final only professional
s=s.replace('            val alert = alerts.firstOrNull() ?: return@onSuccess','            val alert = alerts.firstOrNull { it.status in setOf(IssueStatus.AVAILABLE, IssueStatus.SKIP_ALLOWED) } ?: return@onSuccess')
s=s.replace('.setPositiveButton("ĐÃ HIỂU")','.setPositiveButton("ĐÃ XÁC NHẬN")')
# constants
s=s.replace('        private const val SCREEN_INVENTORY = "inventory"\n','        private const val SCREEN_CATALOG = "catalog"\n        private const val SCREEN_SERVICES = "services"\n')
# guard no active inventory/Supra functions
for marker in ['inventory-sync-start','showInventory()','inventoryStatus(','TỒN SNAPSHOT']:
    if marker in s: raise SystemExit(f'legacy marker remains MainActivity: {marker}')
write(p,s)

# final direct fix for generated staff broadcast in API source after API patch runs.
# This script runs after API patch in the temporary workflow.
p=Path('supabase/functions/api/index.ts');s=read(p)
s=s.replace('await admin.schema("realtime").rpc("send",{payload:{run_id:run.id,status,created,updated,deactivated},event:"staff_changed",topic:"site:1291:staff",private:true}).catch(()=>{});','await admin.rpc("broadcast_staff_change_service",{p_payload:{run_id:run.id,status,created,updated,deactivated}}).catch(()=>{});')
write(p,s)
print('ANDROID_PATCH_OK')
