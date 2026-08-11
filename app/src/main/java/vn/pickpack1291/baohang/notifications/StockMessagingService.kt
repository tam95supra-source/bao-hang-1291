package vn.pickpack1291.baohang.notifications

import android.content.Intent
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
        if (app.session.isLoggedIn) app.repository.registerDeviceAsync(token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        val data = message.data
        val eventId = data["event_id"].orEmpty().ifBlank { message.messageId.orEmpty() }
        val sku = data["sku"].orEmpty()
        val product = data["product_name"].orEmpty()
        val status = data["status"].orEmpty()
        val body = data["message"].orEmpty().ifBlank { message.notification?.body.orEmpty() }
        NotificationHelper.alert(this, sku, status, body, eventId)
        if (Settings.canDrawOverlays(this)) {
            val app = application as BaoHangApplication
            val canClaim = status == "OPEN" && app.session.profile?.role != UserRole.PICKER
            val overlay = OverlayAlertService.intent(
                this, eventId, data["issue_id"].orEmpty(), sku, product, status, body,
                data["critical"] == "true", canClaim
            )
            runCatching { ContextCompat.startForegroundService(this, overlay) }
        }
    }
}
