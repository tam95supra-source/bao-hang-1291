from pathlib import Path
import re


def replace_once(path, old, new, label):
    p = Path(path)
    text = p.read_text()
    n = text.count(old)
    if n != 1:
        raise SystemExit(f"{label}: expected 1 match, got {n}")
    p.write_text(text.replace(old, new, 1))


def regex_once(path, pattern, replacement, label, flags=re.S):
    p = Path(path)
    text = p.read_text()
    new_text, n = re.subn(pattern, lambda _: replacement, text, count=1, flags=flags)
    if n != 1:
        raise SystemExit(f"{label}: expected 1 regex match, got {n}")
    p.write_text(new_text)

# ---------------------------------------------------------------------------
# Android header + login copyright
# ---------------------------------------------------------------------------
replace_once(
    "app/src/main/res/layout/activity_main.xml",
'''        <TextView
            android:id="@+id/btnLogout"
            android:layout_width="56dp"
            android:layout_height="44dp"
            android:contentDescription="Đăng xuất"
            android:gravity="center"
            android:text="Thoát"
            android:textColor="@color/white"
            android:textSize="12sp"
            android:textStyle="bold" />
''',
'''        <TextView
            android:id="@+id/btnLog"
            android:layout_width="46dp"
            android:layout_height="44dp"
            android:contentDescription="Gửi log"
            android:gravity="center"
            android:text="Log"
            android:textColor="@color/white"
            android:textSize="12sp"
            android:textStyle="bold" />

        <TextView
            android:id="@+id/btnLogout"
            android:layout_width="52dp"
            android:layout_height="44dp"
            android:contentDescription="Đăng xuất"
            android:gravity="center"
            android:text="Thoát"
            android:textColor="@color/white"
            android:textSize="12sp"
            android:textStyle="bold" />
''',
    "android header log button",
)
replace_once(
    "app/src/main/res/layout/activity_login.xml",
    'android:text="Hệ thống nội bộ • Kho 1291"',
    'android:text="Copyright 2026 - SUPRA DC HƯNG YÊN - tamnv2 - Chuyên viên Pick Pack 1291"',
    "android login copyright",
)

# ---------------------------------------------------------------------------
# Android model semantics
# ---------------------------------------------------------------------------
replace_once(
    "app/src/main/java/vn/pickpack1291/baohang/data/Models.kt",
    'OPEN("OPEN", "CHỜ XỬ LÝ"),',
    'OPEN("OPEN", "ĐANG XỬ LÝ"),',
    "open status user label",
)
replace_once(
    "app/src/main/java/vn/pickpack1291/baohang/data/Models.kt",
    '    val latestMessage: String = "",\n    val assignedId: String? = null,',
    '    val latestMessage: String = "",\n    val handledByName: String = "",\n    val assignedId: String? = null,',
    "handled by model field",
)
replace_once(
    "app/src/main/java/vn/pickpack1291/baohang/data/Models.kt",
    '            latestMessage = json.optString("latest_message"),\n            assignedId = json.optString("assigned_id").ifBlank { null },',
    '            latestMessage = json.optString("latest_message"),\n            handledByName = json.optString("handled_by_name"),\n            assignedId = json.optString("assigned_id").ifBlank { null },',
    "handled by parser",
)
replace_once(
    "app/src/main/java/vn/pickpack1291/baohang/data/Models.kt",
    '    val isClaimedBucket: Boolean get() = this in setOf(CLAIMED, SEARCHING, REPLENISHING)',
    '    val isClaimedBucket: Boolean get() = this in setOf(OPEN, CLAIMED, SEARCHING, REPLENISHING)',
    "processing bucket includes open",
)

# ---------------------------------------------------------------------------
# Android MainActivity
# ---------------------------------------------------------------------------
replace_once(
    "app/src/main/java/vn/pickpack1291/baohang/ui/MainActivity.kt",
    '        findViewById<TextView>(R.id.btnBack).setOnClickListener { navigateBack() }\n',
    '        findViewById<TextView>(R.id.btnBack).setOnClickListener { navigateBack() }\n        findViewById<TextView>(R.id.btnLog).setOnClickListener { showDiagnosticsDialog() }\n',
    "header log click",
)
replace_once(
    "app/src/main/java/vn/pickpack1291/baohang/ui/MainActivity.kt",
    '        findViewById<TextView>(R.id.tvHeaderUser).text = "${profile.employeeCode} • ${profile.fullName} • ${effective.label}$mode"',
    '        findViewById<TextView>(R.id.tvHeaderUser).text = "${profile.fullName} • ${effective.label}$mode"',
    "header user text",
)
replace_once(
    "app/src/main/java/vn/pickpack1291/baohang/ui/MainActivity.kt",
    '        content.addView(text(title, 23, true).apply { setPadding(0, 0, 0, dp(10)) })\n',
    '        if (title.isNotBlank()) content.addView(text(title, 23, true).apply { setPadding(0, 0, 0, dp(10)) })\n',
    "optional page title",
)
replace_once(
    "app/src/main/java/vn/pickpack1291/baohang/ui/MainActivity.kt",
'''        addDiagnosticsButton(content)
    }

    private fun showAdmin() {''',
'''    }

    private fun showAdmin() {''',
    "remove maintenance diagnostics",
)

# fixed-height screen helper: list/history can occupy remaining height and actions stay at the bottom.
page_anchor = '''        return content
    }

    private fun addMaintenanceActions(content: LinearLayout) {'''
