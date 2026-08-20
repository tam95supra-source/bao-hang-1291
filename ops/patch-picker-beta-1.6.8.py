from pathlib import Path
import json

MAIN = Path("app/src/main/java/vn/pickpack1291/baohang/ui/MainActivity.kt")
COLORS = Path("app/src/main/res/values/colors.xml")
RELEASE = Path("ops/release-request.json")


def replace_block(text: str, start_marker: str, end_marker: str, replacement: str) -> str:
    if text.count(start_marker) != 1:
        raise SystemExit(f"Expected exactly one start marker: {start_marker!r}; got {text.count(start_marker)}")
    start = text.index(start_marker)
    end = text.index(end_marker, start)
    return text[:start] + replacement.rstrip() + "\n\n" + text[end:]


main = MAIN.read_text(encoding="utf-8")

import_anchor = "import vn.pickpack1291.baohang.update.AppUpdater\n"
if "import java.time.OffsetDateTime" not in main:
    if import_anchor not in main:
        raise SystemExit("MainActivity import anchor not found")
    main = main.replace(
        import_anchor,
        import_anchor
        + "import java.time.Instant\n"
        + "import java.time.LocalDate\n"
        + "import java.time.OffsetDateTime\n"
        + "import java.time.ZoneId\n",
        1,
    )

show_picker = r'''    private fun showPicker() {
        val root = fixedPage(SCREEN_PICKER)
        val recent = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.TOP
        }

        val entryRegion = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(10), dp(8), dp(10), dp(8))
            setBackgroundResource(R.drawable.bg_card)
        }
        val inputRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val suggestionsBox = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val selected = text("", 14, false).apply {
            visibility = View.GONE
            setPadding(dp(12), dp(9), dp(12), dp(9))
            background = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                cornerRadius = dp(10).toFloat()
                setColor(getColor(R.color.blue_50))
                setStroke(dp(1), getColor(R.color.blue_600))
            }
        }
        val input = EditText(this).apply {
            hint = "Nhập ít nhất 3 số của SKU"
            inputType = InputType.TYPE_CLASS_NUMBER
            filters = arrayOf(InputFilter.LengthFilter(8))
            setSingleLine(true)
            minimumWidth = 0
        }
        val reportButton = button("Báo thiếu", ButtonTone.DANGER) {}.apply {
            isEnabled = false
            setSingleLine(true)
            textSize = 14f
            minWidth = 0
            minimumWidth = 0
            setPadding(dp(6), 0, dp(6), 0)
        }
        var chosen: SkuItem? = null
        var internalTextChange = false

        entryRegion.addView(text("Nhập hoặc quét mã SKU", 12, true).apply { setPadding(dp(2), 0, 0, dp(4)) })
        inputRow.addView(
            input,
            LinearLayout.LayoutParams(0, dp(50), 1f).apply { setMargins(0, 0, dp(6), 0) }
        )
        inputRow.addView(reportButton, LinearLayout.LayoutParams(dp(104), dp(50)))
        entryRegion.addView(inputRow, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        entryRegion.addView(
            selected,
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                setMargins(0, dp(6), 0, 0)
            }
        )
        entryRegion.addView(
            suggestionsBox,
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                setMargins(0, dp(2), 0, 0)
            }
        )
        root.addView(
            entryRegion,
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                setMargins(0, 0, 0, dp(10))
            }
        )

        root.addView(text("Lịch sử báo hàng hôm nay", 14, true).apply { setPadding(dp(2), dp(2), 0, dp(6)) })
        val historyScroll = ScrollView(this).apply { isFillViewport = true }
        historyScroll.addView(recent, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        root.addView(historyScroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))

        fun clearSelection() {
            chosen = null
            selected.text = ""
            selected.visibility = View.GONE
            reportButton.isEnabled = false
        }
        fun select(item: SkuItem) {
            chosen = item
            selected.text = "SKU ${item.sku}\n${item.productName}"
            selected.visibility = View.VISIBLE
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
            items.take(5).forEach { item ->
                val suggestion = button("${item.sku}  •  ${item.productName}", ButtonTone.SECONDARY) { select(item) }.apply {
                    gravity = Gravity.START or Gravity.CENTER_VERTICAL
                    textAlignment = View.TEXT_ALIGNMENT_VIEW_START
                    textSize = 13f
                    minHeight = dp(44)
                    setPadding(dp(8), 0, dp(8), 0)
                }
                suggestionsBox.addView(
                    suggestion,
                    LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                        setMargins(0, dp(1), 0, dp(1))
                    }
                )
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
    }'''

