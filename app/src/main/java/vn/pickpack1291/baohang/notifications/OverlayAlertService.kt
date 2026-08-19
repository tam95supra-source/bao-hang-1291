package vn.pickpack1291.baohang.notifications

import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.provider.Settings
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.TextView
import android.widget.Toast
import androidx.core.app.NotificationManagerCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import vn.pickpack1291.baohang.BaoHangApplication
import vn.pickpack1291.baohang.R
import vn.pickpack1291.baohang.data.IssueStatus

class OverlayAlertService : Service() {
    private lateinit var windowManager: WindowManager
    private var overlay: View? = null
    private var currentCritical = false
    private val pending = ArrayDeque<Intent>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    override fun onCreate() {
        super.onCreate()
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NotificationHelper.OVERLAY_NOTIFICATION_ID, NotificationHelper.foregroundService(this))
        if (!Settings.canDrawOverlays(this)) {
            stopSelf()
            return START_NOT_STICKY
        }
        val alertIntent = intent ?: return START_NOT_STICKY
        if (overlay != null && currentCritical) pending.addLast(alertIntent) else show(alertIntent)
        return START_NOT_STICKY
    }

    private fun show(intent: Intent) {
        overlay?.let { runCatching { windowManager.removeView(it) } }
        val eventId = intent.getStringExtra(EXTRA_EVENT_ID).orEmpty()
        val issueId = intent.getStringExtra(EXTRA_ISSUE_ID).orEmpty()
        val sku = intent.getStringExtra(EXTRA_SKU).orEmpty()
        val product = intent.getStringExtra(EXTRA_PRODUCT).orEmpty()
        val status = IssueStatus.from(intent.getStringExtra(EXTRA_STATUS))
        if (status !in setOf(IssueStatus.AVAILABLE, IssueStatus.SKIP_ALLOWED)) { dismiss(); return }
        val message = intent.getStringExtra(EXTRA_MESSAGE).orEmpty()
        val critical = true
        val canClaim = false
        currentCritical = critical
        val view = LayoutInflater.from(this).inflate(R.layout.overlay_alert, null)
        view.setBackgroundResource(if (status == IssueStatus.AVAILABLE) R.drawable.bg_overlay_available else R.drawable.bg_overlay_skip)
        view.findViewById<TextView>(R.id.tvOverlayStatus).text = if (status == IssueStatus.AVAILABLE) "ĐÃ CÓ HÀNG • QUAY LẠI LẤY HÀNG" else "CHO PHÉP SKIP • TIẾP TỤC CÔNG VIỆC"
        view.findViewById<TextView>(R.id.tvOverlaySku).text = "SKU $sku"
        view.findViewById<TextView>(R.id.tvOverlayProduct).text = product
        view.findViewById<TextView>(R.id.tvOverlayMessage).text = message
        val ack = view.findViewById<Button>(R.id.btnOverlayAck)
        val hint = view.findViewById<TextView>(R.id.tvOverlayDismissHint)
        ack.visibility = View.VISIBLE
        hint.visibility = View.VISIBLE
        if (critical) {
            ack.text = "ĐÃ XÁC NHẬN"
            ack.setOnClickListener {
                if (!eventId.startsWith("test-")) {
                    scope.launch { (application as BaoHangApplication).repository.acknowledgeAlert(eventId) }
                }
                NotificationManagerCompat.from(this).cancel(eventId.hashCode())
                dismiss()
            }
        } else if (canClaim) {
            ack.text = "NHẬN XỬ LÝ"
            ack.setOnClickListener {
                ack.isEnabled = false
                ack.text = "ĐANG NHẬN…"
                scope.launch {
                    runCatching {
                        (application as BaoHangApplication).repository.updateIssue(issueId, "CLAIM")
                    }.onSuccess {
                        Toast.makeText(this@OverlayAlertService, "Bạn đã nhận xử lý SKU $sku", Toast.LENGTH_LONG).show()
                        dismiss()
                    }.onFailure {
                        Toast.makeText(this@OverlayAlertService, it.message ?: "Không nhận được ticket", Toast.LENGTH_LONG).show()
                        ack.isEnabled = true
                        ack.text = "NHẬN XỬ LÝ"
                    }
                }
            }
            view.setOnClickListener { dismiss() }
        } else {
            view.setOnClickListener { dismiss() }
        }
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            } else WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED,
            PixelFormat.TRANSLUCENT
        ).apply { gravity = Gravity.CENTER }
        overlay = view
        windowManager.addView(view, params)
        val power = getSystemService(POWER_SERVICE) as PowerManager
        power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "BaoHang1291:alert").apply {
            acquire(10_000L)
        }
    }

    private fun dismiss() {
        overlay?.let { runCatching { windowManager.removeView(it) } }
        overlay = null
        currentCritical = false
        if (pending.isNotEmpty()) {
            show(pending.removeFirst())
            return
        }
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        overlay?.let { runCatching { windowManager.removeView(it) } }
        overlay = null
        pending.clear()
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val EXTRA_EVENT_ID = "event_id"
        private const val EXTRA_ISSUE_ID = "issue_id"
        private const val EXTRA_SKU = "sku"
        private const val EXTRA_PRODUCT = "product"
        private const val EXTRA_STATUS = "status"
        private const val EXTRA_MESSAGE = "message"
        private const val EXTRA_CRITICAL = "critical"
        private const val EXTRA_CAN_CLAIM = "can_claim"

        fun intent(
            context: Context,
            eventId: String,
            issueId: String,
            sku: String,
            product: String,
            status: String,
            message: String,
            critical: Boolean,
            canClaim: Boolean
        ) = Intent(context, OverlayAlertService::class.java)
            .putExtra(EXTRA_EVENT_ID, eventId).putExtra(EXTRA_ISSUE_ID, issueId)
            .putExtra(EXTRA_SKU, sku)
            .putExtra(EXTRA_PRODUCT, product).putExtra(EXTRA_STATUS, status)
            .putExtra(EXTRA_MESSAGE, message).putExtra(EXTRA_CRITICAL, critical)
            .putExtra(EXTRA_CAN_CLAIM, canClaim)
    }
}
