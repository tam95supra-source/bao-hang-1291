package vn.pickpack1291.baohang.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import vn.pickpack1291.baohang.BaoHangApplication
import vn.pickpack1291.baohang.R

class SplashActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_splash)
        lifecycleScope.launch {
            val app = application as BaoHangApplication
            val destination = when {
                !app.session.isLoggedIn -> LoginActivity::class.java
                !hasRequiredPermissions() -> DeviceSetupActivity::class.java
                else -> MainActivity::class.java
            }
            startActivity(Intent(this@SplashActivity, destination))
            finish()
        }
    }

    private fun hasRequiredPermissions(): Boolean {
        val notificationOk = Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(
            this, Manifest.permission.POST_NOTIFICATIONS
        ) == PackageManager.PERMISSION_GRANTED
        return notificationOk && Settings.canDrawOverlays(this)
    }
}
