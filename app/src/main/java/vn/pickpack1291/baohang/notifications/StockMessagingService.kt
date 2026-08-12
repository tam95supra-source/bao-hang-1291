package vn.pickpack1291.baohang.notifications

import android.provider.Settings
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import vn.pickpack1291.baohang.BaoHangApplication
import vn.pickpack1291.baohang.data.IssueStatus
import vn.pickpack1291.baohang.data.UserRole

class StockMessagingService : FirebaseMessagingService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        val app = application as BaoHangApplication
        app.diagnostics.info("fcm_new_token")
        if (app.session.isLoggedIn) app.repository.registerDeviceAsync(token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        val app = application as BaoHangApplication
        val data = message.data
        val eventId = data["event_id"].orEmpty().ifBlank { message.messageId.orEmpty() }
        val issueId = data["issue_id"].orEmpty()
        val incomingVersion = data["issue_version"]?.toLongOrNull() ?: 1L
        val sku = data["sku"].orEmpty()
        val product = data["product_name"].orEmpty()
        val status = data["status"].orEmpty()
        val body = data["message"].orEmpty().ifBlank { message.notification?.body.orEmpty() }

        // Notification is a hint, never the source of truth. A locally cached newer issue
        // version is enough to prove this FCM is stale and must not cover newer UI state.
        val cached = issueId.takeIf { it.isNotBlank() }?.let(app.database::cachedIssue)
        val stale = cached != null && (
            cached.issueVersion > incomingVersion ||
                (cached.issueVersion == incomingVersion && cached.status != IssueStatus.from(status))
            )
        if (stale) {
            app.diagnostics.info(
                "fcm_stale_discarded",
                mapOf(
                    "event_id" to eventId,
                    "issue_id" to issueId,
                    "incoming_version" to incomingVersion,
                    "cached_version" to cached.issueVersion,
                    "incoming_status" to status,
                    "cached_status" to cached.status.wire
                )
            )
            return
        }

        app.diagnostics.info(
            "fcm_received",
            mapOf(
                "event_id" to eventId,
                "issue_id" to issueId,
                "issue_version" to incomingVersion,
                "sku" to sku,
                "status" to status,
                "critical" to data["critical"].orEmpty()
            )
        )
        if (eventId.isNotBlank() && app.session.isLoggedIn) {
            scope.launch {
                runCatching { app.repository.markAlertReceived(eventId) }
                    .onFailure { app.diagnostics.warn("fcm_received_metric_deferred", mapOf("event_id" to eventId)) }
            }
        }

        NotificationHelper.alert(this, sku, status, body, eventId)
        if (Settings.canDrawOverlays(this)) {
            val canClaim = status == "OPEN" && app.session.effectiveRole in setOf(UserRole.ADMIN, UserRole.ADMIN_INVENT, UserRole.INVENT)
            val overlay = OverlayAlertService.intent(
                this, eventId, issueId, sku, product, status, body,
                data["critical"] == "true", canClaim
            )
            runCatching { ContextCompat.startForegroundService(this, overlay) }
                .onFailure { app.diagnostics.error("overlay_start_failed", it, mapOf("event_id" to eventId)) }
        } else {
            app.diagnostics.warn("overlay_permission_missing", mapOf("event_id" to eventId))
        }
    }
}