from pathlib import Path


def require_replace(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"missing anchor: {label}")
    if text.count(old) != 1:
        raise SystemExit(f"ambiguous anchor {label}: {text.count(old)}")
    return text.replace(old, new, 1)


def replace_between(text: str, start: str, end: str, replacement: str, label: str) -> str:
    a = text.find(start)
    if a < 0:
        raise SystemExit(f"missing start: {label}")
    b = text.find(end, a)
    if b < 0:
        raise SystemExit(f"missing end: {label}")
    return text[:a] + replacement + text[b:]


main_path = Path("app/src/main/java/vn/pickpack1291/baohang/ui/MainActivity.kt")
src = main_path.read_text(encoding="utf-8")

src = require_replace(
    src,
    '    private var currentScreen = ""\n',
    '    private var currentScreen = ""\n'
    '    private var inventSelectedTab = 0\n'
    '    private var inventRefresh: (() -> Unit)? = null\n'
    '    private var inventRenderSignature = ""\n'
    '    private var activeAlertEventId: String? = null\n',
    "main activity state fields",
)

src = require_replace(
    src,
    '                        SCREEN_INVENT -> showInventBoard()\n',
    '                        SCREEN_INVENT -> inventRefresh?.invoke()\n',
    "realtime invent full rerender",
)

src = require_replace(
    src,
    '    private fun page(title: String, screen: String): LinearLayout {\n        currentScreen = screen\n',
    '    private fun page(title: String, screen: String): LinearLayout {\n'
    '        currentScreen = screen\n'
    '        if (screen != SCREEN_INVENT) {\n'
    '            inventRefresh = null\n'
    '            inventRenderSignature = ""\n'
    '        }\n',
    "page live state cleanup",
)

new_board = r'''    private fun showInventBoard() {
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

'''
src = replace_between(
    src,
    "    private fun showInventBoard() {\n",
    "    private fun loadInventBoard(status: TextView, onLoaded: (IssueBoard) -> Unit) {\n",
    new_board,
    "invent board",
)

src = require_replace(
    src,
    '                direct.addView(button("Cho phép bỏ qua", ButtonTone.DANGER) { confirmIssueUpdate(issue, "NOT_FOUND", refresh) }, LinearLayout.LayoutParams(0, dp(50), 1f).apply { setMargins(0, dp(5), dp(2), 0) })\n'
    '                direct.addView(button("Đã có hàng", ButtonTone.SUCCESS) { confirmIssueUpdate(issue, "AVAILABLE", refresh) }, LinearLayout.LayoutParams(0, dp(50), 1f).apply { setMargins(dp(2), dp(5), 0, 0) })\n',
    '                direct.addView(button("CÓ HÀNG", ButtonTone.SUCCESS) { confirmIssueUpdate(issue, "AVAILABLE", refresh) }, LinearLayout.LayoutParams(0, dp(50), 1f).apply { setMargins(0, dp(5), dp(2), 0) })\n'
    '                direct.addView(button("SKIP HÀNG", ButtonTone.DANGER) { confirmIssueUpdate(issue, "NOT_FOUND", refresh) }, LinearLayout.LayoutParams(0, dp(50), 1f).apply { setMargins(dp(2), dp(5), 0, 0) })\n',
    "open elevated action buttons",
)

src = require_replace(
    src,
    '            val actions = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }\n'
    '            actions.addView(button("Đã có hàng / đã châm hàng", ButtonTone.SUCCESS) { confirmIssueUpdate(issue, "AVAILABLE", refresh) })\n'
    '            actions.addView(button("Không tìm thấy • cho phép bỏ qua", ButtonTone.DANGER) { confirmIssueUpdate(issue, "NOT_FOUND", refresh) })\n'
    '            card.addView(actions)\n',
    '            val actions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }\n'
    '            actions.addView(button("CÓ HÀNG", ButtonTone.SUCCESS) { confirmIssueUpdate(issue, "AVAILABLE", refresh) }, LinearLayout.LayoutParams(0, dp(50), 1f).apply { setMargins(0, dp(5), dp(2), 0) })\n'
    '            actions.addView(button("SKIP HÀNG", ButtonTone.DANGER) { confirmIssueUpdate(issue, "NOT_FOUND", refresh) }, LinearLayout.LayoutParams(0, dp(50), 1f).apply { setMargins(dp(2), dp(5), 0, 0) })\n'
    '            card.addView(actions)\n',
    "claimed action buttons",
)

new_pending = r'''    private suspend fun checkPendingAlerts() {
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

'''
src = replace_between(
    src,
    "    private suspend fun checkPendingAlerts() {\n",
    "    private fun syncSheet() {\n",
    new_pending,
    "pending alerts",
)

required_main = [
    'private var inventSelectedTab = 0',
    'SCREEN_INVENT -> inventRefresh?.invoke()',
    'totalBadge.text = "${data.open.size + data.claimed.size} SKU"',
    'button("CÓ HÀNG"',
    'button("SKIP HÀNG"',
    'Cảnh báo này chỉ hiển thị lần đầu của đợt SKU.',
]
for token in required_main:
    if token not in src:
        raise SystemExit(f"main guardrail missing: {token}")
main_path.write_text(src, encoding="utf-8")

web_path = Path("web-admin/src/main.js")
web = web_path.read_text(encoding="utf-8")
web = require_replace(
    web,
    "  await realtimeClient.realtime.setAuth();\n}",
    "  await realtimeClient.realtime.setAuth(state.session.access_token);\n}",
    "explicit realtime JWT",
)
if "await realtimeClient.realtime.setAuth(state.session.access_token);" not in web:
    raise SystemExit("web realtime explicit JWT guardrail missing")
web_path.write_text(web, encoding="utf-8")

print("PATCH_REALTIME_UI=PASS")
