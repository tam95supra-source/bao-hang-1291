package vn.pickpack1291.baohang.notifications

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import vn.pickpack1291.baohang.R
import vn.pickpack1291.baohang.data.IssueStatus
import vn.pickpack1291.baohang.ui.MainActivity

object NotificationHelper {
    const val ALERT_CHANNEL = "stock_alerts"
    const val SERVICE_CHANNEL = "overlay_service"
    const val OVERLAY_NOTIFICATION_ID = 1291001

    fun createChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(ALERT_CHANNEL, "Cảnh báo hàng 1291", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Hết hàng, đang tìm, đã có hàng và được skip"
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 350, 180, 350)
                setShowBadge(true)
            }
        )
        manager.createNotificationChannel(
            NotificationChannel(SERVICE_CHANNEL, "Hiển thị cảnh báo", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Duy trì bảng cảnh báo trên ứng dụng lấy hàng"
            }
        )
    }

    fun alert(context: Context, sku: String, statusValue: String, message: String, eventId: String) {
        val status = IssueStatus.from(statusValue)
        val pending = PendingIntent.getActivity(
            context, eventId.hashCode(), Intent(context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notification = NotificationCompat.Builder(context, ALERT_CHANNEL)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("${status.label} • SKU $sku")
            .setContentText(message)
            .setStyle(NotificationCompat.BigTextStyle().bigText(message))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setAutoCancel(!status.criticalForPicker)
            .setOngoing(status.criticalForPicker)
            .setContentIntent(pending)
            .build()
        runCatching { NotificationManagerCompat.from(context).notify(eventId.hashCode(), notification) }
    }

    fun foregroundService(context: Context) = NotificationCompat.Builder(context, SERVICE_CHANNEL)
        .setSmallIcon(R.mipmap.ic_launcher)
        .setContentTitle("Báo hàng 1291")
        .setContentText("Đang hiển thị cảnh báo cần xác nhận")
        .setOngoing(true)
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .build()
}
