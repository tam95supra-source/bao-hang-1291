package vn.pickpack1291.baohang.realtime

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
 * FCM remains the fastest push path for every role. INVENT / ADMIN_INVENT / ADMIN
 * additionally use a lightweight authenticated Firestore marker watch while the
 * app is foreground, so the operator board still invalidates when an FCM delta is
 * delayed or missed. PICKER does not poll Firestore: critical Picker state remains
 * push-driven, avoiding unnecessary reads as Picker device count grows.
 * Canonical business data is always refetched from Neon after the marker changes.
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
    private var markerWatchEnabled = false

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
        markerWatchEnabled = role != UserRole.PICKER
        lastIssueMarker = null
        firestoreOnline = null
        RealtimeSignalBus.subscribe(listener)

        if (!markerWatchEnabled) {
            onStatus(Status.ONLINE)
            diagnostics.info("realtime_fcm_only_started", mapOf("role" to role.name))
            return
        }

        onStatus(Status.CONNECTING)
        diagnostics.info(
            "realtime_foreground_started",
            mapOf("role" to role.name, "firestore_interval_seconds" to 6, "scope" to "operator_only")
        )
        pollJob = scope.launch {
            while (isActive && running && markerWatchEnabled) {
                pollIssueMarker()
                delay(FIRESTORE_POLL_MS)
            }
        }
    }

    fun stop() {
        if (!running) return
        running = false
        markerWatchEnabled = false
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
        if (!running || !markerWatchEnabled || token.isBlank()) return
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

                // The first marker observed after foreground start is not just a baseline:
                // an issue may have changed while the Activity had no listener. Refresh once
                // immediately so a missed FCM delta cannot require logout/login to recover.
                if (previous != marker && running && markerWatchEnabled) {
                    diagnostics.info(
                        if (previous == null) "realtime_firestore_issue_initial_refresh" else "realtime_firestore_issue_changed",
                        mapOf("marker" to marker.take(120))
                    )
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
