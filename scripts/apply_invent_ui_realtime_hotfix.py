from pathlib import Path

main_path = Path('app/src/main/java/vn/pickpack1291/baohang/ui/MainActivity.kt')
realtime_path = Path('app/src/main/java/vn/pickpack1291/baohang/realtime/RealtimeClient.kt')

main = main_path.read_text(encoding='utf-8')

if 'import android.util.TypedValue\n' not in main:
    main = main.replace('import android.text.TextWatcher\n', 'import android.text.TextWatcher\nimport android.util.TypedValue\n', 1)
if 'import java.time.format.DateTimeFormatter\n' not in main:
    main = main.replace('import java.time.ZoneId\n', 'import java.time.ZoneId\nimport java.time.format.DateTimeFormatter\n', 1)

start = main.index('    private fun showInventBoard() {')
end = main.index('    private fun confirmIssueUpdate(', start)
replacement = r'''    private fun showInventBoard() {
        val isInvent = app.session.effectiveRole == UserRole.INVENT
        val root = fixedPage(SCREEN_INVENT, if (isInvent) "" else "Xử lý báo hàng")

        var board: IssueBoard? = null
        var selected = inventSelectedTab.coerceIn(0, 3)
        val tabButtons = mutableListOf<Button>()
        val tabBadges = mutableListOf<TextView>()

        val tabs = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, dp(4))
        }
        root.addView(tabs, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)))

        val listScroll = ScrollView(this).apply { isFillViewport = true }
        val boardContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.TOP
        }
        listScroll.addView(boardContainer, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        root.addView(listScroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))

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
            val ordered = when (selected) {
                0 -> raw.sortedBy { it.reportedAt }
                1, 2 -> raw.sortedByDescending { it.updatedAt }
                3 -> raw.sortedByDescending { it.withdrawnAt.ifBlank { it.updatedAt } }
                else -> raw
            }
            boardContainer.removeAllViews()
            if (ordered.isEmpty()) boardContainer.addView(infoBox("Không có SKU trong nhóm này."))
            ordered.forEach { issue -> boardContainer.addView(issueCard(issue, selected) { inventRefresh?.invoke() }) }
            updateTabs()
        }

        val labels = listOf("Đang xử lý", "Đã có hàng", "Đã bỏ qua", "Picker thu hồi")
        labels.forEachIndexed { index, label ->
            val tab = button(label) { selected = index; inventSelectedTab = index; draw() }.apply {
                minWidth = 0
                minimumWidth = 0
                minHeight = dp(44)
                setPadding(dp(2), 0, dp(2), 0)
                setSingleLine(true)
                setAutoSizeTextTypeUniformWithConfiguration(9, 12, 1, TypedValue.COMPLEX_UNIT_SP)
            }
            val badge = text("", 9, true).apply {
                gravity = Gravity.CENTER
                setTextColor(getColor(R.color.white))
                minWidth = dp(17)
                minHeight = dp(17)
                setPadding(dp(3), 0, dp(3), 0)
                background = GradientDrawable().apply {
                    shape = GradientDrawable.RECTANGLE
                    cornerRadius = dp(9).toFloat()
                    setColor(getColor(R.color.red_600))
                    setStroke(dp(1), getColor(R.color.white))
                }
                visibility = View.GONE
            }
            val tabFrame = FrameLayout(this)
            tabFrame.addView(tab, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(44), Gravity.CENTER))
            tabFrame.addView(badge, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(18), Gravity.TOP or Gravity.END).apply {
                setMargins(0, 0, dp(1), 0)
            })
            tabButtons += tab
            tabBadges += badge
            tabs.addView(tabFrame, LinearLayout.LayoutParams(0, dp(46), 1f).apply {
                setMargins(dp(1), 0, dp(1), 0)
            })
        }

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
            setPadding(dp(10), dp(7), dp(10), dp(7))
            setBackgroundResource(R.drawable.bg_card)
        }
        card.layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            setMargins(0, dp(2), 0, dp(2))
        }

        card.addView(text("SKU - ${issue.sku} - ${issue.reportCount} lượt báo", 15, true))
        card.addView(text(issue.productName, 13, true).apply { setPadding(0, dp(1), 0, dp(2)) })

        val actor = when (bucket) {
            3 -> issue.latestReporterName
            else -> issue.handledByName.ifBlank { issue.assignedName }
        }
        val actorTime = when (bucket) {
            3 -> issue.withdrawnAt.ifBlank { issue.updatedAt }
            1, 2 -> issue.updatedAt
            else -> if (actor.isNotBlank()) issue.updatedAt else ""
        }
        val handler = if (actor.isBlank()) {
            "Người xử lí: Chưa nhận"
        } else if (actorTime.isBlank()) {
            "Người xử lí: $actor"
        } else {
            "Người xử lí: $actor lúc ${fullDateTime(actorTime)}"
        }
        card.addView(text(handler, 12, false).apply { setTextColor(getColor(R.color.text_secondary)) })

        if (bucket == 0) {
            val actions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            actions.addView(
                button("Có hàng", ButtonTone.SUCCESS) { confirmIssueUpdate(issue, "AVAILABLE", refresh) }.apply {
                    textSize = 12f
                    minHeight = dp(42)
                    setPadding(dp(4), 0, dp(4), 0)
                },
                LinearLayout.LayoutParams(0, dp(42), 1f).apply { setMargins(0, dp(4), dp(2), 0) }
            )
            actions.addView(
                button("Cho SKIP", ButtonTone.DANGER) { confirmIssueUpdate(issue, "NOT_FOUND", refresh) }.apply {
                    textSize = 12f
                    minHeight = dp(42)
                    setPadding(dp(4), 0, dp(4), 0)
                },
                LinearLayout.LayoutParams(0, dp(42), 1f).apply { setMargins(dp(2), dp(4), 0, 0) }
            )
            card.addView(actions)
        } else if (bucket == 2) {
            val canRestore = elevated || (app.session.effectiveRole == UserRole.INVENT && issue.assignedId == app.session.profile?.id)
            if (canRestore) {
                card.addView(
                    button("Báo lại đã có hàng", ButtonTone.SUCCESS) { confirmRestoreSkipped(issue, refresh) }.apply {
                        textSize = 12f
                        minHeight = dp(42)
                    },
                    LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(42)).apply { setMargins(0, dp(4), 0, 0) }
                )
            }
        }
        return card
    }

'''
main = main[:start] + replacement + main[end:]

