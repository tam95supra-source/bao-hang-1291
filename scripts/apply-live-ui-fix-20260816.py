from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected exactly 1 match, found {count}: {old[:100]!r}")
    write(path, text.replace(old, new, 1))


def replace_all_required(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count < 1:
        raise RuntimeError(f"{path}: required text not found: {old!r}")
    write(path, text.replace(old, new))


def regex_once(path: str, pattern: str, replacement: str) -> None:
    text = read(path)
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"{path}: expected regex exactly once, found {count}: {pattern[:100]!r}")
    write(path, updated)


# 1) Web Realtime: browser Supabase Realtime needs wss:// allowed by Hosting CSP.
replace_once(
    "firebase.json",
    "connect-src 'self' https://oedasgcdjppjwidhlqdr.supabase.co;",
    "connect-src 'self' https://oedasgcdjppjwidhlqdr.supabase.co wss://oedasgcdjppjwidhlqdr.supabase.co;",
)

# Keep a regression assertion in the normal production Web deploy workflow.
replace_once(
    ".github/workflows/deploy-web-admin.yml",
    "          grep -qi '^content-security-policy:' \"$RUNNER_TEMP/web-headers.txt\"\n          grep -qi '^x-content-type-options: nosniff' \"$RUNNER_TEMP/web-headers.txt\"",
    "          grep -qi '^content-security-policy:' \"$RUNNER_TEMP/web-headers.txt\"\n          grep -qi 'wss://oedasgcdjppjwidhlqdr.supabase.co' \"$RUNNER_TEMP/web-headers.txt\"\n          grep -qi '^x-content-type-options: nosniff' \"$RUNNER_TEMP/web-headers.txt\"",
)
replace_once(
    ".github/workflows/deploy-web-admin.yml",
    "          test -f web-admin/dist/index.html\n          test -f web-admin/dist/MAU_NHAN_SU_BAO_HANG_1291.xlsx",
    "          test -f web-admin/dist/index.html\n          test -f web-admin/dist/MAU_NHAN_SU_BAO_HANG_1291.xlsx\n          grep -R -q 'site:1291:issues' web-admin/dist/assets",
)

# 2) Web Realtime subscriptions: do not join channels a role cannot read.
replace_once(
    "web-admin/src/main.js",
    "function healthChip(label, value, kind = '') { return `<span class=\"health-chip ${kind}\" data-health=\"${label}\"><b>${label}</b><em>${escapeHtml(value)}</em></span>`; }",
    "function healthChip(label, value, kind = '', displayLabel = label) { return `<span class=\"health-chip ${kind}\" data-health=\"${label}\"><b>${escapeHtml(displayLabel)}</b><em>${escapeHtml(value)}</em></span>`; }",
)
replace_once(
    "web-admin/src/main.js",
    "${healthChip('SERVICE','ONLINE','good')}${healthChip('REALTIME','ĐANG NỐI')}${healthChip('SHEET','—')}${healthChip('FREE TIER','GIÁM SÁT')}",
    "${healthChip('SERVICE','HOẠT ĐỘNG','good','DỊCH VỤ')}${healthChip('REALTIME','ĐANG KẾT NỐI','','CẬP NHẬT')}${healthChip('SHEET','—','','BÁO CÁO')}${healthChip('FREE TIER','ĐANG GIÁM SÁT','','CHI PHÍ')}",
)
replace_once(
    "web-admin/src/main.js",
    "  $('em', el).textContent = value;",
    "  const displayValue = ({ ONLINE:'TRỰC TUYẾN', FALLBACK:'TỰ LÀM MỚI', OFFLINE:'MẤT KẾT NỐI' })[value] || value;\n  $('em', el).textContent = displayValue;",
)
replace_once(
    "web-admin/src/main.js",
    "  state.issueChannel = realtimeClient.channel('site:1291:issues', { config: { private: true } })\n    .on('broadcast', { event: 'issue_changed' }, () => scheduleLiveRefresh('issue'))\n    .subscribe(subscribeStatus);\n  state.catalogChannel = realtimeClient.channel('site:1291:catalog', { config: { private: true } })\n    .on('broadcast', { event: 'catalog_changed' }, () => scheduleLiveRefresh('catalog')).subscribe(subscribeStatus);\n  state.staffChannel = realtimeClient.channel('site:1291:staff', { config: { private: true } })\n    .on('broadcast', { event: 'staff_changed' }, () => scheduleLiveRefresh('staff')).subscribe(subscribeStatus);",
    "  const canReceiveOperationalRealtime = ['ADMIN','ADMIN_INVENT','INVENT'].includes(actualRole());\n  state.catalogChannel = realtimeClient.channel('site:1291:catalog', { config: { private: true } })\n    .on('broadcast', { event: 'catalog_changed' }, () => scheduleLiveRefresh('catalog')).subscribe(subscribeStatus);\n  if (canReceiveOperationalRealtime) {\n    state.issueChannel = realtimeClient.channel('site:1291:issues', { config: { private: true } })\n      .on('broadcast', { event: 'issue_changed' }, () => scheduleLiveRefresh('issue'))\n      .subscribe(subscribeStatus);\n    state.staffChannel = realtimeClient.channel('site:1291:staff', { config: { private: true } })\n      .on('broadcast', { event: 'staff_changed' }, () => scheduleLiveRefresh('staff')).subscribe(subscribeStatus);\n  }",
)

