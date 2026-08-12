package vn.pickpack1291.baohang.notifications

import android.provider.Settings
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import vn.pickpack1291.baohang.BaoHangApplication
import vn.pickpack1291.baohang.data.UserRole

class StockMessagingService : FirebaseMessagingService() {
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
        val sku = data["sku"].orEmpty()
        val product = data["product_name"].orEmpty()
        val status = data["status"].orEmpty()
        val body = data["message"].orEmpty().ifBlank { message.notification?.body.orEmpty() }
        app.diagnostics.info("fcm_received", mapOf("event_id" to eventId, "sku" to sku, "status" to status, "critical" to data["critical"].orEmpty()))
        NotificationHelper.alert(this, sku, status, body, eventId)
        if (Settings.canDrawOverlays(this)) {
            val canClaim = status == "OPEN" && app.session.effectiveRole in setOf(UserRole.ADMIN, UserRole.ADMIN_INVENT, UserRole.INVENT)
            val overlay = OverlayAlertService.intent(
                this, eventId, data["issue_id"].orEmpty(), sku, product, status, body,
                data["critical"] == "true", canClaim
            )
            runCatching { ContextCompat.startForegroundService(this, overlay) }
                .onFailure { app.diagnostics.error("overlay_start_failed", it, mapOf("event_id" to eventId)) }
        } else {
            app.diagnostics.warn("overlay_permission_missing", mapOf("event_id" to eventId))
        }
    }
}
