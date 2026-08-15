package vn.pickpack1291.baohang.notifications

import android.provider.Settings
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
import vn.pickpack1291.baohang.BaoHangApplication
import vn.pickpack1291.baohang.data.IssueStatus
import vn.pickpack1291.baohang.data.UserRole
import vn.pickpack1291.baohang.network.DirectRpcClient
import java.time.Instant

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
        val eventId = data["notification_event_id"].orEmpty()
            .ifBlank { data["event_id"].orEmpty() }
            .ifBlank { message.messageId.orEmpty() }
        val issueId = data["issue_id"].orEmpty()
        val incomingVersion = data["issue_version"]?.toLongOrNull() ?: 0L
        val sku = data["sku"].orEmpty()
        val product = data["product_name"].orEmpty()
        val status = data["status"].orEmpty().uppercase()
        val targetUserId = data["target_user_id"].orEmpty()
        val expiry = data["expiry"].orEmpty()
        val isHandlerOpenAlert = status == "OPEN"
        val handlerRoles = setOf(UserRole.INVENT, UserRole.ADMIN_INVENT, UserRole.ADMIN)

        if (!app.session.isLoggedIn || issueId.isBlank() || incomingVersion < 1 || status !in setOf("OPEN", "AVAILABLE", "SKIP_ALLOWED")) {
            app.diagnostics.info("stock_notification_suppressed", mapOf("status" to status, "reason" to "invalid_or_no_session"))
            return
        }
        if (isHandlerOpenAlert && app.session.effectiveRole !in handlerRoles) {
            app.diagnostics.info("handler_notification_suppressed", mapOf("status" to status, "reason" to "role_not_handler"))
            return
        }
        if (targetUserId.isNotBlank() && targetUserId != app.session.profile?.id) {
            app.diagnostics.warn("stock_notification_wrong_target", mapOf("event_id" to eventId, "issue_id" to issueId))
            return
        }
        if (expiry.isNotBlank() && runCatching { Instant.parse(expiry).isBefore(Instant.now()) }.getOrDefault(true)) {
            app.diagnostics.info("stock_notification_expired", mapOf("event_id" to eventId, "issue_id" to issueId))
            return
        }

        // FCM is a delivery hint only. Verify exact authority state/version before showing.
        val current = runBlocking(Dispatchers.IO) {
            withTimeoutOrNull(7_000L) {
                runCatching { DirectRpcClient(app.session).issueDetail(issueId) }.getOrNull()
            }
        }
        if (current == null || current.issueVersion != incomingVersion || current.status != IssueStatus.from(status)) {
            app.diagnostics.info(
                "fcm_state_not_current",
                mapOf(
                    "event_id" to eventId,
                    "issue_id" to issueId,
                    "incoming_version" to incomingVersion,
                    "current_version" to (current?.issueVersion ?: 0L),
                    "incoming_status" to status,
                    "current_status" to (current?.status?.wire ?: "UNVERIFIED")
                )
            )
            return
        }
        app.database.upsertIssues(listOf(current))

        val body = data["message"].orEmpty().ifBlank { message.notification?.body.orEmpty() }
        app.diagnostics.info(
            "fcm_received_verified",
            mapOf("event_id" to eventId, "issue_id" to issueId, "issue_version" to incomingVersion, "sku" to sku, "status" to status)
        )
        if (eventId.isNotBlank()) {
            scope.launch {
                runCatching { app.repository.markAlertReceived(eventId) }
                    .onFailure { app.diagnostics.warn("fcm_received_metric_deferred", mapOf("event_id" to eventId)) }
            }
        }

        if (app.isAppForeground && Settings.canDrawOverlays(this)) {
            val overlay = OverlayAlertService.intent(
                this, eventId, issueId, sku, product, status, body,
                critical = !isHandlerOpenAlert,
                canClaim = isHandlerOpenAlert
            )
            runCatching { ContextCompat.startForegroundService(this, overlay) }
                .onFailure {
                    app.diagnostics.error("overlay_start_failed", it, mapOf("event_id" to eventId))
                    NotificationHelper.alert(this, sku, status, body, eventId)
                    if (isHandlerOpenAlert && eventId.isNotBlank()) {
                        scope.launch { runCatching { app.repository.markAlertDisplayed(eventId) } }
                    }
                }
        } else {
            NotificationHelper.alert(this, sku, status, body, eventId)
            if (isHandlerOpenAlert && eventId.isNotBlank()) {
                scope.launch { runCatching { app.repository.markAlertDisplayed(eventId) } }
            }
        }
    }
}
