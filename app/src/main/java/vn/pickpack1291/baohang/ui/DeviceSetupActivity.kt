package vn.pickpack1291.baohang.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import vn.pickpack1291.baohang.R
import vn.pickpack1291.baohang.notifications.OverlayAlertService

class DeviceSetupActivity : AppCompatActivity() {
    private lateinit var notificationStatus: TextView
    private lateinit var overlayStatus: TextView

    private val notificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { updateStatus() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_device_setup)
        notificationStatus = findViewById(R.id.tvNotificationPermission)
        overlayStatus = findViewById(R.id.tvOverlayPermission)
        findViewById<Button>(R.id.btnNotificationPermission).setOnClickListener {
            if (Build.VERSION.SDK_INT >= 33) notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            else Toast.makeText(this, "Android đã cho phép thông báo", Toast.LENGTH_SHORT).show()
        }
        findViewById<Button>(R.id.btnOverlayPermission).setOnClickListener {
            startActivity(
                Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:$packageName")
                )
            )
        }
        findViewById<Button>(R.id.btnTestOverlay).setOnClickListener {
            if (!Settings.canDrawOverlays(this)) {
                Toast.makeText(this, "Cần cấp quyền overlay trước", Toast.LENGTH_LONG).show()
                return@setOnClickListener
            }
            ContextCompat.startForegroundService(
                this,
                OverlayAlertService.intent(
                    this, "test-overlay", "", "12910001", "Sản phẩm kiểm tra hiển thị",
                    "AVAILABLE", "Đây là cảnh báo thử. Bấm ĐÃ HIỂU để đóng.", true, false
                )
            )
        }
        findViewById<Button>(R.id.btnFinishSetup).setOnClickListener {
            if (!hasRequiredPermissions()) {
                Toast.makeText(this, "Cần cấp đủ quyền để không bỏ lỡ cảnh báo", Toast.LENGTH_LONG).show()
                return@setOnClickListener
            }
            startActivity(Intent(this, MainActivity::class.java))
            finish()
        }
    }

    override fun onResume() {
        super.onResume()
        updateStatus()
    }

    private fun hasNotificationPermission() = Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(
        this, Manifest.permission.POST_NOTIFICATIONS
    ) == PackageManager.PERMISSION_GRANTED

    private fun hasRequiredPermissions() = hasNotificationPermission() && Settings.canDrawOverlays(this)

    private fun updateStatus() {
        notificationStatus.text = if (hasNotificationPermission()) "✓ Thông báo: đã cho phép" else "✕ Thông báo: chưa cho phép"
        overlayStatus.text = if (Settings.canDrawOverlays(this)) {
            "✓ Hiển thị trên ứng dụng khác: đã cho phép"
        } else "✕ Hiển thị trên ứng dụng khác: chưa cho phép"
    }
}