fixed_helper = '''        return content
    }

    private fun fixedPage(screen: String, title: String = ""): LinearLayout {
        currentScreen = screen
        if (screen != SCREEN_INVENT) inventRefresh = null
        if (screen != SCREEN_PICKER) pickerRefresh = null
        container.removeAllViews()
        updateBackButton()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(10), dp(14), dp(10))
        }
        container.addView(root, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        if (title.isNotBlank()) root.addView(text(title, 21, true).apply { setPadding(0, 0, 0, dp(6)) })
        if (app.session.profile?.role == UserRole.ADMIN && app.session.adminTestRole != null) {
            root.addView(infoBox("Đang kiểm thử với quyền ${app.session.effectiveRole.label}. Mọi quyền API được giới hạn tương ứng."))
            root.addView(button("Thoát chế độ kiểm thử", ButtonTone.SECONDARY) {
                app.repository.setAdminTestRole(null)
                renderForRole()
            })
        }
        return root
    }

    private fun addMaintenanceActions(content: LinearLayout) {'''
replace_once("app/src/main/java/vn/pickpack1291/baohang/ui/MainActivity.kt", page_anchor, fixed_helper, "fixed page helper")

new_invent = r'''    private fun showInventBoard() {
        val isInvent = app.session.effectiveRole == UserRole.INVENT
        val root = fixedPage(SCREEN_INVENT, if (isInvent) "" else "Xử lý báo hàng")
        val listScroll = ScrollView(this).apply { isFillViewport = true }
        val boardContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.BOTTOM
        }
        listScroll.addView(boardContainer, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.addView(listScroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))

        root.addView(text("Lịch sử chỉ lưu trữ trong ngày, cần nhiều hơn vui lòng liên hệ admin", 11, false).apply {
            setTextColor(getColor(R.color.text_secondary))
            setPadding(dp(2), dp(6), dp(2), dp(4))
        })
        val tabs = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(tabs)

        var board: IssueBoard? = null
        var selected = inventSelectedTab.coerceIn(0, 3)
        val tabButtons = mutableListOf<Button>()
        val tabBadges = mutableListOf<TextView>()

        fun updateTabs() {
            val counts = board?.let { listOf(it.claimedCount, it.availableCount, it.skippedCount, it.withdrawnCount) } ?: listOf(0, 0, 0, 0)
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
            val raw = when (selected) {
                1 -> data.available
                2 -> data.skipped
                3 -> data.withdrawn
                else -> data.claimed
            }
            val ordered = raw.sortedByDescending { issue ->
                when (selected) {
                    3 -> issue.withdrawnAt.ifBlank { issue.updatedAt }
                    1, 2 -> issue.updatedAt
                    else -> issue.reportedAt
                }
            }
            boardContainer.removeAllViews()
            if (ordered.isEmpty()) boardContainer.addView(infoBox("Không có SKU trong nhóm này."))
            ordered.forEach { issue -> boardContainer.addView(issueCard(issue, selected) { inventRefresh?.invoke() }) }
            updateTabs()
            listScroll.post { listScroll.fullScroll(View.FOCUS_DOWN) }
        }

        val labels = listOf("Đang xử lý", "Đã có hàng", "Đã bỏ qua", "Picker thu hồi SKU")
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
        tabs.setPadding(0, dp(2), 0, 0)
        updateTabs()
        inventRefresh = {
            lifecycleScope.launch {
                runCatching { app.repository.loadIssueBoard() }
                    .onSuccess { board = it; draw() }
                    .onFailure { toast("Không tải được dữ liệu: ${it.message}"); app.diagnostics.error("issue_board_load_failed", it) }
            }
        }
        inventRefresh?.invoke()
    }

    private fun issueCard(issue: StockIssue, bucket: Int, refresh: () -> Unit): View {
        val elevated = app.session.effectiveRole in setOf(UserRole.ADMIN, UserRole.ADMIN_INVENT)
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(13), dp(11), dp(13), dp(11))
            setBackgroundResource(R.drawable.bg_card)
        }
        card.layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { setMargins(0, dp(4), 0, dp(4)) }
        val recurrent = if (issue.recurrence30m) " • BÁO LẠI TRONG 30 PHÚT" else ""
        card.addView(text("SKU ${issue.sku}", 18, true))
        card.addView(text(issue.productName, 14, true).apply { setPadding(0, dp(2), 0, dp(4)) })
        val summary = if (bucket == 3) "${issue.status.label} • v${issue.issueVersion}" else "${issue.status.label} • ${issue.reportCount} lượt • v${issue.issueVersion}$recurrent"
        card.addView(text(summary, 12, false).apply { setTextColor(getColor(R.color.text_secondary)) })
        if (bucket == 3) {
            card.addView(text("Picker: ${issue.latestReporterName.ifBlank { "—" }} • Thu hồi lúc ${shortTime(issue.withdrawnAt)}", 12, false).apply { setTextColor(getColor(R.color.text_secondary)) })
            card.addView(text(if (issue.latestMessage.isNotBlank()) issue.latestMessage else "Đã ghi nhận thu hồi báo thiếu.", 12, false).apply { setPadding(0, dp(4), 0, 0) })
        } else if (bucket in 1..2) {
            val actor = issue.handledByName.ifBlank { issue.assignedName }
            card.addView(text("Thao tác: ${actor.ifBlank { "—" }} • ${shortTime(issue.updatedAt)}", 12, false).apply { setTextColor(getColor(R.color.text_secondary)) })
        } else {
            card.addView(text("Báo lúc ${shortTime(issue.reportedAt)}", 12, false).apply { setTextColor(getColor(R.color.text_secondary)) })
        }
        if (bucket == 0) {
            val actions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            actions.addView(button("Có hàng", ButtonTone.SUCCESS) { confirmIssueUpdate(issue, "AVAILABLE", refresh) }, LinearLayout.LayoutParams(0, dp(50), 1f).apply { setMargins(0, dp(5), dp(2), 0) })
            actions.addView(button("Cho SKIP", ButtonTone.DANGER) { confirmIssueUpdate(issue, "NOT_FOUND", refresh) }, LinearLayout.LayoutParams(0, dp(50), 1f).apply { setMargins(dp(2), dp(5), 0, 0) })
            card.addView(actions)
        } else if (bucket == 2) {
            val canRestore = elevated || (app.session.effectiveRole == UserRole.INVENT && issue.assignedId == app.session.profile?.id)
            if (canRestore) card.addView(button("Báo lại đã có hàng", ButtonTone.SUCCESS) { confirmRestoreSkipped(issue, refresh) })
        }
        return card
    }

'''
regex_once(
    "app/src/main/java/vn/pickpack1291/baohang/ui/MainActivity.kt",
    r"    private fun showInventBoard\(\) \{.*?\n    private fun confirmIssueUpdate\(",
    new_invent + "    private fun confirmIssueUpdate(",
    "replace invent board and issue card",
)