# 3) Human wording on current Web UI and legacy/fallback renderers.
for old, new in [
    ("Thời gian nhận xử lý trung vị", "Một nửa đợt được nhận trong"),
    ("Thời gian xử lý xong trung vị", "Một nửa đợt xử lý xong trong"),
    ("Nhận xử lý trung vị", "Một nửa đợt được nhận trong"),
    ("Xử lý xong trung vị", "Một nửa đợt xử lý xong trong"),
    ("Đợt tái phát trong 30 ngày", "Đợt báo lại ≤30 phút (30 ngày)"),
    ("Đợt tái phát", "Đợt báo lại trong 30 phút"),
    ("Tái phát ≤30 phút", "Báo lại trong 30 phút"),
    ("Tái phát", "Báo lại trong 30 phút"),
    ("Database", "Dung lượng dữ liệu"),
]:
    text = read("web-admin/src/warehouse-ui-v2.js")
    if old in text:
        write("web-admin/src/warehouse-ui-v2.js", text.replace(old, new))

for old, new in [
    ("Picker / Người lấy hàng", "Người lấy hàng"),
    ("['picker','Picker']", "['picker','Báo thiếu hàng']"),
    (">Picker</button>", ">Người lấy hàng</button>"),
    ("Log & audit", "Nhật ký & kiểm tra"),
    ("['logs','Log']", "['logs','Nhật ký']"),
    ("<p class=\"eyebrow\">LIVE</p>", "<p class=\"eyebrow\">VẬN HÀNH</p>"),
    ("<p class=\"eyebrow\">EVENT</p>", "<p class=\"eyebrow\">BÁO HÀNG</p>"),
    ("<p class=\"eyebrow\">REPORT</p>", "<p class=\"eyebrow\">BÁO CÁO</p>"),
    ("<p class=\"eyebrow\">CATALOG</p>", "<p class=\"eyebrow\">DANH MỤC</p>"),
    ("Ticket phát sinh", "Đợt báo thiếu"),
    ("Ticket 30 ngày", "Đợt báo thiếu 30 ngày"),
    ("Ticket:", "Đợt báo thiếu:"),
    ("Cho SKIP", "Cho phép bỏ qua"),
    ("Auto SKIP 30 ngày", "Tự cho phép bỏ qua 30 ngày"),
    ("Trung vị nhận", "Một nửa đợt được nhận trong"),
    ("Trung vị hoàn tất", "Một nửa đợt xử lý xong trong"),
    ("P95 hoàn tất", "95% xử lý xong trong"),
    (" · P95: <b>", " · 95% xử lý xong trong: <b>"),
    ("Tái phát:", "Báo lại trong 30 phút:"),
    ("Kiểm soát free tier", "Kiểm soát gói miễn phí"),
    ("Database:", "Dung lượng dữ liệu:"),
]:
    text = read("web-admin/src/main.js")
    if old in text:
        write("web-admin/src/main.js", text.replace(old, new))

