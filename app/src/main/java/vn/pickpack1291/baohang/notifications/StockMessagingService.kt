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
import vn.pickpack1291.baohang.realtime.RealtimeInvalidationStore
import vn.pickpack1291.baohang.realtime.RealtimeSignalBus

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

        if (data["event_type"] == "REALTIME_DELTA") {
            val topic = data["topic"].orEmpty()
            val published = RealtimeSignalBus.publish(
                topic,
                entityId = data["entity_id"].orEmpty(),
                entityVersion = data["entity_version"]?.toLongOrNull() ?: 0L,
                seq = data["realtime_event_id"]?.toLongOrNull() ?: 0L
            )
            if (!published) RealtimeInvalidationStore.markPending(this, topic)
            app.diagnostics.info(
                "fcm_realtime_delta",
                mapOf(
                    "topic" to topic,
                    "event_id" to data["realtime_event_id"].orEmpty(),
                    "published_to_foreground" to published,
                    "persisted_for_resume" to !published
                )
            )
            return
        }

        val eventId = data["event_id"].orEmpty().ifBlank { message.messageId.orEmpty() }
        val issueId = data["issue_id"].orEmpty()
        val incomingVersion = data["issue_version"]?.toLongOrNull() ?: 1L
        val sku = data["sku"].orEmpty()
        val product = data["product_name"].orEmpty()
        val status = data["status"].orEmpty()
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

        // AVAILABLE / SKIP_ALLOWED is the canonical Invent confirmation sent to
        // Picker devices. Forward it to the in-process realtime bus so an open
        // Picker screen patches the exact card instead of waiting for a reload.
        val publishedToForeground = RealtimeSignalBus.publish(
            "issues",
            entityId = issueId,
            entityVersion = incomingVersion,
            seq = 0L
        )
        if (!publishedToForeground) RealtimeInvalidationStore.markPending(this, "issues")
        app.diagnostics.info(
            "picker_status_realtime_signal",
            mapOf(
                "issue_id" to issueId,
                "issue_version" to incomingVersion,
                "status" to status,
                "published_to_foreground" to publishedToForeground,
                "persisted_for_resume" to !publishedToForeground
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
            val canClaim = false
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
