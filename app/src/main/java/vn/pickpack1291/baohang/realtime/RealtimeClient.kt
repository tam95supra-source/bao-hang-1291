package vn.pickpack1291.baohang.realtime

import vn.pickpack1291.baohang.data.UserRole
import vn.pickpack1291.baohang.diagnostics.DiagnosticsLogger

/**
 * Lightweight foreground realtime invalidation client.
 *
 * Android no longer maintains a Supabase WebSocket. Firebase Cloud Messaging
 * delivers small REALTIME_DELTA hints, and this client fans them into the same
 * callbacks used by the existing UI. Database state remains authoritative and
 * every callback refetches canonical state from Neon.
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

    @Volatile private var running = false

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
        if (token.isBlank()) {
            onStatus(Status.OFFLINE)
            return
        }
        if (running) return
        running = true
        RealtimeSignalBus.subscribe(listener)
        onStatus(Status.ONLINE)
        diagnostics.info(
            "realtime_fcm_bus_started",
            mapOf("role" to role.name)
        )
    }

    fun stop() {
        if (!running) return
        running = false
        RealtimeSignalBus.unsubscribe(listener)
        onStatus(Status.OFFLINE)
        diagnostics.info("realtime_fcm_bus_stopped")
    }

    fun updateAccessToken(token: String) {
        // FCM registration is independent from Firebase ID-token refresh.
        if (running && token.isBlank()) {
            diagnostics.warn("realtime_fcm_bus_blank_token")
        }
    }
}
