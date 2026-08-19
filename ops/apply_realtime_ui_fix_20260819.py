from pathlib import Path


def replace_one(path, old, new, label):
    p = Path(path)
    s = p.read_text()
    if s.count(old) != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {s.count(old)}')
    p.write_text(s.replace(old, new, 1))

# Web: direct authenticated Firestore invalidation after canonical Neon mutations.
p = Path('web-admin/src/backend-runtime.js')
s = p.read_text()
old = """        doc: firestoreModule.doc,\n        onSnapshot: firestoreModule.onSnapshot,\n"""
new = """        doc: firestoreModule.doc,\n        onSnapshot: firestoreModule.onSnapshot,\n        setDoc: firestoreModule.setDoc,\n        serverTimestamp: firestoreModule.serverTimestamp,\n"""
if s.count(old) != 1: raise SystemExit('web firebase runtime export guard')
s = s.replace(old, new, 1)
old = """let installed = false\nlet realtimeToken = ''\nconst originalFetch = globalThis.fetch.bind(globalThis)\n"""
new = """let installed = false\nlet realtimeToken = ''\nconst ISSUE_SIGNAL_ACTIONS = new Set(['report-shortage', 'claim-issue', 'reassign-issue', 'update-issue', 'restore-skipped', 'withdraw-shortage'])\nconst PICKER_ALERT_ACTIONS = new Set(['update-issue', 'restore-skipped'])\nconst originalFetch = globalThis.fetch.bind(globalThis)\n"""
if s.count(old) != 1: raise SystemExit('web realtime action constants guard')
s = s.replace(old, new, 1)
marker = """async function neonRpc(action, body, init) {\n"""
insert = """async function emitIssueRealtimeSignal(issue, source) {\n  if (!issue?.id) return\n  const { auth, firestore, doc, setDoc, serverTimestamp } = await firebaseRuntime()\n  if (!auth.currentUser) return\n  await setDoc(doc(firestore, 'realtime', 'issues'), {\n    event_type: 'issue_changed',\n    topic: 'issues',\n    entity_id: String(issue.id),\n    entity_version: Number(issue.issue_version || issue.issueVersion || 0),\n    source: String(source || 'web'),\n    client_at: serverTimestamp(),\n  })\n}\n\n"""
if s.count(marker) != 1: raise SystemExit('web neonRpc marker guard')
s = s.replace(marker, insert + marker, 1)
old = """  const text = await response.text()\n  return new Response(text, { status: response.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })\n}\n"""
new = """  const text = await response.text()\n  if (response.ok && ISSUE_SIGNAL_ACTIONS.has(action)) {\n    try {\n      const payload = text ? JSON.parse(text) : {}\n      const issue = payload?.issue || payload\n      await emitIssueRealtimeSignal(issue, `web:${action}`)\n    } catch (error) {\n      console.warn('issue realtime signal deferred', action, error?.message || error)\n    }\n    if (PICKER_ALERT_ACTIONS.has(action)) {\n      void worker('worker-kick', { reason: `web:${action}` }, init).catch(() => {})\n    }\n  }\n  return new Response(text, { status: response.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })\n}\n"""
if s.count(old) != 1: raise SystemExit('web neonRpc response guard')
s = s.replace(old, new, 1)
p.write_text(s)