load_issues = r'''    private fun loadMyIssues(target: LinearLayout) {
        lifecycleScope.launch {
            runCatching { app.repository.loadMyIssues() }
                .onSuccess { issues ->
                    target.removeAllViews()
                    target.gravity = Gravity.TOP
                    val visibleIssues = issues.filter { issue ->
                        isTodayReport(issue.reportedAt) || issue.status.isOpenBucket
                    }
                    if (visibleIssues.isEmpty()) target.addView(infoBox("Chưa có lịch sử báo hàng cần hiển thị."))
                    val ordered = visibleIssues.sortedBy { issue ->
                        if (issue.status == IssueStatus.WITHDRAWN) issue.withdrawnAt.ifBlank { issue.reportedAt } else issue.reportedAt
                    }
                    ordered.take(50).forEach { issue ->
                        val isOldUnresolved = !isTodayReport(issue.reportedAt) && issue.status.isOpenBucket
                        val (fillColor, strokeColor) = when {
                            issue.status == IssueStatus.AVAILABLE -> getColor(R.color.green_50) to getColor(R.color.green_600)
                            issue.status == IssueStatus.SKIP_ALLOWED -> getColor(R.color.red_50) to getColor(R.color.red_600)
                            issue.status.isOpenBucket -> getColor(R.color.amber_50) to getColor(R.color.amber_500)
                            else -> getColor(R.color.surface_subtle) to getColor(R.color.border)
                        }
                        val row = LinearLayout(this@MainActivity).apply {
                            orientation = LinearLayout.VERTICAL
                            setPadding(dp(12), dp(10), dp(12), dp(10))
                            background = GradientDrawable().apply {
                                shape = GradientDrawable.RECTANGLE
                                cornerRadius = dp(10).toFloat()
                                setColor(fillColor)
                                setStroke(dp(1), strokeColor)
                            }
                        }
                        row.addView(text("${issue.status.label} • SKU ${issue.sku}", 16, true))
                        row.addView(text(issue.productName, 13, true).apply { setPadding(0, dp(2), 0, dp(2)) })
                        val time = if (issue.status == IssueStatus.WITHDRAWN && issue.withdrawnAt.isNotBlank()) {
                            "Thu hồi lúc ${shortTime(issue.withdrawnAt)}"
                        } else {
                            "Báo lúc ${shortTime(issue.reportedAt)}"
                        }
                        row.addView(text(if (isOldUnresolved) "Chưa xử lý từ ngày trước • $time" else time, 12, false).apply {
                            setTextColor(getColor(R.color.text_secondary))
                        })
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
                        target.addView(
                            row,
                            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                setMargins(0, dp(3), 0, dp(3))
                            }
                        )
                    }
                }.onFailure {
                    target.removeAllViews()
                    target.addView(infoBox("Không tải được lịch sử: ${it.message}"))
                }
        }
    }'''

main = replace_block(
    main,
    "    private fun showPicker() {",
    "    private fun loadMyIssues(target: LinearLayout) {",
    show_picker,
)
main = replace_block(
    main,
    "    private fun loadMyIssues(target: LinearLayout) {",
    "    private fun confirmWithdrawIssue(",
    load_issues,
)

helper_anchor = "    private fun shortTime(iso: String): String = iso.replace('T', ' ').take(16)\n"
if "private fun isTodayReport(" not in main:
    if helper_anchor not in main:
        raise SystemExit("shortTime helper anchor not found")
    main = main.replace(
        helper_anchor,
        '''    private fun isTodayReport(iso: String): Boolean {
        if (iso.isBlank()) return false
        val zone = ZoneId.systemDefault()
        val reportDate = runCatching {
            OffsetDateTime.parse(iso).atZoneSameInstant(zone).toLocalDate()
        }.recoverCatching {
            Instant.parse(iso).atZone(zone).toLocalDate()
        }.getOrNull()
        return reportDate == LocalDate.now(zone)
    }

''' + helper_anchor,
        1,
    )

required_snippets = [
    'val root = fixedPage(SCREEN_PICKER)',
    'inputRow.addView(reportButton, LinearLayout.LayoutParams(dp(104), dp(50)))',
    'selected.visibility = View.GONE',
    'selected.visibility = View.VISIBLE',
    'root.addView(text("Lịch sử báo hàng hôm nay"',
    'isTodayReport(issue.reportedAt) || issue.status.isOpenBucket',
    'R.color.green_50',
    'R.color.red_50',
    'R.color.amber_50',
]
for snippet in required_snippets:
    if snippet not in main:
        raise SystemExit(f"Missing patched MainActivity invariant: {snippet}")

if 'fixedPage(SCREEN_PICKER, "Báo thiếu hàng")' in main:
    raise SystemExit("Old Picker title still active")
if 'SKU đã báo hôm nay • cũ → mới' in main:
    raise SystemExit("Old Picker history title still active")

MAIN.write_text(main, encoding="utf-8")

colors = COLORS.read_text(encoding="utf-8")
color_lines = '''    <color name="green_50">#E8F5EE</color>
    <color name="red_50">#FDECEC</color>
    <color name="amber_50">#FFF4D6</color>
    <color name="blue_50">#EAF2FF</color>
'''
if 'name="green_50"' not in colors:
    if colors.count("</resources>") != 1:
        raise SystemExit("colors.xml closing tag invariant failed")
    colors = colors.replace("</resources>", color_lines + "</resources>", 1)
COLORS.write_text(colors, encoding="utf-8")

release = {
    "action": "publish",
    "channel": "beta",
    "versionName": "1.6.8",
    "versionCode": 17,
    "mandatory": True,
    "releaseNotes": (
        "Beta 1.6.8: tối ưu màn Picker báo thiếu; bỏ tiêu đề Báo thiếu hàng và trạng thái Chưa chọn SKU; "
        "đặt nút Báo thiếu cùng dòng với ô nhập SKU, gợi ý SKU xổ xuống dưới; SKU đã chọn hiển thị ngay dưới vùng nhập với nền riêng; "
        "tách rõ vùng nhập và lịch sử; lịch sử chỉ giữ báo trong ngày và các SKU ngày cũ còn chưa xử lý; "
        "ẩn SKU ngày cũ đã hoàn tất; tô nền xanh nhạt cho Đã có hàng, đỏ nhạt cho Skip, vàng nhạt cho SKU đang xử lý; "
        "đổi tiêu đề thành Lịch sử báo hàng hôm nay."
    ),
}
RELEASE.write_text(json.dumps(release, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

print("Picker Beta 1.6.8 patch prepared")
