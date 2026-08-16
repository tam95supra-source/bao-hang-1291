from pathlib import Path
import re


def replace_once(path, old, new, label):
    p = Path(path)
    text = p.read_text()
    n = text.count(old)
    if n != 1:
        raise SystemExit(f"{label}: expected exactly 1 match, got {n}")
    p.write_text(text.replace(old, new, 1))


def regex_once(path, pattern, replacement, label, flags=re.S):
    p = Path(path)
    text = p.read_text()
    new_text, n = re.subn(pattern, lambda m: replacement, text, count=1, flags=flags)
    if n != 1:
        raise SystemExit(f"{label}: expected exactly 1 regex match, got {n}")
    p.write_text(new_text)

# Android: exact numeric substring search, no product-name matching and deterministic ranking.
replace_once(
    "app/src/main/java/vn/pickpack1291/baohang/data/AppDatabase.kt",
'''    fun searchSkuDigits(query: String, limit: Int = 20): List<SkuItem> {
        val digits = query.trim()
        if (digits.length < 3 || !digits.all(Char::isDigit)) return emptyList()
        val cursor = readableDatabase.rawQuery(
            """SELECT sku, product_name FROM sku_catalog
               WHERE sku LIKE ?
               ORDER BY CASE WHEN sku=? THEN 0 WHEN sku LIKE ? THEN 1 ELSE 2 END, sku
               LIMIT ?""",
            arrayOf("%$digits%", digits, "$digits%", limit.toString())
        )
        return cursor.use { buildList { while (it.moveToNext()) add(SkuItem(it.getString(0), it.getString(1))) } }
    }
''',
'''    fun searchSkuDigits(query: String, limit: Int = 20): List<SkuItem> {
        val digits = query.trim()
        if (digits.length !in 3..8 || !digits.all(Char::isDigit)) return emptyList()
        val cursor = readableDatabase.rawQuery(
            """SELECT sku, product_name FROM sku_catalog
               WHERE instr(sku, ?) > 0
               ORDER BY CASE WHEN sku=? THEN 0 WHEN sku LIKE ? THEN 1 ELSE 2 END,
                        instr(sku, ?), sku
               LIMIT ?""",
            arrayOf(digits, digits, "$digits%", digits, limit.coerceIn(1, 50).toString())
        )
        return cursor.use { buildList { while (it.moveToNext()) add(SkuItem(it.getString(0), it.getString(1))) } }
    }
''',
    "android numeric substring query",
)

# Model carries server-computed remaining withdrawal time so device clock cannot keep the button alive.
replace_once(
    "app/src/main/java/vn/pickpack1291/baohang/data/Models.kt",
'''    val withdrawnAt: String = "",
    val withdrawAllowedUntil: String = "",
    val canWithdraw: Boolean = false
''',
'''    val withdrawnAt: String = "",
    val withdrawAllowedUntil: String = "",
    val withdrawRemainingMs: Long = 0L,
    val canWithdraw: Boolean = false
''',
    "model withdrawal remaining field",
)
replace_once(
    "app/src/main/java/vn/pickpack1291/baohang/data/Models.kt",
'''            withdrawnAt = json.optString("withdrawn_at"),
            withdrawAllowedUntil = json.optString("withdraw_allowed_until"),
            canWithdraw = json.optBoolean("can_withdraw", false)
''',
'''            withdrawnAt = json.optString("withdrawn_at"),
            withdrawAllowedUntil = json.optString("withdraw_allowed_until"),
            withdrawRemainingMs = json.optLong("withdraw_remaining_ms", 0L).coerceAtLeast(0L),
            canWithdraw = json.optBoolean("can_withdraw", false)
''',
    "model withdrawal parser",
)
replace_once(
    "app/src/main/java/vn/pickpack1291/baohang/data/Models.kt",
'''data class IssueBoard(
    val open: List<StockIssue>,
    val claimed: List<StockIssue>,
    val recent: List<StockIssue>,
    val withdrawn: List<StockIssue> = emptyList()
) {
''',
'''data class IssueBoard(
    val open: List<StockIssue>,
    val claimed: List<StockIssue>,
    val recent: List<StockIssue>,
    val withdrawn: List<StockIssue> = emptyList(),
    val openCount: Int = open.size,
    val claimedCount: Int = claimed.size,
    val availableCount: Int = recent.count { it.status == IssueStatus.AVAILABLE },
    val skippedCount: Int = recent.count { it.status == IssueStatus.SKIP_ALLOWED },
    val withdrawnCount: Int = withdrawn.size
) {
''',
    "issue board count model",
)