# Firebase: authenticated clients may only write the tiny global issue invalidation document.
Path('firestore.rules').write_text("""rules_version = '2';\nservice cloud.firestore {\n  match /databases/{database}/documents {\n    function signedIn() {\n      return request.auth != null;\n    }\n\n    match /realtime/{topic} {\n      allow read: if signedIn();\n      allow write: if signedIn()\n        && topic == 'issues'\n        && request.resource.data.keys().hasOnly([\n          'event_type', 'topic', 'entity_id', 'entity_version', 'source', 'client_at'\n        ])\n        && request.resource.data.event_type == 'issue_changed'\n        && request.resource.data.topic == 'issues'\n        && request.resource.data.entity_id is string\n        && request.resource.data.entity_version is int\n        && request.resource.data.source is string\n        && request.resource.data.client_at is timestamp;\n    }\n  }\n}\n""")
replace_one('firebase.json', '{\n  "hosting": {', '{\n  "firestore": { "rules": "firestore.rules" },\n  "hosting": {', 'firebase rules config')
replace_one('.github/workflows/deploy-web-admin.yml', "      - 'firebase.json'\n", "      - 'firebase.json'\n      - 'firestore.rules'\n", 'web deploy rules path')
replace_one('.github/workflows/deploy-web-admin.yml', '      - name: Deploy Firebase Hosting\n        shell: bash\n        run: npx --yes firebase-tools@14.17.0 deploy --only hosting --project bao-hang-1291 --non-interactive\n', '      - name: Deploy Firebase Hosting and Firestore rules\n        shell: bash\n        run: npx --yes firebase-tools@14.17.0 deploy --only hosting,firestore:rules --project bao-hang-1291 --non-interactive\n', 'web deploy rules command')

# Android: issue mutations directly invalidate the web without forcing Apps Script on every shortage.
p = Path('app/src/main/java/vn/pickpack1291/baohang/network/ApiClient.kt')
s = p.read_text()
old = 'import java.nio.charset.StandardCharsets\nimport java.util.UUID\n'
new = 'import java.nio.charset.StandardCharsets\nimport java.time.Instant\nimport java.util.UUID\n'
if s.count(old) != 1: raise SystemExit('ApiClient Instant import guard')
s = s.replace(old, new, 1)
old = '''    suspend fun reportShortage(sku: String, clientRequestId: String): ReportResult {\n        val json = invoke("report-shortage", JSONObject().put("sku", sku).put("client_request_id", clientRequestId))\n        kickWorkerBestEffort("report_shortage")\n        return ReportResult(\n            StockIssue.fromJson(json.getJSONObject("issue")),\n            json.optBoolean("already_reported", false),\n            json.optString("message", "Đã ghi nhận báo thiếu")\n        )\n    }\n'''
new = '''    suspend fun reportShortage(sku: String, clientRequestId: String): ReportResult {\n        val json = invoke("report-shortage", JSONObject().put("sku", sku).put("client_request_id", clientRequestId))\n        val issue = StockIssue.fromJson(json.getJSONObject("issue"))\n        emitIssueRealtimeBestEffort(issue, "report_shortage")\n        return ReportResult(\n            issue,\n            json.optBoolean("already_reported", false),\n            json.optString("message", "Đã ghi nhận báo thiếu")\n        )\n    }\n'''
if s.count(old) != 1: raise SystemExit('ApiClient report shortage guard')
s = s.replace(old, new, 1)
for label in ['claim_issue', 'reassign_issue', 'update_issue', 'restore_skipped']:
    old = f'''        kickWorkerBestEffort("{label}")\n        return issue\n'''
    new = f'''        emitIssueRealtimeBestEffort(issue, "{label}")\n        kickWorkerBestEffort("{label}")\n        return issue\n'''
    if s.count(old) != 1: raise SystemExit(f'ApiClient {label} guard')
    s = s.replace(old, new, 1)