new_picker = r'''    private fun showPicker() {
        val root = fixedPage(SCREEN_PICKER, "Báo thiếu hàng")
        root.addView(text("Báo gần đây", 14, true).apply { setPadding(0, 0, 0, dp(4)) })
        val historyScroll = ScrollView(this).apply { isFillViewport = true }
        val recent = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.BOTTOM
        }
        historyScroll.addView(recent, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.addView(historyScroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))

        val suggestionsBox = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val selected = infoBox("Chưa chọn SKU")
        val input = EditText(this).apply {
            hint = "Nhập ít nhất 3 số của SKU"
            inputType = InputType.TYPE_CLASS_NUMBER
            filters = arrayOf(InputFilter.LengthFilter(8))
            setSingleLine(true)
        }
        val reportButton = button("Báo thiếu", ButtonTone.DANGER) {}
        reportButton.isEnabled = false
        var chosen: SkuItem? = null
        var internalTextChange = false

        root.addView(suggestionsBox)
        root.addView(selected)
        root.addView(text("Nhập hoặc quét mã SKU", 12, true).apply { setPadding(dp(2), dp(3), 0, dp(2)) })
        root.addView(input, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(50)))
        root.addView(reportButton, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)).apply { setMargins(0, dp(3), 0, 0) })

        fun clearSelection() {
            chosen = null
            selected.text = "Chưa chọn SKU"
            reportButton.isEnabled = false
        }
        fun select(item: SkuItem) {
            chosen = item
            selected.text = "SKU ${item.sku}\n${item.productName}"
            reportButton.isEnabled = true
            searchJob?.cancel()
            suggestionsBox.removeAllViews()
            internalTextChange = true
            input.setText(item.sku)
            input.setSelection(item.sku.length)
            internalTextChange = false
        }
        fun renderSuggestions(items: List<SkuItem>, requested: String) {
            if (input.text.toString() != requested || !input.hasFocus()) return
            suggestionsBox.removeAllViews()
            if (items.isEmpty()) {
                suggestionsBox.addView(text("Không có SKU chứa chuỗi $requested", 12, false).apply {
                    setTextColor(getColor(R.color.text_secondary))
                    setPadding(dp(4), dp(6), dp(4), dp(6))
                    gravity = Gravity.START
                    textAlignment = View.TEXT_ALIGNMENT_VIEW_START
                })
                return
            }
            items.take(7).forEach { item ->
                val suggestion = button("${item.sku}  •  ${item.productName}", ButtonTone.SECONDARY) { select(item) }.apply {
                    gravity = Gravity.START or Gravity.CENTER_VERTICAL
                    textAlignment = View.TEXT_ALIGNMENT_VIEW_START
                }
                suggestionsBox.addView(suggestion, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    setMargins(0, dp(1), 0, dp(1))
                })
            }
        }
        fun suggestions(query: String) {
            searchJob?.cancel()
            val requested = query.trim()
            if (!requested.matches(Regex("\\d{3,8}"))) { suggestionsBox.removeAllViews(); return }
            searchJob = lifecycleScope.launch {
                val localCount = withContext(Dispatchers.IO) { app.repository.skuCount() }
                val local = withContext(Dispatchers.IO) { app.repository.searchSkuDigits(requested) }
                val items = if (local.isNotEmpty() || localCount > 0) local
                    else runCatching { app.repository.searchSkuDigitsOnline(requested) }.getOrDefault(emptyList())
                renderSuggestions(items, requested)
            }
        }
        input.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(v: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(v: CharSequence?, start: Int, before: Int, count: Int) {
                if (internalTextChange) return
                val raw = v?.toString().orEmpty()
                val digits = raw.filter(Char::isDigit).take(8)
                if (raw != digits) {
                    internalTextChange = true
                    input.setText(digits)
                    input.setSelection(digits.length)
                    internalTextChange = false
                }
                clearSelection()
                searchJob?.cancel()
                if (digits.length < 3) suggestionsBox.removeAllViews() else suggestions(digits)
            }
            override fun afterTextChanged(v: Editable?) = Unit
        })
        reportButton.setOnClickListener {
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
                    target.gravity = Gravity.BOTTOM
                    if (issues.isEmpty()) target.addView(infoBox("Chưa có báo thiếu."))
                    val ordered = issues.sortedByDescending { issue ->
                        if (issue.status == IssueStatus.WITHDRAWN) issue.withdrawnAt.ifBlank { issue.reportedAt } else issue.reportedAt
                    }
                    ordered.take(50).forEach { issue ->
                        val row = LinearLayout(this@MainActivity).apply {
                            orientation = LinearLayout.VERTICAL
                            setPadding(dp(12), dp(10), dp(12), dp(10))
                            setBackgroundResource(R.drawable.bg_card)
                        }
                        row.addView(text("${issue.status.label} • SKU ${issue.sku}", 16, true))
                        row.addView(text(issue.productName, 13, true).apply { setPadding(0, dp(2), 0, dp(2)) })
                        val time = if (issue.status == IssueStatus.WITHDRAWN && issue.withdrawnAt.isNotBlank()) "Thu hồi lúc ${shortTime(issue.withdrawnAt)}" else "Báo lúc ${shortTime(issue.reportedAt)}"
                        row.addView(text(time, 12, false).apply { setTextColor(getColor(R.color.text_secondary)) })
                        val remainingMs = issue.withdrawRemainingMs.coerceIn(0L, 30_000L)
                        if (issue.canWithdraw && remainingMs > 0L) {
                            val expiresAtElapsed = SystemClock.elapsedRealtime() + remainingMs
                            lateinit var withdrawButton: Button
                            withdrawButton = button("Thu hồi báo thiếu", ButtonTone.DANGER) {
                                if (SystemClock.elapsedRealtime() >= expiresAtElapsed) {
                                    withdrawButton.visibility = View.GONE
                                    toast("Đã quá 30 giây nên không thể thu hồi SKU ${issue.sku}")
                                } else confirmWithdrawIssue(issue, target, expiresAtElapsed, withdrawButton)
                            }
                            withdrawButton.postDelayed({
                                if (SystemClock.elapsedRealtime() >= expiresAtElapsed) withdrawButton.visibility = View.GONE
                            }, remainingMs + 25L)
                            row.addView(withdrawButton, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)).apply { setMargins(0, dp(6), 0, 0) })
                        }
                        target.addView(row, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { setMargins(0, dp(3), 0, dp(3)) })
                    }
                    (target.parent as? ScrollView)?.post { (target.parent as? ScrollView)?.fullScroll(View.FOCUS_DOWN) }
                }.onFailure { target.removeAllViews(); target.addView(infoBox("Không tải được lịch sử: ${it.message}")) }
        }
    }

    private fun confirmWithdrawIssue(issue: StockIssue, target: LinearLayout, expiresAtElapsed: Long, withdrawButton: Button) {
        if (SystemClock.elapsedRealtime() >= expiresAtElapsed) {
            withdrawButton.visibility = View.GONE
            toast("Đã quá 30 giây nên không thể thu hồi SKU ${issue.sku}")
            return
        }
        AlertDialog.Builder(this)
            .setTitle("Thu hồi báo thiếu?")
            .setMessage("Thu hồi báo thiếu SKU ${issue.sku}? Thao tác chỉ hợp lệ trong 30 giây kể từ lúc báo.")
            .setNegativeButton("Không", null)
            .setPositiveButton("Có") { _, _ ->
                if (SystemClock.elapsedRealtime() >= expiresAtElapsed) {
                    withdrawButton.visibility = View.GONE
                    toast("Đã quá 30 giây nên không thể thu hồi SKU ${issue.sku}")
                    return@setPositiveButton
                }
                lifecycleScope.launch {
                    withdrawButton.isEnabled = false
                    runCatching { app.repository.withdrawShortage(issue.id) }
                        .onSuccess { toast("Đã thu hồi SKU ${issue.sku}"); loadMyIssues(target) }
                        .onFailure { toast(it.message ?: "Không thể thu hồi SKU"); loadMyIssues(target) }
                }
            }.show()
    }

'''
regex_once(
    "app/src/main/java/vn/pickpack1291/baohang/ui/MainActivity.kt",
    r"    private fun showPicker\(\) \{.*?\n    private fun showCatalog\(\) \{",
    new_picker + "    private fun showCatalog() {",
    "replace picker bottom layout",
)

