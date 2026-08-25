from pathlib import Path

p = Path('app/src/main/java/vn/pickpack1291/baohang/ui/MainActivity.kt')
s = p.read_text()

def rep(old, new, name):
    global s
    n = s.count(old)
    if n != 1:
        raise SystemExit(f'{name}: expected 1 match, got {n}')
    s = s.replace(old, new, 1)

rep(
'''    private var inventRefresh: (() -> Unit)? = null
    private var pickerRefresh: (() -> Unit)? = null

    private enum class ButtonTone { PRIMARY, SECONDARY, SUCCESS, DANGER }''',
'''    private var inventRefresh: (() -> Unit)? = null
    private var pickerRefresh: (() -> Unit)? = null

    private data class PendingPickerReport(val item: SkuItem, val reportedAt: String)
    private data class PendingInventAction(val issue: StockIssue, val targetStatus: IssueStatus, val changedAt: String)
    private val pickerPendingReports = linkedMapOf<String, PendingPickerReport>()
    private val pendingInventActions = linkedMapOf<String, PendingInventAction>()

    private enum class ButtonTone { PRIMARY, SECONDARY, SUCCESS, DANGER }''',
'pending-state')

rep(
'''    private fun showInventBoard() {
        val isInvent = app.session.effectiveRole == UserRole.INVENT''',
'''    private fun applyPendingInventActions(source: IssueBoard): IssueBoard {
        var open = source.open
        var claimed = source.claimed
        var recent = source.recent
        val profile = app.session.profile
        pendingInventActions.values.forEach { pending ->
            val issueId = pending.issue.id
            val canonical = (claimed + recent + open).firstOrNull { it.id == issueId } ?: pending.issue
            val actorName = profile?.fullName.orEmpty()
            val optimistic = canonical.copy(
                status = pending.targetStatus,
                updatedAt = pending.changedAt,
                assignedName = actorName.ifBlank { canonical.assignedName },
                handledByName = actorName.ifBlank { canonical.handledByName },
                assignedId = profile?.id ?: canonical.assignedId,
                inventRespondedAt = pending.changedAt
            )
            open = open.filterNot { it.id == issueId }
            claimed = claimed.filterNot { it.id == issueId }
            recent = listOf(optimistic) + recent.filterNot { it.id == issueId }
        }
        return IssueBoard(open = open, claimed = claimed, recent = recent, withdrawn = source.withdrawn)
    }

    private fun showInventBoard() {
        val isInvent = app.session.effectiveRole == UserRole.INVENT''',
'invent-overlay-helper')

rep(
'''        root.addView(tabs, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(60)))''',
'''        root.addView(tabs, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(66)))''',
'tab-root-height')

rep(
'''        fun updateTabs() {
            val counts = board?.let { listOf(it.claimedCount, it.availableCount, it.skippedCount, it.withdrawnCount) } ?: listOf(0, 0, 0, 0)
            tabButtons.forEachIndexed { index, tab ->
                val active = index == selected
                tab.setBackgroundResource(if (active) R.drawable.bg_button_primary else R.drawable.bg_button_secondary)
                tab.setTextColor(getColor(if (active) R.color.white else R.color.navy_900))''',
'''        fun effectiveBoard(): IssueBoard? = board?.let(::applyPendingInventActions)

        fun updateTabs() {
            val counts = effectiveBoard()?.let { listOf(it.claimedCount, it.availableCount, it.skippedCount, it.withdrawnCount) } ?: listOf(0, 0, 0, 0)
            tabButtons.forEachIndexed { index, tab ->
                val active = index == selected
                tab.setBackgroundResource(if (active) R.drawable.bg_button_primary else R.drawable.bg_button_secondary)
                tab.setTextColor(getColor(if (active) R.color.white else R.color.navy_900))
                tab.setPadding(dp(2), dp(4), dp(2), dp(7))''',
'effective-tabs')

rep(
'''        fun draw() {
            val data = board ?: return''',
'''        fun draw() {
            val data = effectiveBoard() ?: return''',
'effective-draw')

rep(
'''            ordered.forEach { issue -> boardContainer.addView(issueCard(issue, selected) { inventRefresh?.invoke() }) }''',
'''            ordered.forEach { issue ->
                boardContainer.addView(issueCard(issue, selected, { inventRefresh?.invoke() }, { draw() }))
            }''',
'issue-card-call')

rep(
'''                setPadding(dp(2), dp(2), dp(2), dp(2))
                setSingleLine(false)
                maxLines = 2
                gravity = Gravity.CENTER
                textAlignment = View.TEXT_ALIGNMENT_CENTER
                includeFontPadding = false
                setAutoSizeTextTypeUniformWithConfiguration(11, 13, 1, TypedValue.COMPLEX_UNIT_SP)''',
'''                setPadding(dp(2), dp(4), dp(2), dp(7))
                setSingleLine(false)
                maxLines = 2
                gravity = Gravity.CENTER
                textAlignment = View.TEXT_ALIGNMENT_CENTER
                includeFontPadding = true
                setLineSpacing(dp(1).toFloat(), 1f)
                setAutoSizeTextTypeUniformWithConfiguration(11, 13, 1, TypedValue.COMPLEX_UNIT_SP)''',
'tab-text-spacing')