# 4) Android: notification-style counts on each inventory status tab.
replace_once(
    "app/src/main/java/vn/pickpack1291/baohang/ui/MainActivity.kt",
    "import android.graphics.Typeface\n",
    "import android.graphics.Typeface\nimport android.graphics.drawable.GradientDrawable\n",
)
replace_once(
    "app/src/main/java/vn/pickpack1291/baohang/ui/MainActivity.kt",
    "        val tabButtons = mutableListOf<Button>()\n        fun updateTabs() {\n            tabButtons.forEachIndexed { index, tab ->\n                val active = index == selected\n                tab.setBackgroundResource(if (active) R.drawable.bg_button_primary else R.drawable.bg_button_secondary)\n                tab.setTextColor(getColor(if (active) R.color.white else R.color.navy_900))\n            }\n        }",
    "        val tabButtons = mutableListOf<Button>()\n        val tabBadges = mutableListOf<TextView>()\n        fun updateTabs() {\n            val counts = board?.let { listOf(it.open.size, it.claimed.size, it.available.size, it.skipped.size) } ?: listOf(0, 0, 0, 0)\n            tabButtons.forEachIndexed { index, tab ->\n                val active = index == selected\n                tab.setBackgroundResource(if (active) R.drawable.bg_button_primary else R.drawable.bg_button_secondary)\n                tab.setTextColor(getColor(if (active) R.color.white else R.color.navy_900))\n                tabBadges.getOrNull(index)?.let { badge ->\n                    val count = counts.getOrElse(index) { 0 }\n                    badge.text = if (count > 99) \"99+\" else count.toString()\n                    badge.visibility = if (count > 0) View.VISIBLE else View.GONE\n                }\n            }\n        }",
)
replace_once(
    "app/src/main/java/vn/pickpack1291/baohang/ui/MainActivity.kt",
    "                val tab = button(label) { selected = index; draw() }\n                tabButtons += tab\n                row.addView(tab, LinearLayout.LayoutParams(0, dp(48), 1f).apply { setMargins(dp(2), dp(3), dp(2), dp(3)) })",
    "                val tab = button(label) { selected = index; draw() }\n                val badge = text(\"\", 11, true).apply {\n                    gravity = Gravity.CENTER\n                    setTextColor(getColor(R.color.white))\n                    minWidth = dp(22)\n                    minHeight = dp(22)\n                    setPadding(dp(5), 0, dp(5), 0)\n                    background = GradientDrawable().apply {\n                        shape = GradientDrawable.RECTANGLE\n                        cornerRadius = dp(12).toFloat()\n                        setColor(getColor(R.color.red_600))\n                        setStroke(dp(2), getColor(R.color.white))\n                    }\n                    elevation = dp(4).toFloat()\n                    visibility = View.GONE\n                }\n                val tabFrame = FrameLayout(this)\n                tabFrame.addView(tab, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48), Gravity.BOTTOM))\n                tabFrame.addView(badge, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(24), Gravity.TOP or Gravity.END).apply {\n                    setMargins(0, 0, dp(1), 0)\n                })\n                tabButtons += tab\n                tabBadges += badge\n                row.addView(tabFrame, LinearLayout.LayoutParams(0, dp(52), 1f).apply { setMargins(dp(2), dp(1), dp(2), dp(1)) })",
)