new_diag = r'''    private fun showDiagnosticsDialog() {
        AlertDialog.Builder(this)
            .setTitle("Gửi log?")
            .setMessage("Gửi dữ liệu chẩn đoán của ứng dụng để kiểm tra lỗi?")
            .setNegativeButton("Không", null)
            .setPositiveButton("Có") { _, _ ->
                lifecycleScope.launch {
                    runCatching { app.repository.sendDiagnosticLog() }
                        .onSuccess { toast(if (it.optBoolean("uploaded")) "Đã gửi log" else it.optString("message", "Chưa có dữ liệu chẩn đoán")) }
                        .onFailure { toast(it.message ?: "Không gửi được log") }
                }
            }.show()
    }

'''
regex_once(
    "app/src/main/java/vn/pickpack1291/baohang/ui/MainActivity.kt",
    r"    private fun addDiagnosticsButton\(content: LinearLayout\) \{.*?\n    private fun importSkuFile\(",
    new_diag + "    private fun importSkuFile(",
    "header diagnostics dialog",
)

# ---------------------------------------------------------------------------
# API: OPEN remains an internal active state, but board exposes one Processing bucket.
# INVENT auto-claims only at the exact result action, so there is no separate receive step.
# Also enrich resolved rows with the person who actually pressed AVAILABLE / NOT_FOUND.
# ---------------------------------------------------------------------------
api_path = "supabase/functions/api/index.ts"
p = Path(api_path)
s = p.read_text()