rep(
'''            tabFrame.addView(tab, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(56), Gravity.CENTER))''',
'''            tabFrame.addView(tab, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(62), Gravity.CENTER))''',
'tab-frame-height')

rep(
'''            tabs.addView(tabFrame, LinearLayout.LayoutParams(0, dp(58), 1f).apply {''',
'''            tabs.addView(tabFrame, LinearLayout.LayoutParams(0, dp(64), 1f).apply {''',
'tab-cell-height')

rep(
'''    private fun issueCard(issue: StockIssue, bucket: Int, refresh: () -> Unit): View {''',
'''    private fun issueCard(issue: StockIssue, bucket: Int, refresh: () -> Unit, redraw: () -> Unit): View {''',
'issue-card-signature')

rep(
'''            button("Có hàng", ButtonTone.SUCCESS) { confirmIssueUpdate(issue, "AVAILABLE", refresh) }.apply {''',
'''            button("Có hàng", ButtonTone.SUCCESS) { confirmIssueUpdate(issue, "AVAILABLE", refresh, redraw) }.apply {''',
'available-action')

rep(
'''            button("Cho SKIP", ButtonTone.DANGER) { confirmIssueUpdate(issue, "NOT_FOUND", refresh) }.apply {''',
'''            button("Cho SKIP", ButtonTone.DANGER) { confirmIssueUpdate(issue, "NOT_FOUND", refresh, redraw) }.apply {''',
'skip-action')

rep(
'''                button("Báo lại\\nđã có hàng", ButtonTone.SUCCESS) { confirmRestoreSkipped(issue, refresh) }.apply {
                    textSize = 12f
                    minHeight = 0
                    minimumHeight = 0
                    setSingleLine(false)
                    maxLines = 2
                    gravity = Gravity.CENTER
                    includeFontPadding = false
                    setPadding(dp(6), dp(2), dp(6), dp(2))
                    setAutoSizeTextTypeUniformWithConfiguration(10, 12, 1, TypedValue.COMPLEX_UNIT_SP)''',
'''                button("Báo lại đã có hàng", ButtonTone.SUCCESS) { confirmRestoreSkipped(issue, refresh) }.apply {
                    textSize = 12f
                    minHeight = 0
                    minimumHeight = 0
                    setSingleLine(true)
                    maxLines = 1
                    gravity = Gravity.CENTER
                    includeFontPadding = true
                    setPadding(dp(8), dp(3), dp(8), dp(4))
                    setAutoSizeTextTypeUniformWithConfiguration(10, 13, 1, TypedValue.COMPLEX_UNIT_SP)''',
'restore-one-line')

rep(
'''    private fun confirmIssueUpdate(issue: StockIssue, action: String, refresh: () -> Unit) {''',
'''    private fun confirmIssueUpdate(issue: StockIssue, action: String, refresh: () -> Unit, redraw: () -> Unit) {''',
'confirm-signature')

rep(
'''                        .setNegativeButton("Hủy", null).setPositiveButton("Cho phép") { _, _ -> updateIssue(issue, action, refresh) }.show()
                } else updateIssue(issue, action, refresh)''',
'''                        .setNegativeButton("Hủy", null).setPositiveButton("Cho phép") { _, _ -> updateIssue(issue, action, refresh, redraw) }.show()
                } else updateIssue(issue, action, refresh, redraw)''',
'confirm-execute')

rep(
'''    private fun updateIssue(issue: StockIssue, action: String, refresh: () -> Unit) {
        lifecycleScope.launch {
            runCatching { app.repository.updateIssue(issue.id, action) }
                .onSuccess { toast("SKU ${issue.sku}: ${it.status.label}"); refresh() }
                .onFailure { toast(it.message ?: "Không cập nhật được SKU") }
        }
    }''',
'''    private fun updateIssue(issue: StockIssue, action: String, refresh: () -> Unit, redraw: () -> Unit) {
        val targetStatus = if (action == "AVAILABLE") IssueStatus.AVAILABLE else IssueStatus.SKIP_ALLOWED
        pendingInventActions[issue.id] = PendingInventAction(issue, targetStatus, Instant.now().toString())
        redraw()
        lifecycleScope.launch {
            runCatching { app.repository.updateIssue(issue.id, action) }
                .onSuccess {
                    pendingInventActions.remove(issue.id)
                    refresh()
                }
                .onFailure {
                    pendingInventActions.remove(issue.id)
                    redraw()
                    toast("Không đồng bộ được SKU ${issue.sku}; thao tác đã được hoàn tác: ${it.message ?: "Lỗi kết nối"}")
                }
        }
    }''',
'optimistic-invent')