old = '''    private fun kickWorkerBestEffort(reason: String) {\n        if (workerUrl.isBlank() || sessionStore.accessToken.isBlank()) return\n        runCatching {\n            val body = JSONObject()\n                .put("action", "worker-kick")\n                .put("id_token", sessionStore.accessToken)\n                .put("reason", reason)\n            requestJson("POST", workerUrl, body, token = null, eventName = "worker_kick_$reason", connectTimeout = 5_000, readTimeout = 10_000)\n        }.onFailure { diagnostics.warn("worker_kick_deferred", mapOf("reason" to reason, "error" to (it.message ?: it.javaClass.simpleName).take(240))) }\n    }\n'''
new = '''    private suspend fun emitIssueRealtimeBestEffort(issue: StockIssue, reason: String) = withContext(Dispatchers.IO) {\n        if (sessionStore.accessToken.isBlank()) return@withContext\n        runCatching {\n            refreshSessionIfNeeded()\n            val fields = JSONObject()\n                .put("event_type", JSONObject().put("stringValue", "issue_changed"))\n                .put("topic", JSONObject().put("stringValue", "issues"))\n                .put("entity_id", JSONObject().put("stringValue", issue.id))\n                .put("entity_version", JSONObject().put("integerValue", issue.issueVersion.toString()))\n                .put("source", JSONObject().put("stringValue", "android:$reason"))\n                .put("client_at", JSONObject().put("timestampValue", Instant.now().toString()))\n            requestJson(\n                "PATCH",\n                "https://firestore.googleapis.com/v1/projects/bao-hang-1291/databases/(default)/documents/realtime/issues",\n                JSONObject().put("fields", fields),\n                token = sessionStore.accessToken,\n                eventName = "firestore_issue_signal_$reason",\n                connectTimeout = 5_000,\n                readTimeout = 8_000\n            )\n        }.onFailure { diagnostics.warn("issue_realtime_signal_deferred", mapOf("reason" to reason, "error" to (it.message ?: it.javaClass.simpleName).take(240))) }\n    }\n\n    private suspend fun kickWorkerBestEffort(reason: String) = withContext(Dispatchers.IO) {\n        if (workerUrl.isBlank() || sessionStore.accessToken.isBlank()) return@withContext\n        runCatching {\n            val body = JSONObject()\n                .put("action", "worker-kick")\n                .put("id_token", sessionStore.accessToken)\n                .put("reason", reason)\n            requestJson("POST", workerUrl, body, token = null, eventName = "worker_kick_$reason", connectTimeout = 5_000, readTimeout = 10_000)\n        }.onFailure { diagnostics.warn("worker_kick_deferred", mapOf("reason" to reason, "error" to (it.message ?: it.javaClass.simpleName).take(240))) }\n    }\n'''
if s.count(old) != 1: raise SystemExit('ApiClient worker kick guard')
s = s.replace(old, new, 1)
p.write_text(s)

