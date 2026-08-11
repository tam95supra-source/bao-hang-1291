package vn.pickpack1291.baohang.update

import android.app.AlertDialog
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.widget.Toast
import androidx.core.content.FileProvider
import androidx.lifecycle.lifecycleScope
import androidx.appcompat.app.AppCompatActivity
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import vn.pickpack1291.baohang.BuildConfig
import java.io.File
import java.net.URI
import java.security.MessageDigest

class AppUpdater(private val activity: AppCompatActivity) {
    data class Release(
        val versionCode: Int,
        val versionName: String,
        val apkUrl: String,
        val sha256: String,
        val mandatory: Boolean,
        val notes: String
    )

    fun check() {
        if (BuildConfig.UPDATE_MANIFEST_URL.isBlank()) return
        activity.lifecycleScope.launch {
            val release = runCatching { withContext(Dispatchers.IO) { fetchManifest() } }.getOrNull() ?: return@launch
            if (release.versionCode <= BuildConfig.VERSION_CODE) return@launch
            AlertDialog.Builder(activity)
                .setTitle("Có bản ${release.versionName}")
                .setMessage(release.notes.ifBlank { "Bản mới của Báo hàng 1291 đã sẵn sàng." })
                .setCancelable(!release.mandatory)
                .apply { if (!release.mandatory) setNegativeButton("ĐỂ SAU", null) }
                .setPositiveButton("CẬP NHẬT") { _, _ -> downloadAndInstall(release) }
                .show()
        }
    }

    private fun downloadAndInstall(release: Release) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.packageManager.canRequestPackageInstalls()) {
            activity.startActivity(
                Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}"))
            )
            Toast.makeText(activity, "Cho phép cài bản cập nhật rồi bấm CẬP NHẬT lại", Toast.LENGTH_LONG).show()
            return
        }
        Toast.makeText(activity, "Đang tải bản ${release.versionName}…", Toast.LENGTH_LONG).show()
        activity.lifecycleScope.launch {
            runCatching { withContext(Dispatchers.IO) { download(release) } }
                .onSuccess(::install)
                .onFailure { Toast.makeText(activity, "Cập nhật lỗi: ${it.message}", Toast.LENGTH_LONG).show() }
        }
    }

    private fun fetchManifest(): Release {
        val connection = URI(BuildConfig.UPDATE_MANIFEST_URL).toURL().openConnection().apply {
            connectTimeout = 10_000; readTimeout = 15_000
        }
        val content = connection.getInputStream().bufferedReader().use { it.readText() }
        val json = JSONObject(content)
        return Release(
            json.getInt("versionCode"), json.getString("versionName"), json.getString("apkUrl"),
            json.getString("sha256").lowercase(), json.optBoolean("mandatory", false),
            json.optString("releaseNotes")
        )
    }

    private fun download(release: Release): File {
        val target = File(activity.cacheDir, "bao-hang-1291-${release.versionName}.apk")
        val connection = URI(release.apkUrl).toURL().openConnection().apply {
            connectTimeout = 15_000; readTimeout = 60_000
        }
        connection.getInputStream().use { input -> target.outputStream().use(input::copyTo) }
        val digest = MessageDigest.getInstance("SHA-256").digest(target.readBytes())
            .joinToString("") { "%02x".format(it) }
        if (!digest.equals(release.sha256, true)) {
            target.delete()
            error("Sai chữ ký SHA-256; đã hủy file")
        }
        return target
    }

    private fun install(file: File) {
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", file)
        activity.startActivity(
            Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }
}