old_reporter_block = re.search(r'''  const latestReporter = new Map<string, string>\(\);\n  if \(issueIds\.length\) \{.*?\n  \}\n  const previousIds =''', s, re.S)
if not old_reporter_block:
    raise SystemExit("api issueRows reporter block not found")
new_reporter_block = '''  const latestReporter = new Map<string, string>();
  const handledBy = new Map<string, string>();
  if (issueIds.length) {
    const { data: reports } = await admin.from("issue_reports").select("issue_id,reporter_id,reported_at")
      .in("issue_id", issueIds).order("reported_at", { ascending: false }).limit(2000);
    const reporterProfileIds = [...new Set((reports ?? []).map((row) => row.reporter_id))];
    if (reporterProfileIds.length) {
      const { data: ps } = await admin.from("profiles").select("id,full_name").in("id", reporterProfileIds);
      (ps ?? []).forEach((p) => names.set(p.id, p.full_name));
    }
    (reports ?? []).forEach((r) => {
      if (!latestReporter.has(r.issue_id)) latestReporter.set(r.issue_id, names.get(r.reporter_id) ?? "");
    });
    const { data: audits, error: auditError } = await admin.from("issue_audit")
      .select("issue_id,actor_id,action,created_at").in("issue_id", issueIds).order("created_at", { ascending: false }).limit(2000);
    if (auditError) throw auditError;
    const resultActions = new Set(["AVAILABLE", "NOT_FOUND", "RESTORE_AVAILABLE", "RESTORE_SKIPPED"]);
    const resultAudits = (audits ?? []).filter((row: any) => resultActions.has(String(row.action ?? "").toUpperCase()));
    const actorIds = [...new Set(resultAudits.map((row: any) => row.actor_id).filter(Boolean))];
    if (actorIds.length) {
      const { data: ps } = await admin.from("profiles").select("id,full_name").in("id", actorIds);
      (ps ?? []).forEach((profile) => names.set(profile.id, profile.full_name));
    }
    resultAudits.forEach((row: any) => {
      if (!handledBy.has(row.issue_id)) handledBy.set(row.issue_id, names.get(row.actor_id) ?? "");
    });
  }
  const previousIds ='''
s = s[:old_reporter_block.start()] + new_reporter_block + s[old_reporter_block.end():]

old_return = '''    latest_reporter_name: latestReporter.get(row.id) ?? "",
    latest_message: "",
  }));'''
new_return = '''    latest_reporter_name: latestReporter.get(row.id) ?? "",
    latest_message: "",
    handled_by_name: handledBy.get(row.id) ?? "",
  }));'''
if s.count(old_return) != 1:
    raise SystemExit(f"api handled return guard mismatch: {s.count(old_return)}")
s = s.replace(old_return, new_return, 1)

board_match = re.search(r'''    case "issue-board": \{.*?\n    case "my-issues": \{''', s, re.S)
if not board_match:
    raise SystemExit("api issue-board block not found")
new_board = '''    case "issue-board": {
      requireRole(context, ["ADMIN", "ADMIN_INVENT", "INVENT"]);
      const { start, end } = siteDayBounds();
      const [active, recentRefs, activeCount, availableCount, skippedCount] = await Promise.all([
        issueRows(undefined, ACTIVE_STATUSES, 1000),
        admin.from("issues").select("id,status,resolved_at").in("status", ["AVAILABLE", "SKIP_ALLOWED"]).gte("resolved_at", start).lt("resolved_at", end).order("resolved_at", { ascending: false }).limit(1000),
        admin.from("issues").select("id", { count: "exact", head: true }).in("status", ACTIVE_STATUSES),
        admin.from("issues").select("id", { count: "exact", head: true }).eq("status", "AVAILABLE").gte("resolved_at", start).lt("resolved_at", end),
        admin.from("issues").select("id", { count: "exact", head: true }).eq("status", "SKIP_ALLOWED").gte("resolved_at", start).lt("resolved_at", end),
      ]);
      for (const result of [recentRefs, activeCount, availableCount, skippedCount]) if (result.error) throw result.error;
      const recentIds = (recentRefs.data ?? []).map((row: any) => String(row.id));
      const recentRows = recentIds.length ? await issueRows(recentIds, undefined, 1000) : [];
      const byId = new Map(recentRows.map((row: any) => [String(row.id), row]));
      const recent = recentIds.map((id: string) => byId.get(id)).filter(Boolean);
      return {
        open: [],
        claimed: active,
        recent,
        skipped: recent.filter((i: any) => i.status === "SKIP_ALLOWED"),
        available: recent.filter((i: any) => i.status === "AVAILABLE"),
        counts: { open: 0, claimed: activeCount.count ?? active.length, available: availableCount.count ?? 0, skipped: skippedCount.count ?? 0 },
        scope: { active: "CURRENT", resolved: "TODAY", day_start: start, day_end: end },
      };
    }
    case "my-issues": {'''
s = s[:board_match.start()] + new_board + s[board_match.end():]

# Auto-claim an unassigned active issue only when INVENT presses the result button.
old_update = '''      const actionValue = required(body.action, "Hành động").toUpperCase();
      if (!["AVAILABLE", "NOT_FOUND"].includes(actionValue) && !(actionValue === "CLOSE" && context.effectiveRole === "ADMIN")) throw new HttpError(400, "Hành động không hợp lệ");
      const { data, error } = await admin.rpc("update_issue_atomic", { p_issue_id: required(body.issue_id, "Issue ID"), p_actor: context.userId, p_action: actionValue });'''