# Android picker layout + version/OTA + full-screen alert behavior.
p = Path('app/src/main/java/vn/pickpack1291/baohang/ui/MainActivity.kt')
s = p.read_text()
old = 'import android.os.SystemClock\nimport android.text.Editable\n'
new = 'import android.os.SystemClock\nimport android.provider.Settings\nimport android.text.Editable\n'
if s.count(old) != 1: raise SystemExit('MainActivity Settings import guard')
s = s.replace(old, new, 1)
old = '''        findViewById<TextView>(R.id.btnLog).setOnClickListener { showDiagnosticsDialog() }\n        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {\n'''
new = '''        findViewById<TextView>(R.id.btnLog).setOnClickListener { showDiagnosticsDialog() }\n        findViewById<TextView>(R.id.tvAppVersion).apply {\n            text = "v${BuildConfig.VERSION_NAME} • ${BuildConfig.OTA_CHANNEL.uppercase()}"\n            setOnClickListener { AppUpdater(this@MainActivity, app.diagnostics).check(showUpToDate = false) }\n        }\n        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {\n'''
if s.count(old) != 1: raise SystemExit('MainActivity version header guard')
s = s.replace(old, new, 1)
old = '''            renderForRole()\n            checkPendingAlerts()\n'''
new = '''            renderForRole()\n            ensureOverlayPermissionForPicker()\n            checkPendingAlerts()\n'''
if s.count(old) != 1: raise SystemExit('MainActivity overlay permission call guard')
s = s.replace(old, new, 1)
old = '''    private fun showPicker() {\n        val root = fixedPage(SCREEN_PICKER, "Báo thiếu hàng")\n        root.addView(text("Báo gần đây", 14, true).apply { setPadding(0, 0, 0, dp(4)) })\n        val historyScroll = ScrollView(this).apply { isFillViewport = true }\n        val recent = LinearLayout(this).apply {\n            orientation = LinearLayout.VERTICAL\n            gravity = Gravity.BOTTOM\n        }\n        historyScroll.addView(recent, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))\n        root.addView(historyScroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))\n\n        val suggestionsBox = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }\n'''
new = '''    private fun showPicker() {\n        val root = fixedPage(SCREEN_PICKER, "Báo thiếu hàng")\n        val recent = LinearLayout(this).apply {\n            orientation = LinearLayout.VERTICAL\n            gravity = Gravity.TOP\n        }\n\n        val suggestionsBox = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }\n'''
if s.count(old) != 1: raise SystemExit('MainActivity picker top layout guard')
s = s.replace(old, new, 1)
old = '''        root.addView(input, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(50)))\n        root.addView(reportButton, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)).apply { setMargins(0, dp(3), 0, 0) })\n\n        fun clearSelection() {\n'''
new = '''        root.addView(input, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(50)))\n        root.addView(reportButton, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)).apply { setMargins(0, dp(3), 0, dp(8)) })\n        root.addView(text("SKU đã báo hôm nay • cũ → mới", 14, true).apply { setPadding(0, dp(4), 0, dp(4)) })\n        val historyScroll = ScrollView(this).apply { isFillViewport = true }\n        historyScroll.addView(recent, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))\n        root.addView(historyScroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))\n\n        fun clearSelection() {\n'''
if s.count(old) != 1: raise SystemExit('MainActivity picker history placement guard')
s = s.replace(old, new, 1)
s = s.replace('                    target.gravity = Gravity.BOTTOM\n', '                    target.gravity = Gravity.TOP\n', 1)
s = s.replace('                    val ordered = issues.sortedByDescending { issue ->\n', '                    val ordered = issues.sortedBy { issue ->\n', 1)
old = '''                    (target.parent as? ScrollView)?.post { (target.parent as? ScrollView)?.fullScroll(View.FOCUS_DOWN) }\n'''
if s.count(old) != 1: raise SystemExit('MainActivity picker autoscroll guard')
s = s.replace(old, '', 1)
old = '''            if (!isFinishing && !isDestroyed) dialog.show()\n        }.onFailure { app.diagnostics.warn("pending_alert_check_failed", mapOf("error" to it.message.orEmpty())) }\n    }\n\n    private fun syncSheet() {\n'''
new = '''            if (!isFinishing && !isDestroyed) {\n                dialog.show()\n                dialog.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)\n            }\n        }.onFailure { app.diagnostics.warn("pending_alert_check_failed", mapOf("error" to it.message.orEmpty())) }\n    }\n\n    private fun ensureOverlayPermissionForPicker() {\n        if (app.session.effectiveRole != UserRole.PICKER || Settings.canDrawOverlays(this)) return\n        AlertDialog.Builder(this)\n            .setTitle("Bật cảnh báo toàn màn hình")\n            .setMessage("Bật quyền “Hiển thị trên ứng dụng khác” một lần để cảnh báo ĐÃ CÓ HÀNG / CHO PHÉP SKIP phủ toàn màn hình khi ứng dụng đang ở nền.")\n            .setNegativeButton("Để sau", null)\n            .setPositiveButton("Mở cài đặt") { _, _ ->\n                runCatching {\n                    startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))\n                }.onFailure { app.diagnostics.warn("overlay_settings_open_failed", mapOf("error" to it.message.orEmpty())) }\n            }\n            .show()\n    }\n\n    private fun syncSheet() {\n'''
if s.count(old) != 1: raise SystemExit('MainActivity full screen alert guard')
s = s.replace(old, new, 1)
p.write_text(s)

# Background overlay truly fills the screen.
replace_one(
    'app/src/main/java/vn/pickpack1291/baohang/notifications/OverlayAlertService.kt',
    '''        val height = (resources.displayMetrics.heightPixels * 0.40).toInt()\n        val params = WindowManager.LayoutParams(\n            (resources.displayMetrics.widthPixels * 0.94).toInt(), height,\n''',
    '''        val params = WindowManager.LayoutParams(\n            WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT,\n''',
    'OverlayAlertService full screen guard'
)