# Android API uses authoritative backend counts; withdrawal board remains a separate secured endpoint.
replace_once(
    "app/src/main/java/vn/pickpack1291/baohang/network/ApiClient.kt",
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
'''    suspend fun issueBoard(): IssueBoard {
        val response = invoke("issue-board", JSONObject())
        val withdrawalResponse = runCatching { invokeWithdraw("board", JSONObject()) }.getOrDefault(JSONObject())
        val open = response.optJSONArray("open").toStockIssues()
        val claimed = response.optJSONArray("claimed").toStockIssues()
        val recent = response.optJSONArray("recent").toStockIssues()
        val withdrawn = withdrawalResponse.optJSONArray("withdrawn").toStockIssues()
        val counts = response.optJSONObject("counts") ?: JSONObject()
        return IssueBoard(
            open = open,
            claimed = claimed,
            recent = recent,
            withdrawn = withdrawn,
            openCount = counts.optInt("open", open.size),
            claimedCount = counts.optInt("claimed", claimed.size),
            availableCount = counts.optInt("available", recent.count { it.status == IssueStatus.AVAILABLE }),
            skippedCount = counts.optInt("skipped", recent.count { it.status == IssueStatus.SKIP_ALLOWED }),
            withdrawnCount = withdrawalResponse.optInt("count", withdrawn.size)
        )
    }
''',
    "android authoritative board counts",
)

# Android Picker UI: remove AutoCompleteTextView's hidden filter + 180ms delay. Render suggestions ourselves.
p = Path("app/src/main/java/vn/pickpack1291/baohang/ui/MainActivity.kt")
text = p.read_text()
text = text.replace("import android.os.Bundle\n", "import android.os.Bundle\nimport android.os.SystemClock\n", 1)
text = text.replace("import android.text.Editable\n", "import android.text.Editable\nimport android.text.InputFilter\n", 1)
text = text.replace("import android.widget.ArrayAdapter\n", "", 1)
text = text.replace("import android.widget.AutoCompleteTextView\n", "", 1)
p.write_text(text)

new_picker_block = r'''    private fun showPicker() {
        val content = page("Báo thiếu hàng", SCREEN_PICKER)
        content.addView(text("Nhập hoặc quét mã SKU", 14, true).apply { setPadding(0, 0, 0, dp(5)) })
        val input = EditText(this).apply {
            hint = "Nhập ít nhất 3 số của SKU"
            inputType = InputType.TYPE_CLASS_NUMBER
            filters = arrayOf(InputFilter.LengthFilter(8))
            setSingleLine(true)
        }
        val suggestionsBox = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val selected = infoBox("Chưa chọn SKU")
        val reportButton = button("Báo thiếu", ButtonTone.DANGER) {}
        reportButton.isEnabled = false
        val recent = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        var chosen: SkuItem? = null
        var internalTextChange = false
        content.addView(input)
        content.addView(suggestionsBox)
        content.addView(selected)
        content.addView(reportButton, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(56)).apply { setMargins(0, dp(4), 0, dp(2)) })
        addDiagnosticsButton(content)
        content.addView(section("Báo gần đây"))
        content.addView(recent)

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
                    setPadding(dp(4), dp(7), dp(4), dp(7))
                })
                return
            }
            items.take(12).forEach { item ->
                suggestionsBox.addView(
                    button("${item.sku}  •  ${item.productName}", ButtonTone.SECONDARY) { select(item) },
                    LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                        setMargins(0, dp(2), 0, dp(2))
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
                        target.addView(row, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { setMargins(0, dp(4), 0, dp(4)) })
                    }
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
    new_picker_block + "    private fun showCatalog() {",
    "replace picker screen + withdrawal timer",
)

# Use backend-provided counts and make the time scope explicit on Android.
replace_once(
    "app/src/main/java/vn/pickpack1291/baohang/ui/MainActivity.kt",
'''            val counts = board?.let { listOf(it.open.size, it.claimed.size, it.available.size, it.skipped.size, it.withdrawn.size) } ?: listOf(0, 0, 0, 0, 0)
''',
'''            val counts = board?.let { listOf(it.openCount, it.claimedCount, it.availableCount, it.skippedCount, it.withdrawnCount) } ?: listOf(0, 0, 0, 0, 0)
''',
    "android badge authoritative counts",
)
replace_once(
    "app/src/main/java/vn/pickpack1291/baohang/ui/MainActivity.kt",
'''                1 -> "${list.size} SKU đang xử lý${if (app.session.effectiveRole == UserRole.INVENT) " của tôi" else ""}"
                2 -> "${list.size} SKU đã có hàng"
                3 -> "${list.size} SKU đã được cho SKIP"
                4 -> "${list.size} lượt Người lấy hàng đã thu hồi SKU"
                else -> "${list.size} SKU đang chờ xử lý"