if 'private fun fullDateTime(' not in main:
    marker = '    private fun shortTime(iso: String): String = iso.replace(\'T\', \' \').take(16)\n'
    helper = r'''    private fun fullDateTime(iso: String): String {
        if (iso.isBlank()) return "—"
        val zone = ZoneId.systemDefault()
        val value = runCatching { OffsetDateTime.parse(iso).atZoneSameInstant(zone) }
            .recoverCatching { Instant.parse(iso).atZone(zone) }
            .getOrNull() ?: return iso.replace('T', ' ').take(19)
        return DateTimeFormatter.ofPattern("HH:mm:ss dd/MM/yyyy").format(value)
    }

'''
    if marker not in main:
        raise SystemExit('shortTime marker missing')
    main = main.replace(marker, helper + marker, 1)

main_path.write_text(main, encoding='utf-8')

realtime = r'''package vn.pickpack1291.baohang.realtime

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import vn.pickpack1291.baohang.data.UserRole
import vn.pickpack1291.baohang.diagnostics.DiagnosticsLogger
import java.util.concurrent.TimeUnit

/**
 * Foreground realtime invalidation client.
 *
 * FCM remains the fastest push path. A lightweight authenticated Firestore
 * marker watch runs only while the app is foreground and guarantees that UI
 * invalidation still arrives when an FCM delta is delayed or missed. The watch
 * reads one tiny document every 6 seconds; canonical business data is always
 * refetched from Neon after the marker changes.
 */
class RealtimeClient(
    private val diagnostics: DiagnosticsLogger,
    private val onIssueChanged: () -> Unit,
    private val onCatalogChanged: () -> Unit,
    private val onStaffChanged: () -> Unit,
    private val onConfigChanged: () -> Unit,
    private val onStatus: (Status) -> Unit = {}
) {
    enum class Status { CONNECTING, ONLINE, FALLBACK, OFFLINE }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val http = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.SECONDS)
        .build()

    @Volatile private var running = false
    @Volatile private var accessToken = ""
    private var pollJob: Job? = null
    private var lastIssueMarker: String? = null
    private var firestoreOnline: Boolean? = null

    private val listener: (RealtimeSignalBus.Topic) -> Unit = listener@ { topic ->
        if (!running) return@listener
        when (topic) {
            RealtimeSignalBus.Topic.ISSUES -> onIssueChanged()
            RealtimeSignalBus.Topic.CATALOG -> onCatalogChanged()
            RealtimeSignalBus.Topic.STAFF -> onStaffChanged()
            RealtimeSignalBus.Topic.CONFIG -> onConfigChanged()
        }
    }

    fun start(token: String, role: UserRole) {
        accessToken = token
        if (token.isBlank()) {
            onStatus(Status.OFFLINE)
            return
        }
        if (running) return

        running = true
        lastIssueMarker = null
        firestoreOnline = null
        RealtimeSignalBus.subscribe(listener)
        onStatus(Status.CONNECTING)
        diagnostics.info("realtime_foreground_started", mapOf("role" to role.name, "firestore_interval_seconds" to 6))

        pollJob = scope.launch {
            while (isActive && running) {
                pollIssueMarker()
                delay(FIRESTORE_POLL_MS)
            }
        }
    }

    fun stop() {
        if (!running) return
        running = false
        pollJob?.cancel()
        pollJob = null
        lastIssueMarker = null
        firestoreOnline = null
        RealtimeSignalBus.unsubscribe(listener)
        onStatus(Status.OFFLINE)
        diagnostics.info("realtime_foreground_stopped")
    }

    fun updateAccessToken(token: String) {
        accessToken = token
        if (running && token.isBlank()) diagnostics.warn("realtime_blank_token")
    }

    private fun pollIssueMarker() {
        val token = accessToken
        if (!running || token.isBlank()) return
        runCatching {
            val request = Request.Builder()
                .url(FIRESTORE_ISSUES_DOC)
                .header("Authorization", "Bearer $token")
                .header("Accept", "application/json")
                .get()
                .build()
            http.newCall(request).execute().use { response ->
                if (!response.isSuccessful) error("HTTP_${response.code}")
                val json = JSONObject(response.body?.string().orEmpty())
                val marker = json.optString("updateTime").ifBlank {
                    val fields = json.optJSONObject("fields")
                    val id = fields?.optJSONObject("entity_id")?.optString("stringValue").orEmpty()
                    val version = fields?.optJSONObject("entity_version")?.optString("integerValue").orEmpty()
                    "$id|$version"
                }
                if (marker.isBlank()) return@use
                val previous = lastIssueMarker
                lastIssueMarker = marker
                markFirestoreState(true, null)
                if (previous != null && previous != marker && running) {
                    diagnostics.info("realtime_firestore_issue_changed", mapOf("marker" to marker.take(120)))
                    onIssueChanged()
                }
            }
        }.onFailure { error ->
            markFirestoreState(false, error.message ?: error.javaClass.simpleName)
        }
    }

    private fun markFirestoreState(online: Boolean, error: String?) {
        if (firestoreOnline == online) return
        firestoreOnline = online
        if (online) {
            onStatus(Status.ONLINE)
            diagnostics.info("realtime_firestore_watch_online")
        } else {
            onStatus(Status.FALLBACK)
            diagnostics.warn("realtime_firestore_watch_fallback", mapOf("error" to error.orEmpty().take(200)))
        }
    }

    companion object {
        private const val FIRESTORE_POLL_MS = 6_000L
        private const val FIRESTORE_ISSUES_DOC =
            "https://firestore.googleapis.com/v1/projects/bao-hang-1291/databases/(default)/documents/realtime/issues"
    }
}
'''
realtime_path.write_text(realtime, encoding='utf-8')

print('PATCH_READY')