# Header: Log/Thoát row with version immediately beneath it.
p = Path('app/src/main/res/layout/activity_main.xml')
s = p.read_text()
if s.count('android:layout_height="64dp"') != 1: raise SystemExit('activity_main header height guard')
s = s.replace('android:layout_height="64dp"', 'android:layout_height="76dp"', 1)
old = '''        <TextView\n            android:id="@+id/btnLog"\n            android:layout_width="46dp"\n            android:layout_height="44dp"\n            android:contentDescription="Gửi log"\n            android:gravity="center"\n            android:text="Log"\n            android:textColor="@color/white"\n            android:textSize="12sp"\n            android:textStyle="bold" />\n\n        <TextView\n            android:id="@+id/btnLogout"\n            android:layout_width="52dp"\n            android:layout_height="44dp"\n            android:contentDescription="Đăng xuất"\n            android:gravity="center"\n            android:text="Thoát"\n            android:textColor="@color/white"\n            android:textSize="12sp"\n            android:textStyle="bold" />\n'''
new = '''        <LinearLayout\n            android:layout_width="98dp"\n            android:layout_height="match_parent"\n            android:gravity="center"\n            android:orientation="vertical">\n\n            <LinearLayout\n                android:layout_width="match_parent"\n                android:layout_height="42dp"\n                android:orientation="horizontal">\n\n                <TextView\n                    android:id="@+id/btnLog"\n                    android:layout_width="0dp"\n                    android:layout_height="match_parent"\n                    android:layout_weight="1"\n                    android:contentDescription="Gửi log"\n                    android:gravity="center"\n                    android:text="Log"\n                    android:textColor="@color/white"\n                    android:textSize="12sp"\n                    android:textStyle="bold" />\n\n                <TextView\n                    android:id="@+id/btnLogout"\n                    android:layout_width="0dp"\n                    android:layout_height="match_parent"\n                    android:layout_weight="1"\n                    android:contentDescription="Đăng xuất"\n                    android:gravity="center"\n                    android:text="Thoát"\n                    android:textColor="@color/white"\n                    android:textSize="12sp"\n                    android:textStyle="bold" />\n            </LinearLayout>\n\n            <TextView\n                android:id="@+id/tvAppVersion"\n                android:layout_width="match_parent"\n                android:layout_height="24dp"\n                android:contentDescription="Phiên bản ứng dụng; chạm để kiểm tra cập nhật"\n                android:gravity="center"\n                android:text="v0.0.0"\n                android:textColor="#C9DFEE"\n                android:textSize="10sp" />\n        </LinearLayout>\n'''
if s.count(old) != 1: raise SystemExit('activity_main actions guard')
s = s.replace(old, new, 1)
p.write_text(s)

# Source target: regular worker no longer polls staff. Manual recovery remains available.
replace_one('google-apps-script/DEPLOY_NEON.gs', '    maybeStaffSync_(token);\n', '', 'Apps Script staff polling call')

# Record the live Neon trigger correction in source control.
Path('sql/20260819_staff_realtime_coalesce.sql').write_text("""-- BÁO HÀNG 1291 — collapse profile changes into one staff invalidation per minute.\n-- Applied live first on Neon production tiny-boat-19315489 and recorded here for reproducibility.\ncreate or replace function public.queue_profile_realtime_event()\nreturns trigger\nlanguage plpgsql\nsecurity definer\nset search_path to ''\nas $function$\ndeclare\n  bucket text := floor(extract(epoch from clock_timestamp()) / 60)::bigint::text;\nbegin\n  insert into public.realtime_events(topic,event_type,entity_id,payload,dedupe_key)\n  values(\n    'staff',\n    'staff_changed',\n    'staff',\n    jsonb_build_object('updated_at',new.updated_at),\n    'staff:minute:' || bucket\n  )\n  on conflict(dedupe_key) do update set\n    entity_id = 'staff',\n    payload = excluded.payload,\n    created_at = clock_timestamp(),\n    published_at = null,\n    attempts = 0,\n    last_error = '';\n  return new;\nend\n$function$;\n""")

print('PATCH_REALTIME_UI_20260819=PASS')