# 5) Android SKU search: debounce, stale-result guard, adapter reuse, no network on tiny queries.
replace_once(
    "app/src/main/java/vn/pickpack1291/baohang/ui/MainActivity.kt",
    "        val input = AutoCompleteTextView(this).apply { hint = \"Quét SKU / nhập tên sản phẩm\"; threshold = 1; setSingleLine(true) }\n        val selected = infoBox(\"Chưa chọn SKU\")",
    "        val input = AutoCompleteTextView(this).apply { hint = \"Quét SKU / nhập tên sản phẩm\"; threshold = 1; setSingleLine(true) }\n        val suggestionsAdapter = ArrayAdapter<SkuItem>(this, android.R.layout.simple_dropdown_item_1line, mutableListOf())\n        input.setAdapter(suggestionsAdapter)\n        val selected = infoBox(\"Chưa chọn SKU\")",
)
replace_once(
    "app/src/main/java/vn/pickpack1291/baohang/ui/MainActivity.kt",
    "            reportButton.isEnabled = true\n            input.setText(\"\")",
    "            reportButton.isEnabled = true\n            searchJob?.cancel()\n            suggestionsAdapter.clear()\n            input.dismissDropDown()\n            input.setText(\"\", false)",
)
replace_once(
    "app/src/main/java/vn/pickpack1291/baohang/ui/MainActivity.kt",
    "        fun suggestions(query: String) {\n            searchJob?.cancel(); searchJob = lifecycleScope.launch {\n                delay(120)\n                val local = withContext(Dispatchers.IO) { app.repository.searchSkus(query) }\n                val items = if (local.isNotEmpty()) local else runCatching { app.repository.searchSkusOnline(query) }.getOrDefault(emptyList())\n                input.setAdapter(ArrayAdapter(this@MainActivity, android.R.layout.simple_dropdown_item_1line, items)); if (items.isNotEmpty()) input.showDropDown()\n            }\n        }",
    "        fun suggestions(query: String) {\n            searchJob?.cancel()\n            val requested = query.trim()\n            if (requested.isBlank()) { suggestionsAdapter.clear(); input.dismissDropDown(); return }\n            searchJob = lifecycleScope.launch {\n                delay(220)\n                val local = withContext(Dispatchers.IO) { app.repository.searchSkus(requested) }\n                val items = if (local.isNotEmpty() || requested.length < 3) local else runCatching { app.repository.searchSkusOnline(requested) }.getOrDefault(emptyList())\n                if (input.text.toString().trim() != requested || !input.hasFocus()) return@launch\n                suggestionsAdapter.clear()\n                suggestionsAdapter.addAll(items)\n                suggestionsAdapter.notifyDataSetChanged()\n                if (items.isNotEmpty()) input.showDropDown() else input.dismissDropDown()\n            }\n        }",
)
replace_once(
    "app/src/main/java/vn/pickpack1291/baohang/ui/MainActivity.kt",
    "            override fun onTextChanged(v: CharSequence?, start: Int, before: Int, count: Int) { if (!v.isNullOrBlank()) suggestions(v.toString()) }",
    "            override fun onTextChanged(v: CharSequence?, start: Int, before: Int, count: Int) {\n                searchJob?.cancel()\n                if (v.isNullOrBlank()) { suggestionsAdapter.clear(); input.dismissDropDown() } else suggestions(v.toString())\n            }",
)
replace_once(
    "app/src/main/java/vn/pickpack1291/baohang/ui/MainActivity.kt",
    "                searchJob = lifecycleScope.launch {\n                    delay(120)\n                    val items = withContext(Dispatchers.IO) { app.repository.searchSkus(v.toString()) }\n                    result.text = if (items.isEmpty()) \"Không tìm thấy SKU phù hợp.\" else items.take(20).joinToString(\"\\n\") { \"${it.sku} • ${it.productName}\" }\n                }",
    "                val requested = v.toString()\n                searchJob = lifecycleScope.launch {\n                    delay(220)\n                    val items = withContext(Dispatchers.IO) { app.repository.searchSkus(requested) }\n                    if (input.text.toString() != requested) return@launch\n                    result.text = if (items.isEmpty()) \"Không tìm thấy SKU phù hợp.\" else items.take(20).joinToString(\"\\n\") { \"${it.sku} • ${it.productName}\" }\n                }",
)

# Fast exact SKU path and a simpler normalized fallback query locally.
regex_once(
    "app/src/main/java/vn/pickpack1291/baohang/data/AppDatabase.kt",
    r"    fun searchSkus\(query: String, limit: Int = 20\): List<SkuItem> \{.*?\n    \}\n\n    fun skuCount",
    """    fun searchSkus(query: String, limit: Int = 20): List<SkuItem> {
        val raw = query.trim()
        val normalized = normalize(raw)
        if (normalized.isBlank()) return emptyList()

        readableDatabase.rawQuery(
            "SELECT sku,product_name FROM sku_catalog WHERE sku=? LIMIT 1",
            arrayOf(raw)
        ).use { exact ->
            if (exact.moveToFirst()) return listOf(SkuItem(exact.getString(0), exact.getString(1)))
        }

        val tokens = normalized.split(' ').filter { it.isNotBlank() }.take(4)
        val where = tokens.joinToString(" AND ") { "search_text LIKE ?" }
        val args = mutableListOf<String>()
        tokens.forEach { token -> args += "%$token%" }
        args += raw
        args += "$raw%"
        args += limit.toString()
        val cursor = readableDatabase.rawQuery(
            """SELECT sku, product_name FROM sku_catalog
               WHERE $where
               ORDER BY CASE
                 WHEN sku=? THEN 0
                 WHEN sku LIKE ? THEN 1
                 ELSE 2 END, sku
               LIMIT ?""", args.toTypedArray()
        )
        return cursor.use { buildList { while (it.moveToNext()) add(SkuItem(it.getString(0), it.getString(1))) } }
    }

    fun skuCount""",
)