new_update = '''      const actionValue = required(body.action, "Hành động").toUpperCase();
      if (!["AVAILABLE", "NOT_FOUND"].includes(actionValue) && !(actionValue === "CLOSE" && context.effectiveRole === "ADMIN")) throw new HttpError(400, "Hành động không hợp lệ");
      const issueId = required(body.issue_id, "Issue ID");
      if (context.effectiveRole === "INVENT" && ["AVAILABLE", "NOT_FOUND"].includes(actionValue)) {
        const { data: current, error: currentError } = await admin.from("issues").select("status,claimed_by").eq("id", issueId).single();
        if (currentError) throw currentError;
        if (ACTIVE_STATUSES.includes(String(current.status)) && !current.claimed_by) {
          const { error: claimError } = await admin.rpc("update_issue_atomic", { p_issue_id: issueId, p_actor: context.userId, p_action: "CLAIM" });
          if (claimError) throw claimError;
        }
      }
      const { data, error } = await admin.rpc("update_issue_atomic", { p_issue_id: issueId, p_actor: context.userId, p_action: actionValue });'''
if s.count(old_update) != 1:
    raise SystemExit(f"api update auto-claim guard mismatch: {s.count(old_update)}")
s = s.replace(old_update, new_update, 1)
p.write_text(s)

# ---------------------------------------------------------------------------
# Web base shell: no employee code in header, no initial waiting bucket, copyright.
# ---------------------------------------------------------------------------
main_path = "web-admin/src/main.js"
p = Path(main_path)
s = p.read_text()
s = s.replace("  issueBucket: 'open',", "  issueBucket: 'claimed',", 1)
s = s.replace("OPEN:'Chờ xử lý'", "OPEN:'Đang xử lý'")
s = s.replace("const buckets = [['open','CHỜ NHẬN'],['claimed',`ĐANG XỬ LÝ${role()==='INVENT'?' CỦA TÔI':''}`],['recent','ĐÃ XỬ LÝ GẦN ĐÂY'],['withdrawn','NGƯỜI LẤY HÀNG THU HỒI SKU']];", "const buckets = [['claimed','ĐANG XỬ LÝ'],['recent','ĐÃ XỬ LÝ GẦN ĐÂY'],['withdrawn','PICKER THU HỒI SKU']];")
s = s.replace("if (!buckets.some(([id]) => id === state.issueBucket)) state.issueBucket = 'open';", "if (!buckets.some(([id]) => id === state.issueBucket)) state.issueBucket = 'claimed';")
old_user = '<strong>${escapeHtml(profile.full_name)}</strong><span>${escapeHtml(profile.employee_code)} · ${escapeHtml(ROLES[currentRole] || currentRole)}</span><button id="logout" class="ghost">Đăng xuất</button>'
new_user = '<strong>${escapeHtml(profile.full_name)}</strong><span>${escapeHtml(ROLES[currentRole] || currentRole)}</span><button id="logout" class="ghost">Đăng xuất</button>'
if old_user not in s:
    raise SystemExit("web header user guard mismatch")
s = s.replace(old_user, new_user, 1)
login_security = '<p class="security">Quyền được kiểm tra tại server. Web không chứa service-role key, thông tin xác thực máy chủ hoặc private key.</p>'
login_new = login_security + '\n    <p class="security">Copyright 2026 - SUPRA DC HƯNG YÊN - tamnv2 - Chuyên viên Pick Pack 1291</p>'
if login_security not in s:
    raise SystemExit("web login security guard mismatch")
s = s.replace(login_security, login_new, 1)
p.write_text(s)

# ---------------------------------------------------------------------------
# Web operational owner: four buckets and actor visibility.
# ---------------------------------------------------------------------------
wv_path = "web-admin/src/warehouse-ui-v2.js"
p = Path(wv_path)
s = p.read_text()
s = s.replace("const ui = { eventBucket: 'open',", "const ui = { eventBucket: 'claimed',", 1)
s = s.replace("OPEN:'Chờ xử lý'", "OPEN:'Đang xử lý'", 1)
s = s.replace("footer.textContent='© 2026 Supra DCHY | tamnv2 • Chuyên viên Pick Pack 1291';", "footer.textContent='Copyright 2026 - SUPRA DC HƯNG YÊN - tamnv2 - Chuyên viên Pick Pack 1291';", 1)
s = s.replace("||'<div class=\"wv2-empty\">Không có báo thiếu đang chờ xử lý.</div>'", "||'<div class=\"wv2-empty\">Không có SKU đang xử lý.</div>'", 1)

old_bucket_rows = "function bucketRows(board,bucket){if(bucket==='claimed')return board.claimed||[];if(bucket==='available')return board.available||(board.recent||[]).filter(x=>x.status==='AVAILABLE');if(bucket==='skipped')return board.skipped||(board.recent||[]).filter(x=>x.status==='SKIP_ALLOWED');if(bucket==='withdrawn')return board.withdrawn||[];return board.open||[];}"
new_bucket_rows = "function bucketRows(board,bucket){if(bucket==='available')return board.available||(board.recent||[]).filter(x=>x.status==='AVAILABLE');if(bucket==='skipped')return board.skipped||(board.recent||[]).filter(x=>x.status==='SKIP_ALLOWED');if(bucket==='withdrawn')return board.withdrawn||[];return board.claimed||[];}"
if old_bucket_rows not in s: raise SystemExit("wv bucketRows guard mismatch")
s = s.replace(old_bucket_rows, new_bucket_rows, 1)

