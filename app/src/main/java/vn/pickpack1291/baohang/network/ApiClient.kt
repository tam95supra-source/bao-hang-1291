package vn.pickpack1291.baohang.network

import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import vn.pickpack1291.baohang.BuildConfig
import vn.pickpack1291.baohang.data.AppConfig
import vn.pickpack1291.baohang.data.AuthSession
import vn.pickpack1291.baohang.data.ImportUserRow
import vn.pickpack1291.baohang.data.InventoryStatus
import vn.pickpack1291.baohang.data.IssueBoard
import vn.pickpack1291.baohang.data.OperationalConfig
import vn.pickpack1291.baohang.data.PendingAlert
import vn.pickpack1291.baohang.data.ReportResult
import vn.pickpack1291.baohang.data.SessionStore
import vn.pickpack1291.baohang.data.SkuItem
import vn.pickpack1291.baohang.data.StockIssue
import vn.pickpack1291.baohang.data.UserProfile
import vn.pickpack1291.baohang.data.UserRole
import vn.pickpack1291.baohang.diagnostics.DiagnosticsLogger
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URI
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

class ApiClient(
    private val sessionStore: SessionStore,
    private val diagnostics: DiagnosticsLogger
) {
    private val baseUrl = BuildConfig.SUPABASE_URL.trimEnd('/')
    private val anonKey = BuildConfig.SUPABASE_ANON_KEY

    val isConfigured: Boolean
        get() = baseUrl.startsWith("https://") && anonKey.length > 30 &&
            !baseUrl.contains("your-project") && !anonKey.contains("replace")

    suspend fun signIn(employeeCode: String, password: String): AuthSession = withContext(Dispatchers.IO) {
        requireConfigured()
        diagnostics.info("auth_login_start", mapOf("employee_code" to employeeCode.trim()))
        val body = JSONObject().put("email", employeeEmail(employeeCode)).put("password", password)
        val auth = request("POST", "$baseUrl/auth/v1/token?grant_type=password", body, authenticated = false, eventName = "auth_login")
        val access = auth.getString("access_token")
        val refresh = auth.getString("refresh_token")
        val expiresAt = System.currentTimeMillis() / 1000L + auth.optLong("expires_in", 3600)
        val authUserId = auth.getJSONObject("user").getString("id")
        val profile = fetchProfile(access, authUserId)
        if (!profile.active) throw ApiException(403, "Tài khoản đã ngừng hoạt động")
        diagnostics.info("auth_login_success", mapOf("employee_code" to profile.employeeCode, "role" to profile.role.wire))
        AuthSession(access, refresh, expiresAt, profile)
    }

    suspend fun refreshSessionIfNeeded() = withContext(Dispatchers.IO) {
        if (sessionStore.expiresAt > System.currentTimeMillis() / 1000L + 120) return@withContext
        val refreshToken = sessionStore.refreshToken
        if (refreshToken.isBlank()) return@withContext
        val result = request(
            "POST", "$baseUrl/auth/v1/token?grant_type=refresh_token",
            JSONObject().put("refresh_token", refreshToken), authenticated = false, eventName = "auth_refresh"
        )
        sessionStore.updateTokens(
            result.getString("access_token"),
            result.optString("refresh_token", refreshToken),
            System.currentTimeMillis() / 1000L + result.optLong("expires_in", 3600)
        )
    }

    suspend fun sessionProfile(): UserProfile = UserProfile.fromJson(invoke("session-profile", JSONObject()).getJSONObject("profile"))

    suspend fun searchSkus(query: String, limit: Int = 20): List<SkuItem> {
        val response = invoke("search-skus", JSONObject().put("query", query).put("limit", limit))
        val array = response.optJSONArray("items") ?: JSONArray()
        return buildList {
            for (i in 0 until array.length()) {
                val item = array.getJSONObject(i)
                add(SkuItem(item.getString("sku"), item.getString("product_name")))
            }
        }
    }

    suspend fun reportShortage(sku: String, clientRequestId: String): ReportResult {
        val json = invoke("report-shortage", JSONObject().put("sku", sku).put("client_request_id", clientRequestId))
        return ReportResult(
            StockIssue.fromJson(json.getJSONObject("issue")),
            json.optBoolean("already_reported", false),
            json.optString("message", "Đã ghi nhận báo thiếu")
        )
    }

    suspend fun activeIssues(): List<StockIssue> = invoke("active-issues", JSONObject()).optJSONArray("issues").toStockIssues()

    suspend fun issueBoard(): IssueBoard {
        val response = invoke("issue-board", JSONObject())
        return IssueBoard(
            open = response.optJSONArray("open").toStockIssues(),
            claimed = response.optJSONArray("claimed").toStockIssues(),
            recent = response.optJSONArray("recent").toStockIssues()
        )
    }

    suspend fun issueDetail(issueId: String): StockIssue = StockIssue.fromJson(
        invoke("issue-detail", JSONObject().put("issue_id", issueId)).getJSONObject("issue")
    )

    suspend fun myIssues(): List<StockIssue> = invoke("my-issues", JSONObject()).optJSONArray("issues").toStockIssues()

    suspend fun claimIssue(issueId: String): StockIssue = StockIssue.fromJson(
        invoke("claim-issue", JSONObject().put("issue_id", issueId)).getJSONObject("issue")
    )

    suspend fun reassignIssue(issueId: String, newAssigneeId: String, reason: String): StockIssue = StockIssue.fromJson(
        invoke(
            "reassign-issue",
            JSONObject().put("issue_id", issueId).put("new_assignee_id", newAssigneeId).put("reason", reason)
        ).getJSONObject("issue")
    )

    suspend fun updateIssue(issueId: String, action: String): StockIssue = StockIssue.fromJson(
        invoke("update-issue", JSONObject().put("issue_id", issueId).put("action", action)).getJSONObject("issue")
    )

    suspend fun pendingAlerts(): List<PendingAlert> {
        val array = invoke("pending-alerts", JSONObject()).optJSONArray("events") ?: JSONArray()
        return buildList { for (i in 0 until array.length()) add(PendingAlert.fromJson(array.getJSONObject(i))) }
    }

    suspend fun markAlertReceived(eventId: String) { invoke("mark-alert-received", JSONObject().put("event_id", eventId)) }
    suspend fun markAlertDisplayed(eventId: String) { invoke("mark-alert-displayed", JSONObject().put("event_id", eventId)) }
    suspend fun acknowledgeAlert(eventId: String) { invoke("ack-alert", JSONObject().put("event_id", eventId)) }

    suspend fun registerDevice(token: String, deviceName: String, appVersion: String) {
        invoke(
            "register-device",
            JSONObject().put("fcm_token", token).put("device_name", deviceName)
                .put("app_version", appVersion).put("platform", "android")
        )
    }

    data class CatalogPage(val items: List<SkuItem>, val hasMore: Boolean, val syncUntil: String)

    suspend fun catalogPage(afterSku: String?, updatedSince: String?, syncUntil: String?, limit: Int = 1000): CatalogPage {
        val payload = JSONObject().put("limit", limit)
        if (!afterSku.isNullOrBlank()) payload.put("after_sku", afterSku)
        if (!updatedSince.isNullOrBlank()) payload.put("updated_since", updatedSince)
        if (!syncUntil.isNullOrBlank()) payload.put("sync_until", syncUntil)
        val response = invoke("sync-catalog", payload)
        val array = response.optJSONArray("items") ?: JSONArray()
        val result = buildList {
            for (i in 0 until array.length()) {
                val item = array.getJSONObject(i)
                add(SkuItem(item.getString("sku"), item.getString("product_name")))
            }
        }
        return CatalogPage(result, response.optBoolean("has_more", result.size == limit), response.getString("sync_until"))
    }

    suspend fun inventoryStatus(sku: String): InventoryStatus = InventoryStatus.fromJson(
        invoke("inventory-status", JSONObject().put("sku", sku))
    )

    suspend fun getOperationalConfig(): OperationalConfig = OperationalConfig.fromJson(invoke("get-operational-config", JSONObject()))
    suspend fun saveOperationalConfig(config: OperationalConfig): OperationalConfig = OperationalConfig.fromJson(
        invoke("save-operational-config", config.toJson())
    )
    suspend fun getConfig(): AppConfig = AppConfig.fromJson(invoke("get-config", JSONObject()))
    suspend fun saveConfig(config: AppConfig): AppConfig = AppConfig.fromJson(invoke("save-config", config.toJson()))

    suspend fun importSkus(items: List<SkuItem>): JSONObject {
        val array = JSONArray()
        items.forEach { array.put(JSONObject().put("sku", it.sku).put("product_name", it.productName)) }
        return invoke("import-skus", JSONObject().put("items", array))
    }

    suspend fun listUsers(): List<UserProfile> {
        val array = invoke("list-users", JSONObject()).optJSONArray("users") ?: JSONArray()
        return buildList { for (i in 0 until array.length()) add(UserProfile.fromJson(array.getJSONObject(i))) }
    }

    suspend fun updateUser(
        id: String,
        employeeCode: String,
        fullName: String,
        contractor: String,
        role: UserRole,
        active: Boolean,
        newPassword: String
    ): UserProfile {
        val payload = JSONObject()
            .put("id", id)
            .put("employee_code", employeeCode)
            .put("full_name", fullName)
            .put("contractor", contractor)
            .put("role", role.wire)
            .put("active", active)
        if (newPassword.isNotBlank()) payload.put("new_password", newPassword)
        return UserProfile.fromJson(invoke("update-user", payload).getJSONObject("profile"))
    }

    suspend fun importUsers(items: List<ImportUserRow>): JSONObject {
        val array = JSONArray()
        items.forEach {
            array.put(
                JSONObject().put("employee_code", it.employeeCode).put("full_name", it.fullName)
                    .put("contractor", it.contractor).put("role", it.role.wire)
                    .put("active", it.active).put("initial_password", it.initialPassword)
            )
        }
        return invoke("import-users", JSONObject().put("items", array))
    }

    suspend fun syncGoogleSheet(): JSONObject = invoke("sync-google-sheet", JSONObject())
    suspend fun reportsSummary(): JSONObject = invoke("reports-summary", JSONObject())
    suspend fun issueHistory(limit: Int = 200): JSONArray = invoke("issue-history", JSONObject().put("limit", limit)).optJSONArray("issues") ?: JSONArray()

    suspend fun uploadDiagnosticLog(bundle: DiagnosticsLogger.UploadBundle): JSONObject = invoke(
        "upload-log",
        JSONObject()
            .put("gzip_base64", Base64.encodeToString(bundle.gzipBytes, Base64.NO_WRAP))
            .put("sha256", bundle.sha256)
            .put("client_created_at", bundle.createdAt)
            .put("device_name", bundle.deviceName)
            .put("app_version", "${BuildConfig.VERSION_NAME} [${BuildConfig.OTA_CHANNEL.uppercase()}]")
            .put("ota_channel", BuildConfig.OTA_CHANNEL)
    )

    suspend fun invoke(action: String, payload: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        refreshSessionIfNeeded()
        request("POST", "$baseUrl/functions/v1/api/$action", payload, authenticated = true, eventName = "api_$action")
    }

    private fun fetchProfile(accessToken: String, userId: String): UserProfile {
        val encodedId = URLEncoder.encode(userId, StandardCharsets.UTF_8.name())
        val result = requestArray(
            "GET",
            "$baseUrl/rest/v1/profiles?id=eq.$encodedId&select=id,employee_code,full_name,contractor,role,active",
            accessToken,
            "profile_fetch"
        )
        if (result.length() == 0) throw ApiException(403, "Tài khoản chưa có hồ sơ nhân sự")
        return UserProfile.fromJson(result.getJSONObject(0))
    }

    private fun request(
        method: String,
        url: String,
        body: JSONObject? = null,
        authenticated: Boolean,
        explicitToken: String? = null,
        eventName: String
    ): JSONObject {
        val raw = execute(method, url, body, authenticated, explicitToken, eventName)
        if (raw.isBlank()) return JSONObject()
        return if (raw.trimStart().startsWith("[")) JSONObject().put("data", JSONArray(raw)) else JSONObject(raw)
    }

    private fun requestArray(method: String, url: String, token: String, eventName: String): JSONArray {
        val raw = execute(method, url, null, authenticated = true, explicitToken = token, eventName = eventName)
        return if (raw.isBlank()) JSONArray() else JSONArray(raw)
    }

    private fun execute(
        method: String,
        url: String,
        body: JSONObject?,
        authenticated: Boolean,
        explicitToken: String?,
        eventName: String
    ): String {
        val started = System.nanoTime()
        val connection = URI(url).toURL().openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = 15_000
            connection.readTimeout = 30_000
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            connection.setRequestProperty("apikey", anonKey)
            if (authenticated) {
                val token = explicitToken ?: sessionStore.accessToken
                connection.setRequestProperty("Authorization", "Bearer $token")
                sessionStore.adminTestRole?.let { connection.setRequestProperty("x-admin-test-role", it.wire) }
            }
            if (body != null) {
                connection.doOutput = true
                connection.outputStream.use { it.write(body.toString().toByteArray(StandardCharsets.UTF_8)) }
            }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val response = stream?.bufferedReader()?.use(BufferedReader::readText).orEmpty()
            val elapsedMs = (System.nanoTime() - started) / 1_000_000
            diagnostics.info(
                "http_result",
                mapOf("event" to eventName, "method" to method, "status" to code, "elapsed_ms" to elapsedMs, "test_role" to (sessionStore.adminTestRole?.wire ?: ""))
            )
            if (code !in 200..299) {
                val parsed = runCatching { JSONObject(response) }.getOrNull()
                val message = parsed?.optString("error", response).orEmpty().ifBlank { response.ifBlank { "Lỗi máy chủ $code" } }
                val errorCode = parsed?.optString("code").orEmpty()
                diagnostics.warn("http_error", mapOf("event" to eventName, "status" to code, "code" to errorCode, "message" to message.take(500)))
                throw ApiException(code, message, errorCode)
            }
            return response
        } catch (error: Exception) {
            diagnostics.error("http_exception", error, mapOf("event" to eventName, "method" to method))
            throw error
        } finally { connection.disconnect() }
    }

    private fun requireConfigured() {
        if (!isConfigured) throw ApiException(503, "Ứng dụng chưa được nối với máy chủ. Hãy cài bản APK đã cấu hình.")
    }

    private fun employeeEmail(code: String): String {
        val raw = code.trim().lowercase()
        val safe = raw.replace(Regex("[^a-z0-9._-]"), "-")
        if (safe.isBlank() || safe != raw) throw ApiException(400, "Mã nhân viên không hợp lệ")
        return "$safe@bao-hang-1291.local"
    }

    private fun JSONArray?.toStockIssues(): List<StockIssue> {
        val array = this ?: JSONArray()
        return buildList { for (i in 0 until array.length()) add(StockIssue.fromJson(array.getJSONObject(i))) }
    }
}

class ApiException(val statusCode: Int, override val message: String, val code: String = "") : Exception(message)