# 6) Reduce Realtime authorization noise on Android by joining only channels allowed for the real role.
replace_once(
    "app/src/main/java/vn/pickpack1291/baohang/realtime/RealtimeClient.kt",
    "import vn.pickpack1291.baohang.diagnostics.DiagnosticsLogger\n",
    "import vn.pickpack1291.baohang.diagnostics.DiagnosticsLogger\nimport vn.pickpack1291.baohang.data.UserRole\n",
)
replace_once(
    "app/src/main/java/vn/pickpack1291/baohang/realtime/RealtimeClient.kt",
    "    @Volatile private var accessToken = \"\"\n    @Volatile private var reconnectAttempt = 0",
    "    @Volatile private var accessToken = \"\"\n    @Volatile private var userRole = UserRole.PICKER\n    @Volatile private var reconnectAttempt = 0",
)
replace_once(
    "app/src/main/java/vn/pickpack1291/baohang/realtime/RealtimeClient.kt",
    "    fun start(token: String) {\n        accessToken = token",
    "    fun start(token: String, role: UserRole) {\n        accessToken = token\n        userRole = role",
)
replace_once(
    "app/src/main/java/vn/pickpack1291/baohang/realtime/RealtimeClient.kt",
    "            join(webSocket, ISSUE_TOPIC)\n            join(webSocket, CATALOG_TOPIC)\n            join(webSocket, STAFF_TOPIC)\n            join(webSocket, CONFIG_TOPIC)",
    "            join(webSocket, CATALOG_TOPIC)\n            if (userRole.canProcessIssues) {\n                join(webSocket, ISSUE_TOPIC)\n                join(webSocket, STAFF_TOPIC)\n            }\n            if (userRole in setOf(UserRole.ADMIN, UserRole.ADMIN_INVENT)) join(webSocket, CONFIG_TOPIC)",
)
replace_once(
    "app/src/main/java/vn/pickpack1291/baohang/ui/MainActivity.kt",
    "                        realtime.start(app.session.accessToken)",
    "                        realtime.start(app.session.accessToken, app.session.profile?.role ?: app.session.effectiveRole)",
)

# 7) Plain-language wording on Android.
for old, new in [
    ("TÁI PHÁT ≤30 PHÚT", "BÁO LẠI TRONG 30 PHÚT"),
    ("Thời gian nhận xử lý trung vị:", "Một nửa đợt được nhận trong:"),
    ("Thời gian xử lý xong trung vị:", "Một nửa đợt xử lý xong trong:"),
    ("Đợt tái phát:", "Đợt báo lại trong 30 phút:"),
]:
    text = read("app/src/main/java/vn/pickpack1291/baohang/ui/MainActivity.kt")
    if old in text:
        write("app/src/main/java/vn/pickpack1291/baohang/ui/MainActivity.kt", text.replace(old, new))

replace_once(
    "app/src/main/java/vn/pickpack1291/baohang/data/Models.kt",
    "    PICKER(\"PICKER\", \"Picker / Người lấy hàng\");",
    "    PICKER(\"PICKER\", \"Người lấy hàng\");",
)
replace_once(
    "app/src/main/java/vn/pickpack1291/baohang/data/Models.kt",
    "    OPEN(\"OPEN\", \"CHỜ NHẬN\"),",
    "    OPEN(\"OPEN\", \"CHỜ XỬ LÝ\"),",
)
replace_once(
    "app/src/main/java/vn/pickpack1291/baohang/data/Models.kt",
    "    SKIP_ALLOWED(\"SKIP_ALLOWED\", \"CHO PHÉP SKIP • TIẾP TỤC CÔNG VIỆC\", true),",
    "    SKIP_ALLOWED(\"SKIP_ALLOWED\", \"ĐƯỢC PHÉP BỎ QUA • TIẾP TỤC CÔNG VIỆC\", true),",
)

# Sanity: no secrets, no migration/data mutations, and all requested product surfaces changed.
required = {
    "firebase.json": ["wss://oedasgcdjppjwidhlqdr.supabase.co"],
    "web-admin/src/main.js": ["canReceiveOperationalRealtime", "Một nửa đợt được nhận trong"],
    "web-admin/src/warehouse-ui-v2.js": ["Một nửa đợt được nhận trong", "Đợt báo lại"],
    "app/src/main/java/vn/pickpack1291/baohang/ui/MainActivity.kt": ["tabBadges", "requested.length < 3", "BÁO LẠI TRONG 30 PHÚT"],
    "app/src/main/java/vn/pickpack1291/baohang/data/AppDatabase.kt": ["WHERE sku=? LIMIT 1", "take(4)"],
    "app/src/main/java/vn/pickpack1291/baohang/realtime/RealtimeClient.kt": ["userRole.canProcessIssues"],
}
for path, needles in required.items():
    text = read(path)
    for needle in needles:
        if needle not in text:
            raise RuntimeError(f"{path}: postcondition missing {needle!r}")

print("PATCH_APPLIED=PASS")