card_match = re.search(r'''function issueCard\(issue,bucket\)\{.*?\n\}\nasync function renderEvents\(\)\{''', s, re.S)
if not card_match: raise SystemExit("wv issueCard block not found")
new_card = '''function issueCard(issue,bucket){
  const state=bucket==='available'?'available':bucket==='skipped'?'skipped':bucket==='withdrawn'?'withdrawn':'claimed',assignment=issue.assigned_name?` · Phụ trách: ${escapeHtml(issue.assigned_name)}`:'',recurrence=issue.recurrence_30m?' · Báo lại trong 30 phút':'';let actions='';
  if(bucket==='claimed')actions=`<div class="wv2-actions"><button class="wv2-success" data-update="AVAILABLE" data-id="${issue.id}" data-sku="${escapeHtml(issue.sku)}">Có hàng</button><button class="wv2-danger" data-update="NOT_FOUND" data-id="${issue.id}" data-sku="${escapeHtml(issue.sku)}">Cho SKIP</button></div>`;
  else if(bucket==='skipped'&&canRestore(issue))actions=`<div class="wv2-actions"><button class="wv2-success" data-restore="${issue.id}" data-sku="${escapeHtml(issue.sku)}">Báo lại đã có hàng</button></div>`;
  const detail=bucket==='withdrawn'?`<span>Picker: ${escapeHtml(issue.latest_reporter_name||'—')}</span>`:`<span>${Number(issue.report_count||1)} lượt báo${recurrence}</span>`;
  const eventTime=bucket==='withdrawn'?(issue.withdrawn_at||issue.updated_at):issue.reported_at;
  const withdrawalNote=bucket==='withdrawn'?`<div class="wv2-meta">${escapeHtml(issue.latest_message||'Đã ghi nhận thu hồi báo thiếu.')}</div>`:'';
  const actor=(bucket==='available'||bucket==='skipped')?` · Thao tác: ${escapeHtml(issue.handled_by_name||issue.assigned_name||'—')}`:assignment;
  return `<article class="wv2-issue" data-state="${state}"><div class="wv2-issue-head"><div><strong>SKU ${escapeHtml(issue.sku)}</strong>${detail}</div><time>${escapeHtml(formatTime(eventTime))}</time></div><div class="wv2-product"><strong>${escapeHtml(issue.product_name||'')}</strong></div><div class="wv2-meta"><span class="wv2-status ${statusClass(issue.status)}">${escapeHtml(statusLabel(issue.status))}</span>${actor}</div>${withdrawalNote}${actions}</article>`;
}
async function renderEvents(){'''
s = s[:card_match.start()] + new_card + s[card_match.end():]

render_match = re.search(r'''async function renderEvents\(\)\{.*?\n\}\nasync function renderEventsForce''', s, re.S)
if not render_match: raise SystemExit("wv renderEvents block not found")
new_render = '''async function renderEvents(){
  const content=prepareContent('events');if(!content||ui.rendering==='events')return;ui.rendering='events';const token=++ui.renderToken;content.innerHTML=`<div class="warehouse-v2-root">${heading('Xử lý báo hàng','Đang xử lý là số hiện tại; lịch sử Có hàng/SKIP/Thu hồi tính trong hôm nay.')}<div class="wv2-empty">Đang tải báo thiếu…</div></div>`;
  try{const[board,withdrawalBoard]=await Promise.all([webApi('issue-board'),withdrawApi('board')]);if(token!==ui.renderToken||activeTab()!=='events')return;board.withdrawn=withdrawalBoard.withdrawn||[];const c=board.counts||{};const counts={claimed:Number(c.claimed??bucketRows(board,'claimed').length),available:Number(c.available??bucketRows(board,'available').length),skipped:Number(c.skipped??bucketRows(board,'skipped').length),withdrawn:Number(withdrawalBoard.count??bucketRows(board,'withdrawn').length)};
    if(!['claimed','available','skipped','withdrawn'].includes(ui.eventBucket))ui.eventBucket='claimed';
    const renderBucket=()=>{const rows=bucketRows(board,ui.eventBucket),root=$('.warehouse-v2-root',content);if(!root)return;root.innerHTML=`${heading('Xử lý báo hàng','Đang xử lý = hiện tại · Có hàng/SKIP/Thu hồi = hôm nay (giờ kho Việt Nam).')}<div class="wv2-tabs"><button data-wv2-bucket="claimed" class="${ui.eventBucket==='claimed'?'active':''}">Đang xử lý <span class="wv2-count">${counts.claimed}</span></button><button data-wv2-bucket="available" class="${ui.eventBucket==='available'?'active':''}">Đã có hàng <span class="wv2-count">${counts.available}</span></button><button data-wv2-bucket="skipped" class="${ui.eventBucket==='skipped'?'active':''}">Đã bỏ qua <span class="wv2-count">${counts.skipped}</span></button><button data-wv2-bucket="withdrawn" class="${ui.eventBucket==='withdrawn'?'active':''}">Picker thu hồi SKU <span class="wv2-count">${counts.withdrawn}</span></button></div><div id="wv2IssueList">${rows.length?rows.map(i=>issueCard(i,ui.eventBucket)).join(''):'<div class="wv2-empty">Không có SKU trong nhóm này.</div>'}</div>`;
      $$('[data-wv2-bucket]',root).forEach(b=>b.onclick=()=>{ui.eventBucket=b.dataset.wv2Bucket;renderBucket();});
      $$('[data-update]',root).forEach(b=>b.onclick=async()=>{const action=b.dataset.update,sku=b.dataset.sku;if(!confirm(action==='AVAILABLE'?`Xác nhận SKU ${sku} đã có hàng?`:`Cho phép SKIP SKU ${sku}?`))return;if(action==='NOT_FOUND'&&!confirm(`Xác nhận lần cuối: cho phép bỏ qua SKU ${sku}?`))return;try{setBusy(true,'Đang cập nhật…');await webApi('update-issue',{issue_id:b.dataset.id,action});await renderEventsForce();}catch(e){alert(e.message)}finally{setBusy(false)}});
      $$('[data-restore]',root).forEach(b=>b.onclick=async()=>{if(!confirm(`SKU ${b.dataset.sku} trước đó đã được bỏ qua. Xác nhận hiện đã có hàng?`))return;try{setBusy(true,'Đang báo lại có hàng…');await opsApi('restore-skipped',{issue_id:b.dataset.restore,reason:'Đã tìm thấy hàng sau khi cho phép bỏ qua'});await renderEventsForce();}catch(e){alert(e.message)}finally{setBusy(false)}});
    };renderBucket();
  }catch(error){if(token===ui.renderToken)content.innerHTML=`<div class="warehouse-v2-root">${heading('Xử lý báo hàng','Phân loại theo trạng thái nghiệp vụ.')}<div class="message" data-type="error">${escapeHtml(error.message)}</div></div>`;}finally{ui.rendering='';}
}
async function renderEventsForce'''
s = s[:render_match.start()] + new_render + s[render_match.end():]