''',
'''                1 -> "${data.claimedCount} SKU đang xử lý${if (app.session.effectiveRole == UserRole.INVENT) " của tôi" else ""} • hiện tại"
                2 -> "${data.availableCount} SKU đã có hàng hôm nay"
                3 -> "${data.skippedCount} SKU đã được cho SKIP hôm nay"
                4 -> "${data.withdrawnCount} lượt Người lấy hàng đã thu hồi SKU hôm nay"
                else -> "${data.openCount} SKU đang chờ xử lý • hiện tại"
''',
    "android bucket scope text",
)

# Main API: resolved buckets are today in warehouse local time; active queues remain current.
replace_once(
    "supabase/functions/api/index.ts",
'''function normalizeSearch(value: string): string {
  return value.normalize("NFD").replace(/\\p{M}+/gu, "").toLowerCase().replace(/đ/g, "d").replace(/\\s+/g, " ").trim();
}
''',
'''function normalizeSearch(value: string): string {
  return value.normalize("NFD").replace(/\\p{M}+/gu, "").toLowerCase().replace(/đ/g, "d").replace(/\\s+/g, " ").trim();
}
function siteDayBounds(now = Date.now()) {
  const localDate = new Date(now + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const startMs = new Date(`${localDate}T00:00:00+07:00`).getTime();
  return { start: new Date(startMs).toISOString(), end: new Date(startMs + 24 * 60 * 60 * 1000).toISOString() };
}
''',
    "site day helper",
)
replace_once(
    "supabase/functions/api/index.ts",
'''    case "issue-board": {
      requireRole(context, ["ADMIN", "ADMIN_INVENT", "INVENT"]);
      const [open, claimed, recent] = await Promise.all([
        issueRows(undefined, ["OPEN"], 250),
        issueRows(undefined, ["CLAIMED", "SEARCHING", "REPLENISHING"], 250),
        issueRows(undefined, ["AVAILABLE", "SKIP_ALLOWED"], 250),
      ]);
      const mine = context.effectiveRole === "INVENT" ? claimed.filter((issue: any) => issue.assigned_id === context.userId) : claimed;
      return { open, claimed: mine, recent: recent.reverse(), skipped: recent.filter((i: any) => i.status === "SKIP_ALLOWED").reverse(), available: recent.filter((i: any) => i.status === "AVAILABLE").reverse() };
    }
''',
'''    case "issue-board": {
      requireRole(context, ["ADMIN", "ADMIN_INVENT", "INVENT"]);
      const { start, end } = siteDayBounds();
      let claimedCountQuery = admin.from("issues").select("id", { count: "exact", head: true }).in("status", ["CLAIMED", "SEARCHING", "REPLENISHING"]);
      if (context.effectiveRole === "INVENT") claimedCountQuery = claimedCountQuery.eq("claimed_by", context.userId);
      const [open, claimed, recentRefs, openCount, claimedCount, availableCount, skippedCount] = await Promise.all([
        issueRows(undefined, ["OPEN"], 500),
        issueRows(undefined, ["CLAIMED", "SEARCHING", "REPLENISHING"], 500),
        admin.from("issues").select("id,status,resolved_at").in("status", ["AVAILABLE", "SKIP_ALLOWED"]).gte("resolved_at", start).lt("resolved_at", end).order("resolved_at", { ascending: false }).limit(1000),
        admin.from("issues").select("id", { count: "exact", head: true }).eq("status", "OPEN"),
        claimedCountQuery,
        admin.from("issues").select("id", { count: "exact", head: true }).eq("status", "AVAILABLE").gte("resolved_at", start).lt("resolved_at", end),
        admin.from("issues").select("id", { count: "exact", head: true }).eq("status", "SKIP_ALLOWED").gte("resolved_at", start).lt("resolved_at", end),
      ]);
      for (const result of [recentRefs, openCount, claimedCount, availableCount, skippedCount]) if (result.error) throw result.error;
      const recentIds = (recentRefs.data ?? []).map((row: any) => String(row.id));
      const recentRows = recentIds.length ? await issueRows(recentIds, undefined, 1000) : [];
      const byId = new Map(recentRows.map((row: any) => [String(row.id), row]));
      const recent = recentIds.map((id: string) => byId.get(id)).filter(Boolean);
      const mine = context.effectiveRole === "INVENT" ? claimed.filter((issue: any) => issue.assigned_id === context.userId) : claimed;
      return {
        open,
        claimed: mine,
        recent,
        skipped: recent.filter((i: any) => i.status === "SKIP_ALLOWED"),
        available: recent.filter((i: any) => i.status === "AVAILABLE"),
        counts: { open: openCount.count ?? open.length, claimed: claimedCount.count ?? mine.length, available: availableCount.count ?? 0, skipped: skippedCount.count ?? 0 },
        scope: { active: "CURRENT", resolved: "TODAY", day_start: start, day_end: end },
      };
    }
''',
    "api operational board scope",
)

# Withdrawal/search Edge Function: fast deterministic online fallback, server remaining milliseconds, today-only operator board.
replace_once(
    "supabase/functions/issue-withdraw/index.ts",
'''function requireRole(context:Context, roles:Role[]){if(!roles.includes(context.effectiveRole))throw new HttpError(403,"Bạn không có quyền thực hiện thao tác này");}
''',
'''function requireRole(context:Context, roles:Role[]){if(!roles.includes(context.effectiveRole))throw new HttpError(403,"Bạn không có quyền thực hiện thao tác này");}
function siteDayBounds(now=Date.now()){const localDate=new Date(now+7*60*60*1000).toISOString().slice(0,10);const startMs=new Date(`${localDate}T00:00:00+07:00`).getTime();return {start:new Date(startMs).toISOString(),end:new Date(startMs+24*60*60*1000).toISOString()};}
''',
    "withdraw site day helper",
)
replace_once(
    "supabase/functions/issue-withdraw/index.ts",
'''      requireRole(context,["PICKER"]);const q=String(body.query??"").trim();if(!/^\\d{3,}$/.test(q))return json(req,{items:[]});
      const limit=Math.min(20,Math.max(1,Number(body.limit??20)));const {data,error}=await admin.from("sku_catalog").select("sku,product_name").eq("active",true).ilike("sku",`%${q}%`).order("sku").limit(limit);if(error)throw error;return json(req,{items:data??[]});
''',
'''      requireRole(context,["PICKER"]);const q=String(body.query??"").trim();if(!/^\\d{3,8}$/.test(q))return json(req,{items:[]});
      const limit=Math.min(20,Math.max(1,Number(body.limit??20)));const fetchLimit=Math.min(200,Math.max(50,limit*5));const {data,error}=await admin.from("sku_catalog").select("sku,product_name").eq("active",true).ilike("sku",`%${q}%`).order("sku").limit(fetchLimit);if(error)throw error;const ranked=(data??[]).sort((a:any,b:any)=>{const rank=(sku:string)=>sku===q?[0,0]:sku.startsWith(q)?[1,0]:[2,Math.max(0,sku.indexOf(q))];const ar=rank(String(a.sku)),br=rank(String(b.sku));return ar[0]-br[0]||ar[1]-br[1]||String(a.sku).localeCompare(String(b.sku));});return json(req,{items:ranked.slice(0,limit)});
''',
    "withdraw online search ranking",
)
replace_once(
    "supabase/functions/issue-withdraw/index.ts",
'''      for(const [id,source] of latestByIssue){const raw=byIssue.get(id);if(!raw)continue;const deadline=new Date(new Date(source.reported_at).getTime()+30000).toISOString();const withdrawn=Boolean(source.withdrawn_at);const base=baseIssue(raw);issues.push({id:base.id,sku:base.sku,product_name:base.product_name,status:withdrawn?"WITHDRAWN":raw.status,reported_at:source.reported_at,updated_at:base.updated_at,issue_version:base.issue_version,assigned_id:base.assigned_id,withdrawn_at:withdrawn?source.withdrawn_at:null,withdraw_allowed_until:deadline,can_withdraw:!withdrawn&&now<=new Date(deadline).getTime()});}
''',
'''      for(const [id,source] of latestByIssue){const raw=byIssue.get(id);if(!raw)continue;const deadlineMs=new Date(source.reported_at).getTime()+30000;const deadline=new Date(deadlineMs).toISOString();const withdrawn=Boolean(source.withdrawn_at);const remainingMs=withdrawn?0:Math.max(0,deadlineMs-now);const base=baseIssue(raw);issues.push({id:base.id,sku:base.sku,product_name:base.product_name,status:withdrawn?"WITHDRAWN":raw.status,reported_at:source.reported_at,updated_at:base.updated_at,issue_version:base.issue_version,assigned_id:base.assigned_id,withdrawn_at:withdrawn?source.withdrawn_at:null,withdraw_allowed_until:deadline,withdraw_remaining_ms:remainingMs,can_withdraw:!withdrawn&&remainingMs>0});}
''',
    "server withdrawal remaining ms",
)
replace_once(
    "supabase/functions/issue-withdraw/index.ts",
'''      requireRole(context,["ADMIN","ADMIN_INVENT","INVENT"]);
      const {data:reports,error}=await admin.from("issue_reports").select("id,issue_id,reporter_id,reported_at,withdrawn_at").not("withdrawn_at","is",null).order("withdrawn_at",{ascending:false}).limit(200);if(error)throw error;
''',
'''      requireRole(context,["ADMIN","ADMIN_INVENT","INVENT"]);const {start,end}=siteDayBounds();
      const {data:reports,error,count}=await admin.from("issue_reports").select("id,issue_id,reporter_id,reported_at,withdrawn_at",{count:"exact"}).not("withdrawn_at","is",null).gte("withdrawn_at",start).lt("withdrawn_at",end).order("withdrawn_at",{ascending:false}).limit(500);if(error)throw error;
''',
    "today-only withdrawal board query",
)
replace_once(
    "supabase/functions/issue-withdraw/index.ts",
'''      return json(req,{withdrawn});
''',
'''      return json(req,{withdrawn,count:count??withdrawn.length,scope:"TODAY",day_start:start,day_end:end});
''',
    "withdrawal board count response",
)

# Web operational board: same scope semantics and fifth withdrawal bucket.
replace_once(
    "web-admin/src/warehouse-ui-v2.js",
'''const ADMIN_OPS = `${SUPABASE_URL}/functions/v1/admin-ops`;
''',
'''const ADMIN_OPS = `${SUPABASE_URL}/functions/v1/admin-ops`;
const ISSUE_WITHDRAW = `${SUPABASE_URL}/functions/v1/issue-withdraw`;
''',
    "web withdrawal endpoint",
)
replace_once(
    "web-admin/src/warehouse-ui-v2.js",
'''const webApi=(action,payload={})=>request(WEB_API,action,payload); const opsApi=(action,payload={})=>request(ADMIN_OPS,action,payload);
''',
'''const webApi=(action,payload={})=>request(WEB_API,action,payload); const opsApi=(action,payload={})=>request(ADMIN_OPS,action,payload); const withdrawApi=(action,payload={})=>request(ISSUE_WITHDRAW,action,payload);
''',
    "web withdrawal api helper",
)
replace_once(
    "web-admin/src/warehouse-ui-v2.js",
'''function statusLabel(status) { return ({ OPEN:'Chờ xử lý', CLAIMED:'Đang xử lý', SEARCHING:'Đang tìm hàng', REPLENISHING:'Đang châm hàng', AVAILABLE:'Đã có hàng', SKIP_ALLOWED:'Đã bỏ qua', CLOSED:'Đã đóng' })[status] || status || '—'; }
''',
'''function statusLabel(status) { return ({ OPEN:'Chờ xử lý', CLAIMED:'Đang xử lý', SEARCHING:'Đang tìm hàng', REPLENISHING:'Đang châm hàng', AVAILABLE:'Đã có hàng', SKIP_ALLOWED:'Đã bỏ qua', CLOSED:'Đã đóng', WITHDRAWN:'Đã thu hồi' })[status] || status || '—'; }
''',
    "web withdrawn status label",
)
replace_once(
    "web-admin/src/warehouse-ui-v2.js",
'''function bucketRows(board,bucket){if(bucket==='claimed')return board.claimed||[];if(bucket==='available')return board.available||(board.recent||[]).filter(x=>x.status==='AVAILABLE');if(bucket==='skipped')return board.skipped||(board.recent||[]).filter(x=>x.status==='SKIP_ALLOWED');return board.open||[];}
''',
'''function bucketRows(board,bucket){if(bucket==='claimed')return board.claimed||[];if(bucket==='available')return board.available||(board.recent||[]).filter(x=>x.status==='AVAILABLE');if(bucket==='skipped')return board.skipped||(board.recent||[]).filter(x=>x.status==='SKIP_ALLOWED');if(bucket==='withdrawn')return board.withdrawn||[];return board.open||[];}
''',
    "web withdrawn bucket rows",
)
replace_once(
    "web-admin/src/warehouse-ui-v2.js",
'''  const state=bucket==='available'?'available':bucket==='skipped'?'skipped':bucket==='claimed'?'claimed':'open',assignment=issue.assigned_name?` · Phụ trách: ${escapeHtml(issue.assigned_name)}`:'',recurrence=issue.recurrence_30m?' · Báo lại trong 30 phút':'';let actions='';
''',
'''  const state=bucket==='available'?'available':bucket==='skipped'?'skipped':bucket==='withdrawn'?'withdrawn':bucket==='claimed'?'claimed':'open',assignment=issue.assigned_name?` · Phụ trách: ${escapeHtml(issue.assigned_name)}`:'',recurrence=issue.recurrence_30m?' · Báo lại trong 30 phút':'';let actions='';
''',
    "web withdrawn card state",
)
replace_once(
    "web-admin/src/warehouse-ui-v2.js",
'''  return `<article class="wv2-issue" data-state="${state}"><div class="wv2-issue-head"><div><strong>SKU ${escapeHtml(issue.sku)}</strong><span>${Number(issue.report_count||1)} lượt báo${recurrence}</span></div><time>${escapeHtml(formatTime(issue.reported_at))}</time></div><div class="wv2-product">${escapeHtml(issue.product_name||'')}</div><div class="wv2-meta"><span class="wv2-status ${statusClass(issue.status)}">${escapeHtml(statusLabel(issue.status))}</span>${assignment}</div>${actions}</article>`;
''',
'''  const detail=bucket==='withdrawn'?`<span>Người lấy hàng: ${escapeHtml(issue.latest_reporter_name||'—')}</span>`:`<span>${Number(issue.report_count||1)} lượt báo${recurrence}</span>`;const eventTime=bucket==='withdrawn'?(issue.withdrawn_at||issue.updated_at):issue.reported_at;const withdrawalNote=bucket==='withdrawn'?`<div class="wv2-meta">${escapeHtml(issue.latest_message||'Đã ghi nhận thu hồi báo thiếu.')}</div>`:'';
  return `<article class="wv2-issue" data-state="${state}"><div class="wv2-issue-head"><div><strong>SKU ${escapeHtml(issue.sku)}</strong>${detail}</div><time>${escapeHtml(formatTime(eventTime))}</time></div><div class="wv2-product">${escapeHtml(issue.product_name||'')}</div><div class="wv2-meta"><span class="wv2-status ${statusClass(issue.status)}">${escapeHtml(statusLabel(issue.status))}</span>${assignment}</div>${withdrawalNote}${actions}</article>`;
''',
    "web withdrawal card detail",
)

regex_once(
    "web-admin/src/warehouse-ui-v2.js",
    r"async function renderEvents\(\)\{.*?\n\}\nasync function renderEventsForce",
    r'''async function renderEvents(){
  const content=prepareContent('events');if(!content||ui.rendering==='events')return;ui.rendering='events';const token=++ui.renderToken;content.innerHTML=`<div class="warehouse-v2-root">${heading('Xử lý báo hàng','Chờ/Đang xử lý là số hiện tại; Có hàng/SKIP/Thu hồi tính trong hôm nay.')}<div class="wv2-empty">Đang tải báo thiếu…</div></div>`;
  try{const[board,withdrawalBoard]=await Promise.all([webApi('issue-board'),withdrawApi('board')]);if(token!==ui.renderToken||activeTab()!=='events')return;board.withdrawn=withdrawalBoard.withdrawn||[];const c=board.counts||{};const counts={open:Number(c.open??bucketRows(board,'open').length),claimed:Number(c.claimed??bucketRows(board,'claimed').length),available:Number(c.available??bucketRows(board,'available').length),skipped:Number(c.skipped??bucketRows(board,'skipped').length),withdrawn:Number(withdrawalBoard.count??bucketRows(board,'withdrawn').length)};
    const renderBucket=()=>{const rows=bucketRows(board,ui.eventBucket),root=$('.warehouse-v2-root',content);if(!root)return;root.innerHTML=`${heading('Xử lý báo hàng','Chờ/Đang xử lý = hiện tại · Có hàng/SKIP/Thu hồi = hôm nay (giờ kho Việt Nam).')}<div class="wv2-tabs"><button data-wv2-bucket="open" class="${ui.eventBucket==='open'?'active':''}">Chờ xử lý <span class="wv2-count">${counts.open}</span></button><button data-wv2-bucket="claimed" class="${ui.eventBucket==='claimed'?'active':''}">Đang xử lý <span class="wv2-count">${counts.claimed}</span></button><button data-wv2-bucket="available" class="${ui.eventBucket==='available'?'active':''}">Đã có hàng <span class="wv2-count">${counts.available}</span></button><button data-wv2-bucket="skipped" class="${ui.eventBucket==='skipped'?'active':''}">Đã bỏ qua <span class="wv2-count">${counts.skipped}</span></button><button data-wv2-bucket="withdrawn" class="${ui.eventBucket==='withdrawn'?'active':''}">Đã thu hồi <span class="wv2-count">${counts.withdrawn}</span></button></div><div id="wv2IssueList">${rows.length?rows.map(i=>issueCard(i,ui.eventBucket)).join(''):'<div class="wv2-empty">Không có SKU trong nhóm này.</div>'}</div>`;
      $$('[data-wv2-bucket]',root).forEach(b=>b.onclick=()=>{ui.eventBucket=b.dataset.wv2Bucket;renderBucket();});
      $$('[data-claim]',root).forEach(b=>b.onclick=async()=>{try{setBusy(true,'Đang nhận xử lý…');await webApi('claim-issue',{issue_id:b.dataset.claim});await renderEventsForce();}catch(e){alert(e.message)}finally{setBusy(false)}});
      $$('[data-update]',root).forEach(b=>b.onclick=async()=>{const action=b.dataset.update,sku=b.dataset.sku;if(action==='NOT_FOUND'){if(!confirm(`Không tìm thấy SKU ${sku}. Cho phép Người lấy hàng bỏ qua SKU này?`))return;if(!confirm(`Xác nhận lần cuối: cho phép bỏ qua SKU ${sku}?`))return;}else if(!confirm(`Xác nhận SKU ${sku} đã có hàng hoặc đã châm hàng?`))return;try{setBusy(true,'Đang cập nhật trạng thái…');await webApi('update-issue',{issue_id:b.dataset.id,action});await renderEventsForce();}catch(e){alert(e.message)}finally{setBusy(false)}});
      $$('[data-restore]',root).forEach(b=>b.onclick=async()=>{const sku=b.dataset.sku;if(!confirm(`SKU ${sku} trước đó đã được cho phép bỏ qua.\n\nXác nhận hiện đã tìm thấy hàng? Quyền bỏ qua cũ sẽ bị hủy và toàn bộ Người lấy hàng đã báo SKU này sẽ nhận cảnh báo ĐÃ CÓ HÀNG.`))return;try{setBusy(true,'Đang hủy trạng thái bỏ qua và gửi cảnh báo…');await opsApi('restore-skipped',{issue_id:b.dataset.restore,reason:'Đã tìm thấy hàng sau khi cho phép bỏ qua'});ui.eventBucket='available';await renderEventsForce();}catch(e){alert(e.message)}finally{setBusy(false)}});
      $$('[data-reassign]',root).forEach(b=>b.onclick=async()=>{try{const users=(await webApi('list-users')).users.filter(u=>['INVENT','ADMIN_INVENT'].includes(u.role)&&u.active);if(!users.length)throw new Error('Không có Người báo hàng đang hoạt động để điều phối.');const options=users.map((u,i)=>`${i+1}. ${u.employee_code} — ${u.full_name}`).join('\n'),selected=prompt(`Điều phối SKU ${b.dataset.sku}\n\n${options}\n\nNhập số thứ tự người nhận:`);if(!selected)return;const target=users[Number(selected)-1];if(!target)throw new Error('Lựa chọn không hợp lệ.');const reason=prompt('Lý do điều phối lại:');if(!reason?.trim())return;setBusy(true,'Đang điều phối…');await webApi('reassign-issue',{issue_id:b.dataset.reassign,new_assignee_id:target.id,reason:reason.trim()});await renderEventsForce();}catch(e){alert(e.message)}finally{setBusy(false)}});
    };renderBucket();
  }catch(error){if(token===ui.renderToken)content.innerHTML=`<div class="warehouse-v2-root">${heading('Xử lý báo hàng','Phân loại theo trạng thái nghiệp vụ.')}<div class="message" data-type="error">${escapeHtml(error.message)}</div></div>`;}finally{ui.rendering='';}
}
async function renderEventsForce''',
    "replace web operational board",
)

replace_once(
    "web-admin/src/warehouse-ui-v2.css",
'''  grid-template-columns: repeat(4, minmax(0, 1fr));
''',
'''  grid-template-columns: repeat(5, minmax(0, 1fr));
''',
    "web five status tabs",
)
replace_once(
    "web-admin/src/warehouse-ui-v2.css",
'''.wv2-issue[data-state="skipped"]::before { background: #98a2b3; }
''',
'''.wv2-issue[data-state="skipped"]::before { background: #98a2b3; }
.wv2-issue[data-state="withdrawn"]::before { background: #d92d20; }
''',
    "web withdrawn accent",
)

# Shape checks: fail before build if any core requirement vanished.
checks = {
    "app/src/main/java/vn/pickpack1291/baohang/ui/MainActivity.kt": ["InputFilter.LengthFilter(8)", "withdrawRemainingMs", "SystemClock.elapsedRealtime()", "Không có SKU chứa chuỗi", "data.availableCount"],
    "app/src/main/java/vn/pickpack1291/baohang/data/AppDatabase.kt": ["instr(sku, ?) > 0", "digits.length !in 3..8"],
    "supabase/functions/api/index.ts": ["resolved: \"TODAY\"", "siteDayBounds", "availableCount.count"],
    "supabase/functions/issue-withdraw/index.ts": ["withdraw_remaining_ms", "scope:\"TODAY\"", "fetchLimit"],
    "web-admin/src/warehouse-ui-v2.js": ["withdrawApi('board')", "Đã thu hồi", "Có hàng/SKIP/Thu hồi = hôm nay"],
}
for path, needles in checks.items():
    data = Path(path).read_text()
    for needle in needles:
        if needle not in data:
            raise SystemExit(f"shape check failed: {path}: {needle}")
print("PATCH_SHAPE=PASS")
