package vn.pickpack1291.baohang.update

import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import vn.pickpack1291.baohang.BuildConfig
import vn.pickpack1291.baohang.diagnostics.DiagnosticsLogger
import java.io.File
import java.net.URI
import java.security.MessageDigest

class AppUpdater(
    private val activity: AppCompatActivity,
    private val diagnostics: DiagnosticsLogger
) {
    data class Release(
        val channel: String,
        val versionCode: Int,
        val versionName: String,
        val apkUrl: String,
        val sha256: String,
        val mandatory: Boolean,
        val notes: String
    )

    fun check(showUpToDate: Boolean = false) {
        val installedChannel = BuildConfig.OTA_CHANNEL.trim().lowercase()
        if (BuildConfig.UPDATE_MANIFEST_URL.isBlank() || installedChannel !in setOf("stable", "beta")) {
            if (showUpToDate) Toast.makeText(activity, "Bản này không dùng OTA production", Toast.LENGTH_LONG).show()
            return
        }
        diagnostics.info("ota_check_start", mapOf("channel" to installedChannel, "version" to BuildConfig.VERSION_NAME, "version_code" to BuildConfig.VERSION_CODE))
        activity.lifecycleScope.launch {
            val release = runCatching { withContext(Dispatchers.IO) { fetchManifest() } }.getOrElse { error ->
                diagnostics.warn("ota_check_failed", mapOf("channel" to installedChannel, "error" to error.message.orEmpty()))
                if (showUpToDate) Toast.makeText(activity, "Không kiểm tra được cập nhật: ${error.message}", Toast.LENGTH_LONG).show()
                return@launch
            }
            if (release.channel != installedChannel) {
                diagnostics.error("ota_channel_manifest_mismatch", fields = mapOf("installed_channel" to installedChannel, "manifest_channel" to release.channel))
                if (showUpToDate) Toast.makeText(activity, "Kênh cập nhật không khớp; đã hủy", Toast.LENGTH_LONG).show()
                return@launch
            }
            if (release.versionCode <= BuildConfig.VERSION_CODE) {
                diagnostics.info("ota_up_to_date", mapOf("channel" to installedChannel, "manifest_code" to release.versionCode))
                if (showUpToDate) Toast.makeText(activity, "Đang là bản ${BuildConfig.VERSION_NAME} mới nhất của kênh ${installedChannel.uppercase()}", Toast.LENGTH_LONG).show()
                return@launch
            }
            diagnostics.info("ota_update_available", mapOf("channel" to installedChannel, "version" to release.versionName, "version_code" to release.versionCode))
            AlertDialog.Builder(activity)
                .setTitle("Có bản ${release.versionName} • ${installedChannel.uppercase()}")
                .setMessage(release.notes.ifBlank { "Bản mới của Báo hàng 1291 đã sẵn sàng." })
                .setCancelable(!release.mandatory)
                .apply { if (!release.mandatory) setNegativeButton("ĐỂ SAU", null) }
                .setPositiveButton("CẬP NHẬT") { _, _ -> downloadAndInstall(release) }
                .show()
        }
    }

    private fun downloadAndInstall(release: Release) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.packageManager.canRequestPackageInstalls()) {
            diagnostics.warn("ota_install_permission_required", mapOf("channel" to release.channel))
            activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
            Toast.makeText(activity, "Cho phép cài bản cập nhật rồi bấm CẬP NHẬT lại", Toast.LENGTH_LONG).show()
            return
        }
        Toast.makeText(activity, "Đang tải bản ${release.versionName} • ${release.channel.uppercase()}…", Toast.LENGTH_LONG).show()
        diagnostics.info("ota_download_start", mapOf("channel" to release.channel, "version" to release.versionName, "version_code" to release.versionCode))
        activity.lifecycleScope.launch {
            runCatching { withContext(Dispatchers.IO) { download(release) } }
                .onSuccess { file ->
                    diagnostics.info("ota_download_verified", mapOf("channel" to release.channel, "version" to release.versionName, "sha256" to release.sha256))
                    install(file, release)
                }
                .onFailure { error ->
                    diagnostics.error("ota_download_failed", error, mapOf("channel" to release.channel, "version" to release.versionName))
                    Toast.makeText(activity, "Cập nhật lỗi: ${error.message}", Toast.LENGTH_LONG).show()
                }
        }
    }

    private fun fetchManifest(): Release {
        val connection = URI(BuildConfig.UPDATE_MANIFEST_URL).toURL().openConnection().apply {
            connectTimeout = 10_000
            readTimeout = 15_000
            useCaches = false
            setRequestProperty("Cache-Control", "no-cache")
        }
        val json = JSONObject(connection.getInputStream().bufferedReader().use { it.readText() })
        val channel = json.getString("channel").trim().lowercase()
        require(channel in setOf("stable", "beta")) { "Manifest OTA thiếu channel hợp lệ" }
        return Release(
            channel = channel,
            versionCode = json.getInt("versionCode"),
            versionName = json.getString("versionName"),
            apkUrl = json.getString("apkUrl"),
            sha256 = json.getString("sha256").lowercase(),
            mandatory = json.optBoolean("mandatory", false),
            notes = json.optString("releaseNotes")
        )
    }

    private fun download(release: Release): File {
        val target = File(activity.cacheDir, "bao-hang-1291-${release.channel}-${release.versionName}.apk")
        val connection = URI(release.apkUrl).toURL().openConnection().apply {
            connectTimeout = 15_000
            readTimeout = 60_000
            useCaches = false
        }
        connection.getInputStream().use { input -> target.outputStream().use(input::copyTo) }
        val digest = sha256(target.readBytes())
        if (!digest.equals(release.sha256, true)) {
            target.delete()
            error("Sai mã kiểm tra SHA-256; đã hủy file")
        }
        runCatching { verifyPackageIdentity(target, release) }.onFailure { target.delete() }.getOrThrow()
        return target
    }

    private fun verifyPackageIdentity(file: File, release: Release) {
        val packageInfo = activity.packageManager.getPackageArchiveInfo(
            file.absolutePath,
            PackageManager.GET_SIGNING_CERTIFICATES or PackageManager.GET_META_DATA
        ) ?: error("Không đọc được gói APK cập nhật")
        if (packageInfo.packageName != activity.packageName) error("Gói cập nhật không đúng ứng dụng Báo hàng 1291")
        if (packageInfo.longVersionCode != release.versionCode.toLong()) error("Version code của APK không khớp manifest OTA")
        val installedChannel = BuildConfig.OTA_CHANNEL.trim().lowercase()
        val apkChannel = packageInfo.applicationInfo?.metaData?.getString(OTA_CHANNEL_META)?.trim()?.lowercase().orEmpty()
        if (release.channel != installedChannel || apkChannel != installedChannel) {
            error("APK thuộc kênh ${apkChannel.ifBlank { "không xác định" }}, không phải ${installedChannel.uppercase()}; đã hủy cập nhật")
        }
        val expectedSigner = BuildConfig.PRODUCTION_SIGNER_SHA256.trim().lowercase()
        if (!expectedSigner.matches(Regex("^[0-9a-f]{64}$"))) error("Thiếu fingerprint production để xác thực OTA")
        val signingInfo = packageInfo.signingInfo ?: error("APK không có thông tin chữ ký")
        val signatures = if (signingInfo.hasMultipleSigners()) signingInfo.apkContentsSigners else signingInfo.signingCertificateHistory
        if (signatures.none { signature -> sha256(signature.toByteArray()).equals(expectedSigner, true) }) {
            error("Chữ ký APK không khớp production; đã hủy cập nhật")
        }
    }

    private fun sha256(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    private fun install(file: File, release: Release) {
        diagnostics.info("ota_install_intent", mapOf("channel" to release.channel, "version" to release.versionName, "version_code" to release.versionCode))
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", file)
        activity.startActivity(
            Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }

    companion object {
        private const val OTA_CHANNEL_META = "vn.pickpack1291.baohang.OTA_CHANNEL"
    }
}