# Remove waiting/claim wording from overview/report display without changing backend historical metrics.
s = s.replace("`${Number(summary.open_issue_count||0).toLocaleString('vi-VN')}`", "`${Number(summary.open_issue_count||0).toLocaleString('vi-VN')}`")
s = re.sub(r"\$\{metric\('Chờ xử lý',Number\(summary\.open_issue_count\|\|0\)\.toLocaleString\('vi-VN'\),'chưa có người nhận'\)\}\$\{metric\('Đang xử lý',Number\(summary\.claimed_issue_count\|\|0\)\.toLocaleString\('vi-VN'\),'đang có người phụ trách'\)\}", "${metric('Đang xử lý',Number((summary.open_issue_count||0)+(summary.claimed_issue_count||0)).toLocaleString('vi-VN'),'đang cần xử lý')}", s, count=1)
s = s.replace("'chờ nhận hoặc đang xử lý'", "'đang xử lý'")
s = s.replace("${kv('Đang chờ nhận',Number(status.OPEN||0).toLocaleString('vi-VN'))}${kv('Đang xử lý',Number((status.CLAIMED||0)+(status.SEARCHING||0)+(status.REPLENISHING||0)).toLocaleString('vi-VN'))}", "${kv('Đang xử lý',Number((status.OPEN||0)+(status.CLAIMED||0)+(status.SEARCHING||0)+(status.REPLENISHING||0)).toLocaleString('vi-VN'))}")
p.write_text(s)

css_path = "web-admin/src/warehouse-ui-v2.css"
p = Path(css_path)
s = p.read_text()
if s.count("grid-template-columns: repeat(5, minmax(0, 1fr));") != 1:
    raise SystemExit("wv css 5-tab guard mismatch")
s = s.replace("grid-template-columns: repeat(5, minmax(0, 1fr));", "grid-template-columns: repeat(4, minmax(0, 1fr));", 1)
s = s.replace(".wv2-product { margin: 9px 0 5px; color: #344054; font-size: 14px; }", ".wv2-product { margin: 9px 0 5px; color: #344054; font-size: 14px; font-weight: 650; }")
p.write_text(s)

# Shape / regression guards.
checks = {
    "app/src/main/res/layout/activity_main.xml": ['@+id/btnLog', 'android:text="Log"'],
    "app/src/main/res/layout/activity_login.xml": ['Copyright 2026 - SUPRA DC HƯNG YÊN - tamnv2 - Chuyên viên Pick Pack 1291'],
    "app/src/main/java/vn/pickpack1291/baohang/data/Models.kt": ['OPEN("OPEN", "ĐANG XỬ LÝ")', 'handledByName'],
    "app/src/main/java/vn/pickpack1291/baohang/ui/MainActivity.kt": ['Picker thu hồi SKU', 'Lịch sử chỉ lưu trữ trong ngày, cần nhiều hơn vui lòng liên hệ admin', 'R.id.btnLog', 'Gravity.BOTTOM', 'TEXT_ALIGNMENT_VIEW_START'],
    "supabase/functions/api/index.ts": ['open: []', 'claimed: active', 'handled_by_name', 'p_action: "CLAIM"'],
    "web-admin/src/main.js": ["issueBucket: 'claimed'", 'Copyright 2026 - SUPRA DC HƯNG YÊN - tamnv2 - Chuyên viên Pick Pack 1291'],
    "web-admin/src/warehouse-ui-v2.js": ["eventBucket: 'claimed'", 'Picker thu hồi SKU', 'handled_by_name'],
    "web-admin/src/warehouse-ui-v2.css": ['grid-template-columns: repeat(4, minmax(0, 1fr));'],
}
for path, needles in checks.items():
    data = Path(path).read_text()
    for needle in needles:
        if needle not in data:
            raise SystemExit(f"shape guard failed: {path}: {needle}")

# These user-facing queue terms must be absent from the live operational surfaces.
for path in [
    "app/src/main/java/vn/pickpack1291/baohang/data/Models.kt",
    "app/src/main/java/vn/pickpack1291/baohang/ui/MainActivity.kt",
    "web-admin/src/warehouse-ui-v2.js",
]:
    data = Path(path).read_text()
    for forbidden in ["Chờ xử lý", "CHỜ XỬ LÝ", "Chờ nhận", "CHỜ NHẬN"]:
        if forbidden in data:
            raise SystemExit(f"forbidden queue wording remains: {path}: {forbidden}")

print("PATCH_SHAPE=PASS")
