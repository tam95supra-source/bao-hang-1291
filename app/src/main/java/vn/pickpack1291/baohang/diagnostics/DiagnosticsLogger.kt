package vn.pickpack1291.baohang.diagnostics

import android.content.Context
import android.os.Build
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.security.MessageDigest
import java.time.Instant
import java.util.zip.GZIPOutputStream

class DiagnosticsLogger(context: Context) {
    data class UploadBundle(
        val gzipBytes: ByteArray,
        val sha256: String,
        val createdAt: String,
        val deviceName: String
    )

    private val dir = File(context.filesDir, "diagnostics").apply { mkdirs() }
    private val current = File(dir, "current.log")
    private val previous = File(dir, "previous.log")
    private val older = File(dir, "older.log")
    private val lock = Any()

    fun info(event: String, fields: Map<String, Any?> = emptyMap()) = write("INFO", event, fields)
    fun warn(event: String, fields: Map<String, Any?> = emptyMap()) = write("WARN", event, fields)
    fun error(event: String, throwable: Throwable? = null, fields: Map<String, Any?> = emptyMap()) {
        val merged = fields.toMutableMap()
        throwable?.let {
            merged["error_type"] = it.javaClass.simpleName
            merged["error"] = it.message.orEmpty().take(800)
        }
        write("ERROR", event, merged)
    }

    private fun write(level: String, event: String, fields: Map<String, Any?>) {
        runCatching {
            synchronized(lock) {
                rotateIfNeeded()
                val json = JSONObject()
                    .put("ts", Instant.now().toString())
                    .put("level", level)
                    .put("event", sanitize(event))
                fields.forEach { (key, value) ->
                    json.put(sanitize(key).take(80), sanitize(String(value ?: "")).take(1200))
                }
                current.appendText(json.toString() + "\n", Charsets.UTF_8)
            }
        }
    }

    private fun rotateIfNeeded() {
        if (!current.exists() || current.length() < MAX_FILE_BYTES) return
        older.delete()
        if (previous.exists()) previous.renameTo(older)
        current.renameTo(previous)
    }

    fun prepareUpload(): UploadBundle? = synchronized(lock) {
        val files = listOf(older, previous, current).filter { it.isFile && it.length() > 0 }
        if (files.isEmpty()) return@synchronized null
        val createdAt = Instant.now().toString()
        val output = ByteArrayOutputStream()
        GZIPOutputStream(output).bufferedWriter(Charsets.UTF_8).use { writer ->
            files.forEach { file -> file.forEachLine(Charsets.UTF_8) { line -> writer.appendLine(sanitize(line)) } }
        }
        val bytes = output.toByteArray()
        if (bytes.size > MAX_UPLOAD_BYTES) {
            warn("diagnostic_bundle_too_large", mapOf("gzip_bytes" to bytes.size))
            return@synchronized null
        }
        UploadBundle(
            gzipBytes = bytes,
            sha256 = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) },
            createdAt = createdAt,
            deviceName = "${Build.MANUFACTURER} ${Build.MODEL}".trim()
        )
    }

    fun clearAfterConfirmedUpload() = synchronized(lock) {
        listOf(current, previous, older).forEach { it.delete() }
    }

    private fun sanitize(raw: String): String {
        var value = raw
        val patterns = listOf(
            Regex("(?i)(authorization\\s*[:=]\\s*)(bearer\\s+)?[^\\s,;]+"),
            Regex("(?i)(password|passwd|refresh_token|access_token|service_role|private_key|apikey)\\s*[:=]\\s*[^\\s,;]+"),
            Regex("-----BEGIN(?: RSA)? PRIVATE KEY-----[\\s\\S]*?-----END(?: RSA)? PRIVATE KEY-----")
        )
        patterns.forEach { pattern -> value = pattern.replace(value, "[REDACTED]") }
        return value
    }

    companion object {
        private const val MAX_FILE_BYTES = 512 * 1024L
        private const val MAX_UPLOAD_BYTES = 2 * 1024 * 1024
    }
}
