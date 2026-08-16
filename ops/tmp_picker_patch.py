from pathlib import Path
import re


def read(path):
    return Path(path).read_text()


def write(path, text):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(text)


def once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, got {count}")
    return text.replace(old, new, 1)


def sub_once(text, pattern, repl, label):
    out, count = re.subn(pattern, repl, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 regex match, got {count}")
    return out


# Android models.
p = "app/src/main/java/vn/pickpack1291/baohang/data/Models.kt"
s = read(p)
s = once(
    s,
    '    SKIP_ALLOWED("SKIP_ALLOWED", "ĐƯỢC PHÉP BỎ QUA • TIẾP TỤC CÔNG VIỆC", true),\n    CLOSED("CLOSED", "ĐÃ ĐÓNG");',
    '    SKIP_ALLOWED("SKIP_ALLOWED", "ĐƯỢC PHÉP BỎ QUA • TIẾP TỤC CÔNG VIỆC", true),\n    CLOSED("CLOSED", "ĐÃ ĐÓNG"),\n    WITHDRAWN("WITHDRAWN", "ĐÃ THU HỒI");',
    "models status",
)
s = once(
    s,
    '    val previousIssueId: String? = null,\n    val recurrence30m: Boolean = false\n) {',
    '    val previousIssueId: String? = null,\n    val recurrence30m: Boolean = false,\n    val withdrawnAt: String = "",\n    val withdrawAllowedUntil: String = "",\n    val canWithdraw: Boolean = false\n) {',
    "models fields",
)
s = once(
    s,
    '            previousIssueId = json.optString("previous_issue_id").ifBlank { null },\n            recurrence30m = json.optBoolean("recurrence_30m", false)\n',
    '            previousIssueId = json.optString("previous_issue_id").ifBlank { null },\n            recurrence30m = json.optBoolean("recurrence_30m", false),\n            withdrawnAt = json.optString("withdrawn_at"),\n            withdrawAllowedUntil = json.optString("withdraw_allowed_until"),\n            canWithdraw = json.optBoolean("can_withdraw", false)\n',
    "models parse",
)
s = once(
    s,
    'data class IssueBoard(\n    val open: List<StockIssue>,\n    val claimed: List<StockIssue>,\n    val recent: List<StockIssue>\n) {',
    'data class IssueBoard(\n    val open: List<StockIssue>,\n    val claimed: List<StockIssue>,\n    val recent: List<StockIssue>,\n    val withdrawn: List<StockIssue> = emptyList()\n) {',
    "board withdrawn",
)
write(p, s)

# Local numeric-only substring SKU search.
p = "app/src/main/java/vn/pickpack1291/baohang/data/AppDatabase.kt"
s = read(p)
marker = '    fun skuCount(): Int = readableDatabase.rawQuery("SELECT COUNT(*) FROM sku_catalog", null).use { if (it.moveToFirst()) it.getInt(0) else 0 }\n'
addition = '''    fun searchSkuDigits(query: String, limit: Int = 20): List<SkuItem> {
        val digits = query.trim()
        if (!digits.matches(Regex("\\d{3,}"))) return emptyList()
        val cursor = readableDatabase.rawQuery(
            """SELECT sku, product_name FROM sku_catalog
               WHERE sku LIKE ?
               ORDER BY CASE WHEN sku=? THEN 0 WHEN sku LIKE ? THEN 1 ELSE 2 END, sku
               LIMIT ?""",
            arrayOf("%$digits%", digits, "$digits%", limit.toString())
        )
        return cursor.use { buildList { while (it.moveToNext()) add(SkuItem(it.getString(0), it.getString(1))) } }
    }

'''
s = once(s, marker, addition + marker, "db digit search")
write(p, s)

# Repository routes.
p = "app/src/main/java/vn/pickpack1291/baohang/data/AppRepository.kt"
s = read(p)
s = once(
    s,
    '    fun searchSkus(query: String) = database.searchSkus(query)\n    suspend fun searchSkusOnline(query: String) = api.searchSkus(query)\n',
    '    fun searchSkus(query: String) = database.searchSkus(query)\n    suspend fun searchSkusOnline(query: String) = api.searchSkus(query)\n    fun searchSkuDigits(query: String) = database.searchSkuDigits(query)\n    suspend fun searchSkuDigitsOnline(query: String) = api.searchSkuDigits(query)\n    suspend fun withdrawShortage(issueId: String) = api.withdrawShortage(issueId)\n',
    "repository picker ops",
)
write(p, s)

# API client focused endpoint.
p = "app/src/main/java/vn/pickpack1291/baohang/network/ApiClient.kt"
s = read(p)
old = '''    suspend fun searchSkus(query: String, limit: Int = 20): List<SkuItem> {
        val response = invoke("search-skus", JSONObject().put("query", query).put("limit", limit))
        val array = response.optJSONArray("items") ?: JSONArray()
        return buildList {
            for (i in 0 until array.length()) {
                val item = array.getJSONObject(i)
                add(SkuItem(item.getString("sku"), item.getString("product_name")))
            }
        }
    }
'''
new = old + '''
    suspend fun searchSkuDigits(query: String, limit: Int = 20): List<SkuItem> {
        val response = invokeWithdraw("search", JSONObject().put("query", query).put("limit", limit))
        val array = response.optJSONArray("items") ?: JSONArray()
        return buildList {
            for (i in 0 until array.length()) {
                val item = array.getJSONObject(i)
                add(SkuItem(item.getString("sku"), item.getString("product_name")))
            }
        }
    }

    suspend fun withdrawShortage(issueId: String): JSONObject =
        invokeWithdraw("withdraw", JSONObject().put("issue_id", issueId))
'''
s = once(s, old, new, "api digit search")
s = once(
    s,
    '''    suspend fun issueBoard(): IssueBoard {
        val response = invoke("issue-board", JSONObject())
        return IssueBoard(
            open = response.optJSONArray("open").toStockIssues(),
            claimed = response.optJSONArray("claimed").toStockIssues(),
            recent = response.optJSONArray("recent").toStockIssues()
        )
    }
''',
    '''    suspend fun issueBoard(): IssueBoard {
        val response = invoke("issue-board", JSONObject())
        val withdrawn = runCatching { invokeWithdraw("board", JSONObject()).optJSONArray("withdrawn").toStockIssues() }.getOrDefault(emptyList())
        return IssueBoard(
            open = response.optJSONArray("open").toStockIssues(),
            claimed = response.optJSONArray("claimed").toStockIssues(),
            recent = response.optJSONArray("recent").toStockIssues(),
            withdrawn = withdrawn
        )
    }
''',
    "api board",
)
s = once(
    s,
    '    suspend fun myIssues(): List<StockIssue> = invoke("my-issues", JSONObject()).optJSONArray("issues").toStockIssues()\n',
    '    suspend fun myIssues(): List<StockIssue> = runCatching { invokeWithdraw("my", JSONObject()).optJSONArray("issues").toStockIssues() }\n        .getOrElse { invoke("my-issues", JSONObject()).optJSONArray("issues").toStockIssues() }\n',
    "api my issues",
)
anchor = '''    suspend fun invoke(action: String, payload: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        refreshSessionIfNeeded()
        request("POST", "$baseUrl/functions/v1/api/$action", payload, authenticated = true, eventName = "api_$action")
    }
'''
s = once(
    s,
    anchor,
    anchor
    + '''
    private suspend fun invokeWithdraw(action: String, payload: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        refreshSessionIfNeeded()
        request("POST", "$baseUrl/functions/v1/issue-withdraw/$action", payload, authenticated = true, eventName = "issue_withdraw_$action")
    }
''',
    "api focused endpoint",
)
write(p, s)

# Android main UI.
p = "app/src/main/java/vn/pickpack1291/baohang/ui/MainActivity.kt"
s = read(p)
s = once(
    s,
    "import androidx.appcompat.app.AppCompatActivity\n",
    "import androidx.appcompat.app.AppCompatActivity\nimport androidx.core.view.ViewCompat\nimport androidx.core.view.WindowInsetsCompat\n",
    "main inset imports",
)
s = once(
    s,
    '    private var realtimeAuthJob: Job? = null\n    private var currentScreen = ""\n',
    '    private var realtimeAuthJob: Job? = null\n    private var currentScreen = ""\n    private var inventSelectedTab = 0\n    private var inventRefresh: (() -> Unit)? = null\n    private var pickerRefresh: (() -> Unit)? = null\n',
    "main state",
)
s = once(
    s,
    '''                    when (currentScreen) {
                        SCREEN_INVENT -> showInventBoard()
                        SCREEN_PICKER -> lifecycleScope.launch { checkPendingAlerts() }
                    }
''',
    '''                    when (currentScreen) {
                        SCREEN_INVENT -> inventRefresh?.invoke() ?: showInventBoard()
                        SCREEN_PICKER -> {
                            pickerRefresh?.invoke()
                            lifecycleScope.launch { checkPendingAlerts() }
                        }
                    }
''',
    "realtime keep tab",
)
s = once(
    s,
    '''        setContentView(R.layout.activity_main)
        container = findViewById(R.id.contentContainer)
''',
    '''        setContentView(R.layout.activity_main)
        val rootMain = findViewById<View>(R.id.rootMain)
        ViewCompat.setOnApplyWindowInsetsListener(rootMain) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
        ViewCompat.requestApplyInsets(rootMain)
        container = findViewById(R.id.contentContainer)
''',
    "safe system bars",
)
s = once(
    s,
    '''    private fun page(title: String, screen: String): LinearLayout {
        currentScreen = screen
        container.removeAllViews()
''',
    '''    private fun page(title: String, screen: String): LinearLayout {
        currentScreen = screen
        if (screen != SCREEN_INVENT) inventRefresh = null
        if (screen != SCREEN_PICKER) pickerRefresh = null
        container.removeAllViews()
''',
    "page refresh owners",
)
new_board = r'''    private fun showInventBoard() {
        val content = page("Xử lý báo hàng", SCREEN_INVENT)
        val status = text("Đang tải dữ liệu…", 13, false).apply { setTextColor(getColor(R.color.text_secondary)) }
        val tabs = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val boardContainer = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        content.addView(status)
        content.addView(tabs)
        addDiagnosticsButton(content)
        content.addView(boardContainer)

        var board: IssueBoard? = null
        var selected = inventSelectedTab.coerceIn(0, 4)
        val tabButtons = mutableListOf<Button>()
        val tabBadges = mutableListOf<TextView>()
        fun updateTabs() {
            val counts = board?.let { listOf(it.open.size, it.claimed.size, it.available.size, it.skipped.size, it.withdrawn.size) } ?: listOf(0, 0, 0, 0, 0)
            tabButtons.forEachIndexed { index, tab ->
                val active = index == selected
                tab.setBackgroundResource(if (active) R.drawable.bg_button_primary else R.drawable.bg_button_secondary)
                tab.setTextColor(getColor(if (active) R.color.white else R.color.navy_900))
                tabBadges.getOrNull(index)?.let { badge ->
                    val count = counts.getOrElse(index) { 0 }
                    badge.text = if (count > 99) "99+" else count.toString()
                    badge.visibility = if (count > 0) View.VISIBLE else View.GONE
                }
            }
        }
        fun draw() {
            val data = board ?: return
            val list = when (selected) {
                1 -> data.claimed
                2 -> data.available
                3 -> data.skipped
                4 -> data.withdrawn
                else -> data.open
            }
            boardContainer.removeAllViews()
            if (list.isEmpty()) boardContainer.addView(infoBox("Không có SKU trong nhóm này."))
            list.forEach { issue -> boardContainer.addView(issueCard(issue, selected) { inventRefresh?.invoke() }) }
            status.text = when (selected) {
                1 -> "${list.size} SKU đang xử lý${if (app.session.effectiveRole == UserRole.INVENT) " của tôi" else ""}"
                2 -> "${list.size} SKU đã có hàng"
                3 -> "${list.size} SKU đã được cho SKIP"
                4 -> "${list.size} lượt Người lấy hàng đã thu hồi SKU"
                else -> "${list.size} SKU đang chờ xử lý"
            }
            updateTabs()
        }
        val labels = listOf("Chờ xử lý", "Đang xử lý", "Đã có hàng", "Đã bỏ qua", "Người lấy hàng thu hồi SKU")
        labels.chunked(2).forEachIndexed { rowIndex, rowLabels ->
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
            rowLabels.forEachIndexed { columnIndex, label ->
                val index = rowIndex * 2 + columnIndex
                val tab = button(label) { selected = index; inventSelectedTab = index; draw() }
                val badge = text("", 11, true).apply {
                    gravity = Gravity.CENTER
                    setTextColor(getColor(R.color.white))
                    minWidth = dp(22)
                    minHeight = dp(22)
                    setPadding(dp(5), 0, dp(5), 0)
                    background = GradientDrawable().apply {
                        shape = GradientDrawable.RECTANGLE
                        cornerRadius = dp(12).toFloat()
                        setColor(getColor(R.color.red_600))
                        setStroke(dp(2), getColor(R.color.white))
                    }
                    elevation = dp(4).toFloat()
                    visibility = View.GONE
                }
                val tabFrame = FrameLayout(this)
                tabFrame.addView(tab, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48), Gravity.BOTTOM))
                tabFrame.addView(badge, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(24), Gravity.TOP or Gravity.END).apply { setMargins(0, 0, dp(1), 0) })
                tabButtons += tab
                tabBadges += badge
                row.addView(tabFrame, LinearLayout.LayoutParams(0, dp(52), 1f).apply { setMargins(dp(2), dp(1), dp(2), dp(1)) })
            }
            tabs.addView(row, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }
        tabs.setPadding(0, dp(3), 0, dp(7))
        updateTabs()
        inventRefresh = { loadInventBoard(status) { board = it; draw() } }
        inventRefresh?.invoke()
    }
'''
s = sub_once(
    s,
    r"    private fun showInventBoard\(\) \{.*?\n    \}\n\n    private fun loadInventBoard",
    new_board + "\n    private fun loadInventBoard",
    "replace invent board",
)
s = once(
    s,
    '        card.addView(text("${issue.status.label} • ${issue.reportCount} lượt • v${issue.issueVersion}$recurrent", 12, false).apply { setTextColor(getColor(R.color.text_secondary)) })\n',
    '        val issueSummary = if (bucket == 4) "${issue.status.label} • v${issue.issueVersion}" else "${issue.status.label} • ${issue.reportCount} lượt • v${issue.issueVersion}$recurrent"\n        card.addView(text(issueSummary, 12, false).apply { setTextColor(getColor(R.color.text_secondary)) })\n        if (bucket == 4) {\n            card.addView(text("Người lấy hàng: ${issue.latestReporterName.ifBlank { "—" }} • Thu hồi lúc ${shortTime(issue.withdrawnAt)}", 12, false).apply { setTextColor(getColor(R.color.text_secondary)) })\n            card.addView(text(if (issue.latestMessage.isNotBlank()) issue.latestMessage else "Đã ghi nhận thu hồi báo thiếu.", 12, false).apply { setPadding(0, dp(4), 0, 0) })\n        }\n',
    "withdraw card detail",
)
s = once(
    s,
    '''                direct.addView(button("Cho phép bỏ qua", ButtonTone.DANGER) { confirmIssueUpdate(issue, "NOT_FOUND", refresh) }, LinearLayout.LayoutParams(0, dp(50), 1f).apply { setMargins(0, dp(5), dp(2), 0) })
                direct.addView(button("Đã có hàng", ButtonTone.SUCCESS) { confirmIssueUpdate(issue, "AVAILABLE", refresh) }, LinearLayout.LayoutParams(0, dp(50), 1f).apply { setMargins(dp(2), dp(5), 0, 0) })
''',
    '''                direct.addView(button("Có hàng", ButtonTone.SUCCESS) { confirmIssueUpdate(issue, "AVAILABLE", refresh) }, LinearLayout.LayoutParams(0, dp(50), 1f).apply { setMargins(0, dp(5), dp(2), 0) })
                direct.addView(button("Cho SKIP", ButtonTone.DANGER) { confirmIssueUpdate(issue, "NOT_FOUND", refresh) }, LinearLayout.LayoutParams(0, dp(50), 1f).apply { setMargins(dp(2), dp(5), 0, 0) })
''',
    "open actions",
)
s = once(
    s,
    '''        } else if (bucket == 1) {
            val actions = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
            actions.addView(button("Đã có hàng / đã châm hàng", ButtonTone.SUCCESS) { confirmIssueUpdate(issue, "AVAILABLE", refresh) })
            actions.addView(button("Không tìm thấy • cho phép bỏ qua", ButtonTone.DANGER) { confirmIssueUpdate(issue, "NOT_FOUND", refresh) })
            card.addView(actions)
''',
    '''        } else if (bucket == 1) {
            val actions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            actions.addView(button("Có hàng", ButtonTone.SUCCESS) { confirmIssueUpdate(issue, "AVAILABLE", refresh) }, LinearLayout.LayoutParams(0, dp(50), 1f).apply { setMargins(0, dp(5), dp(2), 0) })
            actions.addView(button("Cho SKIP", ButtonTone.DANGER) { confirmIssueUpdate(issue, "NOT_FOUND", refresh) }, LinearLayout.LayoutParams(0, dp(50), 1f).apply { setMargins(dp(2), dp(5), 0, 0) })
            card.addView(actions)
''',
    "claimed actions",
)
s = once(
    s,
    '        val firstMessage = if (isSkip) "Không tìm thấy SKU ${issue.sku}. Cho phép Người lấy hàng bỏ qua SKU này?" else "Xác nhận SKU ${issue.sku} đã có hàng hoặc đã châm hàng?"\n        AlertDialog.Builder(this).setTitle(if (isSkip) "Cho phép bỏ qua" else "Đã có hàng")\n',
    '        val firstMessage = if (isSkip) "Không tìm thấy SKU ${issue.sku}. Cho Người lấy hàng SKIP SKU này?" else "Xác nhận SKU ${issue.sku} hiện đã có hàng?"\n        AlertDialog.Builder(this).setTitle(if (isSkip) "Cho SKIP" else "Có hàng")\n',
    "confirm wording",
)

new_picker = r'''    private fun showPicker() {
        val content = page("Báo thiếu hàng", SCREEN_PICKER)
        content.addView(text("Nhập hoặc quét mã SKU", 14, true).apply { setPadding(0, 0, 0, dp(5)) })
        val input = AutoCompleteTextView(this).apply {
            hint = "Nhập ít nhất 3 số của SKU"
            threshold = 3
            inputType = InputType.TYPE_CLASS_NUMBER
            setSingleLine(true)
        }
        val suggestionsAdapter = ArrayAdapter<SkuItem>(this, android.R.layout.simple_dropdown_item_1line, mutableListOf())
        input.setAdapter(suggestionsAdapter)
        val selected = infoBox("Chưa chọn SKU")
        val reportButton = button("Báo thiếu", ButtonTone.DANGER) {}
        reportButton.isEnabled = false
        val recent = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        var chosen: SkuItem? = null
        content.addView(input)
        content.addView(selected)
        content.addView(reportButton, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(56)).apply { setMargins(0, dp(4), 0, dp(2)) })
        addDiagnosticsButton(content)
        content.addView(section("Báo gần đây"))
        content.addView(recent)
        fun select(item: SkuItem) {
            chosen = item
            selected.text = "SKU ${item.sku}\n${item.productName}"
            reportButton.isEnabled = true
            searchJob?.cancel()
            suggestionsAdapter.clear()
            input.dismissDropDown()
            input.setText("", false)
        }
        fun suggestions(query: String) {
            searchJob?.cancel()
            val requested = query.trim()
            if (!requested.matches(Regex("\\d{3,}"))) { suggestionsAdapter.clear(); input.dismissDropDown(); return }
            searchJob = lifecycleScope.launch {
                delay(180)
                val local = withContext(Dispatchers.IO) { app.repository.searchSkuDigits(requested) }
                val items = if (local.isNotEmpty()) local else runCatching { app.repository.searchSkuDigitsOnline(requested) }.getOrDefault(emptyList())
                if (input.text.toString().trim() != requested || !input.hasFocus()) return@launch
                suggestionsAdapter.clear()
                suggestionsAdapter.addAll(items)
                suggestionsAdapter.notifyDataSetChanged()
                if (items.isNotEmpty()) input.showDropDown() else input.dismissDropDown()
            }
        }
        input.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(v: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(v: CharSequence?, start: Int, before: Int, count: Int) {
                val raw = v?.toString().orEmpty()
                val digits = raw.filter(Char::isDigit)
                if (raw != digits) {
                    input.setText(digits, false)
                    input.setSelection(digits.length)
                    return
                }
                searchJob?.cancel()
                if (digits.length < 3) { suggestionsAdapter.clear(); input.dismissDropDown() } else suggestions(digits)
            }
            override fun afterTextChanged(v: Editable?) = Unit
        })
        input.setOnItemClickListener { parent, _, position, _ -> (parent.getItemAtPosition(position) as? SkuItem)?.let(::select) }
        reportButton.setOnClickListener {
            val item = chosen ?: return@setOnClickListener
            lifecycleScope.launch {
                reportButton.isEnabled = false
                runCatching { app.repository.reportShortage(item.sku) }
                    .onSuccess {
                        toast("Đã ghi nhận báo thiếu SKU ${item.sku}")
                        chosen = null
                        selected.text = "Chưa chọn SKU"
                        loadMyIssues(recent)
                        input.requestFocus()
                    }
                    .onFailure { toast(it.message ?: "Không gửi được báo thiếu") }
                reportButton.isEnabled = chosen != null
            }
        }
        pickerRefresh = { loadMyIssues(recent) }
        pickerRefresh?.invoke()
        input.requestFocus()
    }

    private fun loadMyIssues(target: LinearLayout) {
        lifecycleScope.launch {
            runCatching { app.repository.loadMyIssues() }
                .onSuccess { issues ->
                    target.removeAllViews()
                    if (issues.isEmpty()) target.addView(infoBox("Chưa có báo thiếu."))
                    issues.take(50).forEach { issue ->
                        val row = LinearLayout(this@MainActivity).apply {
                            orientation = LinearLayout.VERTICAL
                            setPadding(dp(12), dp(10), dp(12), dp(10))
                            setBackgroundResource(R.drawable.bg_card)
                        }
                        row.addView(text("${issue.status.label} • SKU ${issue.sku}", 16, true))
                        row.addView(text(issue.productName, 13, false).apply { setPadding(0, dp(2), 0, dp(2)) })
                        val time = if (issue.status == IssueStatus.WITHDRAWN && issue.withdrawnAt.isNotBlank()) "Thu hồi lúc ${shortTime(issue.withdrawnAt)}" else "Báo lúc ${shortTime(issue.reportedAt)}"
                        row.addView(text(time, 12, false).apply { setTextColor(getColor(R.color.text_secondary)) })
                        if (issue.canWithdraw) {
                            row.addView(button("Thu hồi báo thiếu", ButtonTone.DANGER) { confirmWithdrawIssue(issue, target) }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)).apply { setMargins(0, dp(6), 0, 0) })
                        }
                        target.addView(row, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { setMargins(0, dp(4), 0, dp(4)) })
                    }
                }.onFailure { target.removeAllViews(); target.addView(infoBox("Không tải được lịch sử: ${it.message}")) }
        }
    }

    private fun confirmWithdrawIssue(issue: StockIssue, target: LinearLayout) {
        AlertDialog.Builder(this)
            .setTitle("Thu hồi báo thiếu?")
            .setMessage("Thu hồi báo thiếu SKU ${issue.sku}? Thao tác chỉ hợp lệ trong 30 giây kể từ lúc báo.")
            .setNegativeButton("Không", null)
            .setPositiveButton("Có") { _, _ ->
                lifecycleScope.launch {
                    runCatching { app.repository.withdrawShortage(issue.id) }
                        .onSuccess { toast("Đã thu hồi SKU ${issue.sku}"); loadMyIssues(target) }
                        .onFailure { toast(it.message ?: "Không thể thu hồi SKU") }
                }
            }.show()
    }
'''
s = sub_once(
    s,
    r"    private fun showPicker\(\) \{.*?\n    private fun showCatalog\(\)",
    new_picker + "\n    private fun showCatalog()",
    "replace picker",
)
old_diag = r'''    private fun addDiagnosticsButton(content: LinearLayout) {
        content.addView(button("Gửi chẩn đoán", ButtonTone.SECONDARY) {
            lifecycleScope.launch {
                runCatching { app.repository.sendDiagnosticLog() }
                    .onSuccess { toast(if (it.optBoolean("uploaded")) "Đã gửi dữ liệu chẩn đoán" else it.optString("message", "Chưa có dữ liệu chẩn đoán")) }
                    .onFailure { toast(it.message ?: "Không gửi được dữ liệu chẩn đoán") }
            }
        })
    }
'''
new_diag = r'''    private fun addDiagnosticsButton(content: LinearLayout) {
        content.addView(button("Gửi nhật ký chẩn đoán", ButtonTone.SECONDARY) {
            AlertDialog.Builder(this)
                .setTitle("Gửi nhật ký chẩn đoán?")
                .setMessage("Gửi dữ liệu chẩn đoán của ứng dụng để kiểm tra lỗi?")
                .setNegativeButton("Không", null)
                .setPositiveButton("Có") { _, _ ->
                    lifecycleScope.launch {
                        runCatching { app.repository.sendDiagnosticLog() }
                            .onSuccess { toast(if (it.optBoolean("uploaded")) "Đã gửi dữ liệu chẩn đoán" else it.optString("message", "Chưa có dữ liệu chẩn đoán")) }
                            .onFailure { toast(it.message ?: "Không gửi được dữ liệu chẩn đoán") }
                    }
                }.show()
        })
    }
'''
s = once(s, old_diag, new_diag, "diagnostic confirm")
write(p, s)

# Safe-area root.
p = "app/src/main/res/layout/activity_main.xml"
s = read(p)
s = once(
    s,
    '<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"\n    android:layout_width="match_parent"',
    '<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"\n    android:id="@+id/rootMain"\n    android:layout_width="match_parent"',
    "layout root id",
)
write(p, s)

# FCM operational withdrawal alert.
p = "app/src/main/java/vn/pickpack1291/baohang/notifications/StockMessagingService.kt"
s = read(p)
s = once(
    s,
    '''        val status = data["status"].orEmpty()
        if (status !in setOf("AVAILABLE", "SKIP_ALLOWED")) {
            app.diagnostics.info("picker_notification_suppressed", mapOf("status" to status))
            return
        }
        val body = data["message"].orEmpty().ifBlank { message.notification?.body.orEmpty() }
''',
    '''        val status = data["status"].orEmpty()
        val body = data["message"].orEmpty().ifBlank { message.notification?.body.orEmpty() }
        if (status == "WITHDRAWN") {
            if (app.session.isLoggedIn && app.session.effectiveRole.canProcessIssues) {
                NotificationHelper.alert(this, sku, status, body, eventId)
                app.diagnostics.info("withdrawal_notification_displayed", mapOf("event_id" to eventId, "issue_id" to issueId, "sku" to sku))
            }
            return
        }
        if (status !in setOf("AVAILABLE", "SKIP_ALLOWED")) {
            app.diagnostics.info("picker_notification_suppressed", mapOf("status" to status))
            return
        }
''',
    "fcm withdrawal",
)
write(p, s)

# Web focused API and role/navigation behavior.
p = "web-admin/src/main.js"
s = read(p)
s = once(s, "  refreshTimer: null,\n};", "  refreshTimer: null,\n  issueBucket: 'open',\n};", "web state bucket")
api_anchor = '''async function api(action, payload = {}) {
  await refreshSessionIfNeeded();
  const headers = { 'content-type': 'application/json', apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${state.session.access_token}` };
  if (state.testRole) headers['x-admin-test-role'] = state.testRole;
  const response = await fetch(`${API_BASE}/${encodeURIComponent(action)}`, { method: 'POST', headers, body: JSON.stringify(payload) });
  if (response.status === 401) {
    clearSession();
    renderLogin('Phiên đăng nhập đã hết hạn.');
    throw new Error('Phiên đăng nhập đã hết hạn.');
  }
  return parseResponse(response);
}
'''
s = once(
    s,
    api_anchor,
    api_anchor
    + '''async function issueWithdraw(action, payload = {}) {
  await refreshSessionIfNeeded();
  const headers = { 'content-type': 'application/json', apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${state.session.access_token}` };
  if (state.testRole) headers['x-admin-test-role'] = state.testRole;
  const response = await fetch(`${SUPABASE_URL}/functions/v1/issue-withdraw/${encodeURIComponent(action)}`, { method: 'POST', headers, body: JSON.stringify(payload) });
  return parseResponse(response);
}
''',
    "web focused api",
)
s = once(
    s,
    "  if(currentRole==='INVENT')return [['events','Sự kiện'],['sku','Danh mục SKU']];return [['picker','Báo thiếu hàng']];",
    "  if(currentRole==='INVENT')return [['events','Sự kiện']];return [['picker','Báo thiếu hàng']];",
    "invent no sku search",
)
new_events = r'''async function renderEvents() {
  const buckets = [['open','CHỜ NHẬN'],['claimed',`ĐANG XỬ LÝ${role()==='INVENT'?' CỦA TÔI':''}`],['recent','ĐÃ XỬ LÝ GẦN ĐÂY'],['withdrawn','NGƯỜI LẤY HÀNG THU HỒI SKU']];
  if (!buckets.some(([id]) => id === state.issueBucket)) state.issueBucket = 'open';
  $('#content').innerHTML = `<div class="heading"><div><p class="eyebrow">BÁO HÀNG</p><h2>Xử lý báo hàng</h2></div><button id="refreshBoard" class="secondary">Làm mới</button></div>
    <div class="subtabs">${buckets.map(([id,label])=>`<button data-bucket="${id}" class="${id===state.issueBucket?'active':''}">${label}</button>`).join('')}</div><div id="board"></div>`;
  let board = null;
  const draw = () => {
    const rows = board?.[state.issueBucket] || [];
    $('#board').innerHTML = rows.length ? rows.map((issue) => issueCard(issue, state.issueBucket)).join('') : `<div class="card muted">Không có SKU ở nhóm này.</div>`;
    $$('[data-claim]').forEach((b) => b.onclick = () => claimIssue(b.dataset.claim, load));
    $$('[data-action]').forEach((b) => b.onclick = () => issueAction(b.dataset.issue, b.dataset.action, b.dataset.sku, load));
    $$('[data-reassign]').forEach((b) => b.onclick = () => openReassign(b.dataset.reassign, b.dataset.sku, load));
  };
  const load = async () => {
    try {
      const [mainBoard, withdrawalBoard] = await Promise.all([api('issue-board'), issueWithdraw('board').catch(() => ({withdrawn:[]}))]);
      board = { ...mainBoard, withdrawn: withdrawalBoard.withdrawn || [] };
      draw();
    } catch (error) { $('#board').innerHTML = `<div class="message" data-type="error">${escapeHtml(safeMessage(error))}</div>`; }
  };
  $('#refreshBoard').onclick = load;
  $$('[data-bucket]').forEach((b) => b.onclick = () => { state.issueBucket = b.dataset.bucket; $$('[data-bucket]').forEach((x) => x.classList.toggle('active', x === b)); draw(); });
  load();
}
function issueCard(issue, bucket) {
  const recurrence = issue.recurrence_30m ? '<span class="badge warn">BÁO LẠI TRONG 30 PHÚT</span>' : '';
  const assignment = issue.assigned_name ? ` · Xử lý: ${escapeHtml(issue.assigned_name)}` : '';
  if (bucket === 'withdrawn') {
    return `<article class="card issue"><div class="issue-top"><div><strong>SKU ${escapeHtml(issue.sku)}</strong><span>ĐÃ THU HỒI · v${Number(issue.issue_version || 1)}</span></div><time>${formatTime(issue.withdrawn_at || issue.updated_at)}</time></div><p>${escapeHtml(issue.product_name)}</p><small>Người lấy hàng: ${escapeHtml(issue.latest_reporter_name || '—')}</small><p class="muted">${escapeHtml(issue.latest_message || 'Đã ghi nhận thu hồi báo thiếu.')}</p></article>`;
  }
  const header = `<article class="card issue"><div class="issue-top"><div><strong>SKU ${escapeHtml(issue.sku)}</strong><span>${Number(issue.report_count || 1)} lượt · v${Number(issue.issue_version || 1)}</span></div><time>${formatTime(issue.reported_at)}</time></div><p>${escapeHtml(issue.product_name)}</p><small>${escapeHtml(statusLabel(issue.status))}${assignment}</small>${recurrence}`;
  if (bucket === 'open') {
    return `${header}<div class="actions"><button class="secondary" data-claim="${issue.id}">NHẬN XỬ LÝ</button>${elevated() ? `<button class="primary" data-action="AVAILABLE" data-issue="${issue.id}" data-sku="${escapeHtml(issue.sku)}">CÓ HÀNG</button><button class="danger" data-action="NOT_FOUND" data-issue="${issue.id}" data-sku="${escapeHtml(issue.sku)}">CHO SKIP</button>` : ''}</div></article>`;
  }
  if (bucket === 'claimed') {
    return `${header}<div class="actions"><button class="primary" data-action="AVAILABLE" data-issue="${issue.id}" data-sku="${escapeHtml(issue.sku)}">CÓ HÀNG</button><button class="danger" data-action="NOT_FOUND" data-issue="${issue.id}" data-sku="${escapeHtml(issue.sku)}">CHO SKIP</button>${elevated() ? `<button class="secondary" data-reassign="${issue.id}" data-sku="${escapeHtml(issue.sku)}">ĐIỀU PHỐI LẠI</button>` : ''}</div></article>`;
  }
  return `${header}</article>`;
}
'''
s = sub_once(s, r"async function renderEvents\(\) \{.*?\nfunction statusLabel\(status\)", new_events + "function statusLabel(status)", "web events")
s = once(
    s,
    "  return ({ OPEN:'Chờ nhận', CLAIMED:'Đang xử lý', SEARCHING:'Đang xử lý', REPLENISHING:'Đang xử lý', AVAILABLE:'Đã có hàng/châm bù', SKIP_ALLOWED:'Được phép skip', CLOSED:'Đã đóng' })[status] || status;",
    "  return ({ OPEN:'Chờ nhận', CLAIMED:'Đang xử lý', SEARCHING:'Đang xử lý', REPLENISHING:'Đang xử lý', AVAILABLE:'Đã có hàng', SKIP_ALLOWED:'Được phép SKIP', CLOSED:'Đã đóng', WITHDRAWN:'Đã thu hồi' })[status] || status;",
    "web status labels",
)
new_web_picker = r'''function renderPicker() {
  $('#content').innerHTML = `<div class="heading"><div><p class="eyebrow">PICKER</p><h2>Người lấy hàng</h2></div></div>
    <div class="card"><label>Nhập hoặc quét mã SKU<input id="skuSearch" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="Nhập ít nhất 3 số của SKU"></label><div id="skuResults" class="search-results"></div>
    <div id="selectedSku" class="selected muted">Chưa chọn SKU</div><button id="reportShortage" class="danger wide" disabled>BÁO THIẾU</button><div id="pickerMsg" class="message" hidden></div></div>
    <div class="heading compact"><h3>Báo gần đây của tôi</h3><button id="refreshMine" class="secondary">Làm mới</button></div><div id="myIssues"></div><div id="pendingAlert"></div>`;
  let timer;
  state.selectedSku = null;
  $('#skuSearch').addEventListener('input', (event) => {
    event.target.value = event.target.value.replace(/\D/g,'');
    clearTimeout(timer);
    if (event.target.value.length < 3) { $('#skuResults').innerHTML = ''; return; }
    timer = setTimeout(searchSku, 180);
  });
  $('#reportShortage').onclick = reportShortage;
  $('#refreshMine').onclick = loadMyIssues;
  loadMyIssues();
  loadPendingAlerts();
  $('#skuSearch').focus();
}
async function searchSku() {
  const input = $('#skuSearch');
  const query = input?.value.trim();
  if (!/^\d{3,}$/.test(query || '')) { $('#skuResults').innerHTML = ''; return; }
  try {
    const data = await issueWithdraw('search',{ query, limit:20 });
    if (input.value.trim() !== query) return;
    $('#skuResults').innerHTML = data.items.map((item, index) => `<button data-result="${index}"><strong>${escapeHtml(item.sku)}</strong><span>${escapeHtml(item.product_name)}</span></button>`).join('');
    $$('[data-result]').forEach((button) => button.onclick = () => selectSku(data.items[Number(button.dataset.result)]));
  } catch (error) { message('#pickerMsg', safeMessage(error), 'error'); }
}
async function selectSku(item){state.selectedSku=item;$('#selectedSku').classList.remove('muted');$('#selectedSku').innerHTML=`<strong>SKU ${escapeHtml(item.sku)}</strong><span>${escapeHtml(item.product_name)}</span>`;$('#reportShortage').disabled=false;$('#skuResults').innerHTML='';}
async function reportShortage() {
  const item = state.selectedSku;
  if (!item || !confirm(`Báo thiếu SKU ${item.sku}?\n${item.product_name}`)) return;
  const button = $('#reportShortage');
  button.disabled = true;
  try {
    await api('report-shortage',{ sku:item.sku, client_request_id:uuid() });
    message('#pickerMsg', `Đã ghi nhận báo thiếu SKU ${item.sku}.`, 'good');
    state.selectedSku = null;
    $('#skuSearch').value = '';
    $('#selectedSku').textContent = 'Chưa chọn SKU';
    $('#selectedSku').classList.add('muted');
    await loadMyIssues();
    $('#skuSearch').focus();
  } catch (error) { message('#pickerMsg', safeMessage(error), 'error'); }
  finally { button.disabled = !state.selectedSku; }
}
async function loadMyIssues() {
  const target = $('#myIssues'); if (!target) return;
  try {
    const data = await issueWithdraw('my');
    target.innerHTML = data.issues.length ? data.issues.slice(0,50).map((issue) => `<article class="card"><strong>${escapeHtml(statusLabel(issue.status))} · SKU ${escapeHtml(issue.sku)}</strong><p>${escapeHtml(issue.product_name)}</p><small>${issue.status==='WITHDRAWN'?`Thu hồi lúc ${formatTime(issue.withdrawn_at)}`:`Báo lúc ${formatTime(issue.reported_at)}`}</small>${issue.can_withdraw?`<button class="danger" data-withdraw="${issue.id}" data-sku="${escapeHtml(issue.sku)}">THU HỒI BÁO THIẾU</button>`:''}</article>`).join('') : '<div class="card muted">Chưa có báo thiếu.</div>';
    $$('[data-withdraw]').forEach((button) => button.onclick = () => withdrawPickerReport(button.dataset.withdraw, button.dataset.sku));
  } catch (error) { target.innerHTML = `<div class="message" data-type="error">${escapeHtml(safeMessage(error))}</div>`; }
}
async function withdrawPickerReport(issueId, sku) {
  if (!confirm(`Thu hồi báo thiếu SKU ${sku}?\n\nChỉ có thể thu hồi trong 30 giây kể từ lúc báo.`)) return;
  try { setBusy(true,'Đang thu hồi báo thiếu…'); await issueWithdraw('withdraw',{issue_id:issueId}); message('#pickerMsg',`Đã thu hồi SKU ${sku}.`,'good'); await loadMyIssues(); }
  catch (error) { alert(safeMessage(error)); }
  finally { setBusy(false); }
}
'''
s = sub_once(s, r"function renderPicker\(\) \{.*?\nasync function loadPendingAlerts\(\)", new_web_picker + "\nasync function loadPendingAlerts()", "web picker")
write(p, s)

# Deployment/quality workflows.
p = ".github/workflows/deploy-backend.yml"
s = read(p)
s = once(
    s,
    '''      - name: Deploy lightweight Staff Watch Edge Function
        if: ${{ hashFiles('supabase/functions/staff-watch/index.ts') != '' }}
        run: supabase functions deploy staff-watch --no-verify-jwt --project-ref "$SUPABASE_PROJECT_ID"
''',
    '''      - name: Deploy lightweight Staff Watch Edge Function
        if: ${{ hashFiles('supabase/functions/staff-watch/index.ts') != '' }}
        run: supabase functions deploy staff-watch --no-verify-jwt --project-ref "$SUPABASE_PROJECT_ID"
      - name: Deploy Picker withdrawal Edge Function
        if: ${{ hashFiles('supabase/functions/issue-withdraw/index.ts') != '' }}
        run: supabase functions deploy issue-withdraw --no-verify-jwt --project-ref "$SUPABASE_PROJECT_ID"
''',
    "backend deploy workflow",
)
write(p, s)
p = ".github/workflows/quality-target.yml"
s = read(p)
s = once(
    s,
    "        run: deno check supabase/functions/_shared/fcm.ts supabase/functions/api/index.ts supabase/functions/web-api/index.ts supabase/functions/admin-ops/index.ts supabase/functions/staff-watch/index.ts\n",
    "        run: deno check supabase/functions/_shared/fcm.ts supabase/functions/api/index.ts supabase/functions/web-api/index.ts supabase/functions/admin-ops/index.ts supabase/functions/staff-watch/index.ts supabase/functions/issue-withdraw/index.ts\n",
    "quality edge check",
)
write(p, s)

# Database migration: 30-second authoritative withdrawal window per Picker report.
migration = r'''alter table public.issue_reports
  add column if not exists withdrawn_at timestamptz;

create index if not exists issue_reports_withdrawn_idx
  on public.issue_reports(withdrawn_at desc)
  where withdrawn_at is not null;

create or replace function public.withdraw_shortage_atomic(p_issue_id uuid, p_reporter uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_issue public.issues%rowtype;
  v_report public.issue_reports%rowtype;
  v_previous_withdrawal public.issue_reports%rowtype;
  v_from public.issue_status;
  v_remaining integer := 0;
  v_now timestamptz := now();
begin
  if p_reporter is null or not exists(select 1 from public.profiles where id=p_reporter and active=true) then
    raise exception 'USER_INACTIVE';
  end if;

  select * into v_issue from public.issues where id=p_issue_id;
  if not found then raise exception 'ISSUE_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended(lower(trim(v_issue.sku)),1291));
  select * into v_issue from public.issues where id=p_issue_id for update;
  v_from := v_issue.status;

  select * into v_report
    from public.issue_reports
   where issue_id=p_issue_id and reporter_id=p_reporter and withdrawn_at is null
   order by reported_at desc
   limit 1
   for update;

  if not found then
    select * into v_previous_withdrawal
      from public.issue_reports
     where issue_id=p_issue_id and reporter_id=p_reporter and withdrawn_at is not null
     order by withdrawn_at desc
     limit 1;
    if found then
      select count(*) into v_remaining from public.issue_reports where issue_id=p_issue_id and withdrawn_at is null;
      return jsonb_build_object(
        'issue', public.issue_json(v_issue),
        'withdrawn_at', v_previous_withdrawal.withdrawn_at,
        'remaining_report_count', v_remaining,
        'already_withdrawn', true
      );
    end if;
    raise exception 'REPORT_NOT_FOUND';
  end if;

  if v_now > v_report.reported_at + interval '30 seconds' then
    raise exception 'WITHDRAW_WINDOW_EXPIRED';
  end if;

  update public.issue_reports set withdrawn_at=v_now where id=v_report.id returning * into v_report;
  select count(*) into v_remaining from public.issue_reports where issue_id=p_issue_id and withdrawn_at is null;

  if v_remaining = 0 and v_issue.status in ('OPEN','CLAIMED','SEARCHING','REPLENISHING') then
    update public.issues
       set status='CLOSED', resolved_at=v_now, claimed_by=null, claimed_at=null,
           updated_at=v_now, issue_version=issue_version+1
     where id=p_issue_id
     returning * into v_issue;
  else
    update public.issues
       set updated_at=v_now, issue_version=issue_version+1
     where id=p_issue_id
     returning * into v_issue;
  end if;

  insert into public.issue_audit(issue_id,actor_id,action,from_status,to_status,detail)
  values(v_issue.id,p_reporter,'WITHDRAW_SHORTAGE',v_from,v_issue.status,
    jsonb_build_object('withdrawn_report_id',v_report.id,'withdrawn_at',v_now,'remaining_report_count',v_remaining,'issue_version',v_issue.issue_version));

  return jsonb_build_object(
    'issue', public.issue_json(v_issue),
    'withdrawn_at', v_now,
    'remaining_report_count', v_remaining,
    'already_withdrawn', false
  );
end;
$$;

revoke all on function public.withdraw_shortage_atomic(uuid,uuid) from public;
grant execute on function public.withdraw_shortage_atomic(uuid,uuid) to service_role;
'''
write("supabase/migrations/20260816083600_picker_withdraw_v1.sql", migration)

# Focused Edge Function: SKU-number search + withdrawal + operational alert.
edge = r'''import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { sendFcm } from "../_shared/fcm.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const WEB_ORIGIN = "https://bao-hang-1291.web.app";
type Role = "ADMIN" | "ADMIN_INVENT" | "INVENT" | "PICKER";
type Profile = { id:string; employee_code:string; full_name:string; role:Role; active:boolean };
type Context = { userId:string; profile:Profile; effectiveRole:Role; client:SupabaseClient };
class HttpError extends Error { constructor(public status:number, message:string){ super(message); } }
const errorText=(e:unknown)=>e instanceof Error?e.message:String(e);
function cors(req:Request){
  const origin=req.headers.get("origin")??"";
  return {
    "access-control-allow-origin": origin===WEB_ORIGIN?origin:WEB_ORIGIN,
    "access-control-allow-methods":"POST, OPTIONS",
    "access-control-allow-headers":"authorization, apikey, content-type, x-admin-test-role",
    "access-control-max-age":"86400",
    "vary":"Origin",
  };
}
function json(req:Request, body:unknown, status=200){return new Response(JSON.stringify(body),{status,headers:{...cors(req),"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}});}
function safeTestRole(raw:string|null):Role|null{const r=String(raw??"").trim().toUpperCase();return (["ADMIN_INVENT","INVENT","PICKER"] as string[]).includes(r)?r as Role:null;}
function requireRole(context:Context, roles:Role[]){if(!roles.includes(context.effectiveRole))throw new HttpError(403,"Bạn không có quyền thực hiện thao tác này");}
async function authenticated(req:Request):Promise<Context>{
  const authorization=req.headers.get("authorization")??"";
  if(!authorization.startsWith("Bearer "))throw new HttpError(401,"Phiên đăng nhập không hợp lệ");
  const client=createClient(SUPABASE_URL,ANON_KEY,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}});
  const {data:{user},error}=await client.auth.getUser();
  if(error||!user)throw new HttpError(401,"Phiên đăng nhập đã hết hạn");
  const {data:profile,error:pe}=await admin.from("profiles").select("id,employee_code,full_name,role,active").eq("id",user.id).single();
  if(pe||!profile?.active)throw new HttpError(403,"Tài khoản đã ngừng hoạt động");
  const typed=profile as Profile;
  const requested=safeTestRole(req.headers.get("x-admin-test-role"));
  if(req.headers.get("x-admin-test-role")&&!requested)throw new HttpError(400,"Chế độ kiểm thử quyền không hợp lệ");
  if(requested&&typed.role!=="ADMIN")throw new HttpError(403,"Chỉ Admin hệ thống được kiểm thử quyền");
  return {userId:user.id,profile:typed,effectiveRole:requested??typed.role,client};
}
function baseIssue(row:any){return {id:row.id,sku:row.sku,product_name:row.product_name_snapshot,status:row.status,report_count:Number(row.report_count??1),reported_at:row.first_reported_at,updated_at:row.updated_at,issue_version:Number(row.issue_version??1),assigned_id:row.claimed_by??null};}
async function issueMap(ids:string[]){
  if(!ids.length)return new Map<string,any>();
  const {data,error}=await admin.from("issues").select("id,sku,product_name_snapshot,status,report_count,first_reported_at,updated_at,issue_version,claimed_by").in("id",ids);
  if(error)throw error;return new Map((data??[]).map((row:any)=>[String(row.id),row]));
}
async function notifyOperators(context:Context, result:any){
  const issue=result.issue;const remaining=Number(result.remaining_report_count??0);
  const {data:users,error}=await admin.from("profiles").select("id").in("role",["ADMIN","ADMIN_INVENT","INVENT"]).eq("active",true);if(error)throw error;
  const ids=(users??[]).map((u:any)=>String(u.id));if(!ids.length)return;
  const {data:devices,error:de}=await admin.from("device_tokens").select("user_id,fcm_token").in("user_id",ids).eq("active",true);if(de)throw de;
  const message=remaining>0
    ? `${context.profile.full_name} đã thu hồi báo thiếu SKU ${issue.sku}. SKU này vẫn còn ${remaining} lượt báo chưa thu hồi, tiếp tục xử lý.`
    : `${context.profile.full_name} đã thu hồi báo thiếu SKU ${issue.sku}. Không còn Người lấy hàng nào chờ SKU này; có thể dừng tìm nếu chưa có nhu cầu khác.`;
  const invalid:string[]=[];
  await Promise.all((devices??[]).map(async(device:any)=>{
    const eventId=crypto.randomUUID();
    try{const r=await sendFcm(String(device.fcm_token),{event_id:eventId,issue_id:String(issue.id),issue_version:String(issue.issue_version??1),sku:String(issue.sku),product_name:String(issue.product_name??""),status:"WITHDRAWN",message,critical:"false"},{ttlSeconds:300,collapseKey:`withdraw-${issue.id}`,priority:"high"});if(r.invalidToken)invalid.push(String(device.fcm_token));}
    catch(e){console.warn("Withdrawal FCM deferred",errorText(e));}
  }));
  if(invalid.length)await admin.from("device_tokens").update({active:false}).in("fcm_token",invalid);
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors(req)});
  try{
    if(req.method!=="POST")throw new HttpError(405,"Chỉ hỗ trợ POST");
    const action=new URL(req.url).pathname.split("/").filter(Boolean).pop()??"";
    const body=await req.json().catch(()=>({})) as Record<string,unknown>;
    const context=await authenticated(req);
    if(action==="search"){
      requireRole(context,["PICKER"]);const q=String(body.query??"").trim();if(!/^\d{3,}$/.test(q))return json(req,{items:[]});
      const limit=Math.min(20,Math.max(1,Number(body.limit??20)));const {data,error}=await admin.from("sku_catalog").select("sku,product_name").eq("active",true).ilike("sku",`%${q}%`).order("sku").limit(limit);if(error)throw error;return json(req,{items:data??[]});
    }
    if(action==="my"){
      requireRole(context,["PICKER"]);
      const {data:reports,error}=await admin.from("issue_reports").select("id,issue_id,reported_at,withdrawn_at").eq("reporter_id",context.userId).order("reported_at",{ascending:false}).limit(500);if(error)throw error;
      const groups=new Map<string,{latest:any;active:any|null}>();
      for(const report of reports??[]){const id=String(report.issue_id);const g=groups.get(id)??{latest:report,active:null};if(!g.active&&!report.withdrawn_at)g.active=report;groups.set(id,g);}
      const byIssue=await issueMap([...groups.keys()]);const now=Date.now();const issues:any[]=[];
      for(const [id,g] of groups){const raw=byIssue.get(id);if(!raw)continue;const source=g.active??g.latest;const deadline=new Date(new Date(source.reported_at).getTime()+30000).toISOString();const withdrawn=!g.active&&Boolean(g.latest.withdrawn_at);const base=baseIssue(raw);delete base.report_count;issues.push({...base,status:withdrawn?"WITHDRAWN":raw.status,reported_at:source.reported_at,withdrawn_at:withdrawn?g.latest.withdrawn_at:null,withdraw_allowed_until:deadline,can_withdraw:Boolean(g.active)&&now<=new Date(deadline).getTime()});}
      issues.sort((a,b)=>new Date(b.reported_at).getTime()-new Date(a.reported_at).getTime());return json(req,{issues:issues.slice(0,200)});
    }
    if(action==="board"){
      requireRole(context,["ADMIN","ADMIN_INVENT","INVENT"]);
      const {data:reports,error}=await admin.from("issue_reports").select("id,issue_id,reporter_id,reported_at,withdrawn_at").not("withdrawn_at","is",null).order("withdrawn_at",{ascending:false}).limit(200);if(error)throw error;
      const byIssue=await issueMap([...new Set((reports??[]).map((r:any)=>String(r.issue_id)))]);const reporterIds=[...new Set((reports??[]).map((r:any)=>String(r.reporter_id)))];const names=new Map<string,string>();
      if(reporterIds.length){const {data:profiles,error:pe}=await admin.from("profiles").select("id,full_name").in("id",reporterIds);if(pe)throw pe;(profiles??[]).forEach((p:any)=>names.set(String(p.id),String(p.full_name??"")));}
      const withdrawn=(reports??[]).flatMap((report:any)=>{const raw=byIssue.get(String(report.issue_id));if(!raw)return[];const message=raw.status==="CLOSED"?"Không còn lượt báo nào chưa thu hồi; đợt xử lý đã đóng.":"SKU vẫn còn nhu cầu xử lý từ lượt báo khác.";return [{...baseIssue(raw),status:"WITHDRAWN",reported_at:report.reported_at,updated_at:report.withdrawn_at,withdrawn_at:report.withdrawn_at,latest_reporter_name:names.get(String(report.reporter_id))??"",latest_message:message,can_withdraw:false}];});
      return json(req,{withdrawn});
    }
    if(action==="withdraw"){
      requireRole(context,["PICKER"]);const issueId=String(body.issue_id??"").trim();if(!/^[0-9a-f-]{36}$/i.test(issueId))throw new HttpError(400,"Mã báo thiếu không hợp lệ");
      const {data,error}=await admin.rpc("withdraw_shortage_atomic",{p_issue_id:issueId,p_reporter:context.userId});if(error){const m=errorText(error);if(m.includes("WITHDRAW_WINDOW_EXPIRED"))throw new HttpError(409,"Đã quá 30 giây nên không thể thu hồi SKU này");if(m.includes("REPORT_NOT_FOUND"))throw new HttpError(404,"Không tìm thấy lượt báo đang có thể thu hồi");throw error;}
      await admin.from("notification_events").update({acknowledged_at:new Date().toISOString()}).eq("issue_id",issueId).eq("target_user_id",context.userId).is("acknowledged_at",null);
      if(!data.already_withdrawn)await notifyOperators(context,data);
      return json(req,{withdrawn:true,withdrawn_at:data.withdrawn_at,remaining_report_count:Number(data.remaining_report_count??0),already_withdrawn:Boolean(data.already_withdrawn)});
    }
    throw new HttpError(404,"Chức năng không tồn tại");
  }catch(e){console.error(errorText(e));return json(req,{error:errorText(e)},e instanceof HttpError?e.status:500);}
});
'''
write("supabase/functions/issue-withdraw/index.ts", edge)

# Clean temporary automation from product branch; main is cleaned by the agent after the run.
Path(".github/workflows/tmp-picker-ux-withdraw.yml").unlink(missing_ok=True)
Path("ops/tmp_picker_patch.py").unlink(missing_ok=True)