rep(
'''        reportButton.setOnClickListener {
            val item = chosen ?: return@setOnClickListener
            lifecycleScope.launch {
                reportButton.isEnabled = false
                runCatching { app.repository.reportShortage(item.sku) }
                    .onSuccess {
                        toast("Đã ghi nhận báo thiếu SKU ${item.sku}")
                        clearSelection()
                        internalTextChange = true
                        input.setText("")
                        internalTextChange = false
                        suggestionsBox.removeAllViews()
                        loadMyIssues(recent)
                        input.requestFocus()
                    }
                    .onFailure { toast(it.message ?: "Không gửi được báo thiếu") }
                reportButton.isEnabled = chosen != null
            }
        }''',
'''        reportButton.setOnClickListener {
            val item = chosen ?: return@setOnClickListener
            if (pickerPendingReports.containsKey(item.sku)) {
                toast("SKU ${item.sku} đang được gửi, không cần bấm lại")
                return@setOnClickListener
            }
            val pending = PendingPickerReport(item, Instant.now().toString())
            pickerPendingReports[item.sku] = pending
            clearSelection()
            internalTextChange = true
            input.setText("")
            internalTextChange = false
            suggestionsBox.removeAllViews()
            recent.addView(
                pickerPendingCard(pending),
                0,
                LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    setMargins(0, dp(1), 0, dp(1))
                }
            )
            input.requestFocus()
            lifecycleScope.launch {
                runCatching { app.repository.reportShortage(item.sku) }
                    .onSuccess {
                        pickerPendingReports.remove(item.sku)
                        loadMyIssues(recent)
                    }
                    .onFailure { error ->
                        pickerPendingReports.remove(item.sku)
                        if (chosen == null && input.text.toString().isBlank()) select(item)
                        loadMyIssues(recent)
                        toast("Không gửi được báo thiếu SKU ${item.sku}; đã hoàn tác: ${error.message ?: "Lỗi kết nối"}")
                    }
            }
        }''',
'optimistic-picker-submit')

rep(
'''    private fun loadMyIssues(target: LinearLayout) {
    lifecycleScope.launch {''',
'''    private fun pickerPendingCard(pending: PendingPickerReport): View {
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(7), dp(4), dp(7), dp(4))
            background = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                cornerRadius = dp(7).toFloat()
                setColor(getColor(R.color.amber_50))
                setStroke(dp(1), getColor(R.color.amber_500))
            }
            addView(text("SKU ${pending.item.sku} - ĐANG XỬ LÝ", 14, true).apply {
                setSingleLine(false)
                maxLines = 2
                includeFontPadding = false
                setAutoSizeTextTypeUniformWithConfiguration(10, 14, 1, TypedValue.COMPLEX_UNIT_SP)
            })
            addView(text(pending.item.productName, 12, true).apply {
                includeFontPadding = false
                setPadding(0, dp(1), 0, dp(1))
            })
            addView(text("Báo hết ${clockTime(pending.reportedAt)} • đang đồng bộ", 10, false).apply {
                setTextColor(getColor(R.color.text_secondary))
                setSingleLine(true)
                includeFontPadding = false
                setAutoSizeTextTypeUniformWithConfiguration(8, 10, 1, TypedValue.COMPLEX_UNIT_SP)
            })
        }
    }

    private fun loadMyIssues(target: LinearLayout) {
    lifecycleScope.launch {''',
'pending-card-helper')

rep(
'''                if (visibleIssues.isEmpty()) target.addView(infoBox("Chưa có lịch sử báo hàng cần hiển thị."))
                val ordered = visibleIssues.sortedByDescending { issue ->''',
'''                val representedSkus = visibleIssues.map { it.sku }.toSet()
                val pendingVisible = pickerPendingReports.values.filterNot { it.item.sku in representedSkus }
                pendingVisible.forEach { pending ->
                    target.addView(pickerPendingCard(pending), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                        setMargins(0, dp(1), 0, dp(1))
                    })
                }
                if (visibleIssues.isEmpty() && pendingVisible.isEmpty()) target.addView(infoBox("Chưa có lịch sử báo hàng cần hiển thị."))
                val ordered = visibleIssues.sortedByDescending { issue ->''',
'pending-preserve-success')

rep(
'''            }.onFailure {
                target.removeAllViews()
                target.addView(infoBox("Không tải được lịch sử: ${it.message}"))
            }''',
'''            }.onFailure {
                target.removeAllViews()
                pickerPendingReports.values.forEach { pending ->
                    target.addView(pickerPendingCard(pending), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                        setMargins(0, dp(1), 0, dp(1))
                    })
                }
                target.addView(infoBox("Không tải được lịch sử: ${it.message}"))
            }''',
'pending-preserve-failure')

p.write_text(s)
