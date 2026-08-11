package vn.pickpack1291.baohang.network

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import vn.pickpack1291.baohang.BuildConfig
import vn.pickpack1291.baohang.data.AppConfig
import vn.pickpack1291.baohang.data.AuthSession
import vn.pickpack1291.baohang.data.ImportUserRow
import vn.pickpack1291.baohang.data.ReportResult
import vn.pickpack1291.baohang.data.SessionStore
import vn.pickpack1291.baohang.data.SkuItem
import vn.pickpack1291.baohang.data.StockIssue
import vn.pickpack1291.baohang.data.UserProfile
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URI
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

class ApiClient(private val sessionStore: SessionStore) {
    private val baseUrl = BuildConfig.SUPABASE_URL.trimEnd('/')
    private val anonKey = BuildConfig.SUPABASE_ANON_KEY

    val isConfigured: Boolean
        get() = baseUrl.startsWith("https://") && anonKey.length > 30 &&
            !baseUrl.contains("your-project") && !anonKey.contains("replace")

    suspend fun signIn(employeeCode: String, password: String): AuthSession = withContext(Dispatchers.IO) {
        requireConfigured()
        val email = employeeEmail(employeeCode)
        val body = JSONObject().put("email", email).put("password", password)
        val auth = request(
            "POST", "$baseUrl/auth/v1/token?grant_type=password", body,
            authenticated = false
        )
        val access = auth.getString("access_token")
        val refresh = auth.getString("refresh_token")
        val expiresAt = System.currentTimeMillis() / 1000L + auth.optLong("expires_in", 3600)
        val authUserId = auth.getJSONObject("user").getString("id")
        val profile = fetchProfile(access, authUserId)
        if (!profile.active) throw ApiException(403, "Tài khoản đã ngừng hoạt động")
        AuthSession(access, refresh, expiresAt, profile)
    }

    suspend fun refreshSessionIfNeeded() = withContext(Dispatchers.IO) {
        if (sessionStore.expiresAt > System.currentTimeMillis() / 1000L + 120) return@withContext
        val refreshToken = sessionStore.refreshToken
        if (refreshToken.isBlank()) return@withContext
        val result = request(
            "POST", "$baseUrl/auth/v1/token?grant_type=refresh_token",
            JSONObject().put("refresh_token", refreshToken), authenticated = false
        )
        sessionStore.updateTokens(
            result.getString("access_token"),
            result.optString("refresh_token", refreshToken),
            System.currentTimeMillis() / 1000L + result.optLong("expires_in", 3600)
        )
    }

    suspend fun reportShortage(sku: String, clientRequestId: String): ReportResult {
        val json = invoke(
            "report-shortage",
            JSONObject().put("sku", sku).put("client_request_id", clientRequestId)
        )
        return ReportResult(
            StockIssue.fromJson(json.getJSONObject("issue")),
            json.optBoolean("already_reported", false),
            json.optString("message", "Đã ghi nhận báo hết hàng")
        )
    }

    suspend fun activeIssues(): List<StockIssue> {
        val response = invoke("active-issues", JSONObject())
        return response.optJSONArray("issues").toStockIssues()
    }

    suspend fun myIssues(): List<StockIssue> {
        val response = invoke("my-issues", JSONObject())
        return response.optJSONArray("issues").toStockIssues()
    }

    suspend fun updateIssue(issueId: String, action: String): StockIssue {
        val response = invoke(
            "update-issue", JSONObject().put("issue_id", issueId).put("action", action)
        )
        return StockIssue.fromJson(response.getJSONObject("issue"))
    }

    suspend fun acknowledgeAlert(eventId: String) {
        invoke("ack-alert", JSONObject().put("event_id", eventId))
    }

    suspend fun registerDevice(token: String, deviceName: String, appVersion: String) {
        invoke(
            "register-device",
            JSONObject().put("fcm_token", token).put("device_name", deviceName)
                .put("app_version", appVersion).put("platform", "android")
        )
    }

    data class CatalogPage(val items: List<SkuItem>, val hasMore: Boolean, val syncUntil: String)

    suspend fun catalogPage(
        afterSku: String?,
        updatedSince: String?,
        syncUntil: String?,
        limit: Int = 1000
    ): CatalogPage {
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
        return CatalogPage(
            result,
            response.optBoolean("has_more", result.size == limit),
            response.getString("sync_until")
        )
    }

    suspend fun getConfig(): AppConfig = AppConfig.fromJson(invoke("get-config", JSONObject()))

    suspend fun saveConfig(config: AppConfig): AppConfig =
        AppConfig.fromJson(invoke("save-config", config.toJson()))

    suspend fun importSkus(items: List<SkuItem>): JSONObject {
        val array = JSONArray()
        items.forEach { array.put(JSONObject().put("sku", it.sku).put("product_name", it.productName)) }
        return invoke("import-skus", JSONObject().put("items", array))
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

    suspend fun invoke(action: String, payload: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        refreshSessionIfNeeded()
        request("POST", "$baseUrl/functions/v1/api/$action", payload, authenticated = true)
    }

    private fun fetchProfile(accessToken: String, userId: String): UserProfile {
        val encodedId = URLEncoder.encode(userId, StandardCharsets.UTF_8.name())
        val result = requestArray(
            "GET",
            "$baseUrl/rest/v1/profiles?id=eq.$encodedId&select=id,employee_code,full_name,contractor,role,active",
            accessToken
        )
        if (result.length() == 0) throw ApiException(403, "Tài khoản chưa có hồ sơ nhân sự")
        return UserProfile.fromJson(result.getJSONObject(0))
    }

    private fun request(
        method: String,
        url: String,
        body: JSONObject? = null,
        authenticated: Boolean,
        explicitToken: String? = null
    ): JSONObject {
        val raw = execute(method, url, body, authenticated, explicitToken)
        if (raw.isBlank()) return JSONObject()
        return if (raw.trimStart().startsWith("[")) {
            JSONObject().put("data", JSONArray(raw))
        } else JSONObject(raw)
    }

    private fun requestArray(method: String, url: String, token: String): JSONArray {
        val raw = execute(method, url, null, authenticated = true, explicitToken = token)
        return if (raw.isBlank()) JSONArray() else JSONArray(raw)
    }

    private fun execute(
        method: String,
        url: String,
        body: JSONObject?,
        authenticated: Boolean,
        explicitToken: String?
    ): String {
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
            }
            if (body != null) {
                connection.doOutput = true
                connection.outputStream.use { it.write(body.toString().toByteArray(StandardCharsets.UTF_8)) }
            }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val response = stream?.bufferedReader()?.use(BufferedReader::readText).orEmpty()
            if (code !in 200..299) {
                val message = runCatching { JSONObject(response).optString("error", response) }
                    .getOrDefault(response).ifBlank { "Lỗi máy chủ $code" }
                throw ApiException(code, message)
            }
            return response
        } finally {
            connection.disconnect()
        }
    }

    private fun requireConfigured() {
        if (!isConfigured) throw ApiException(
            503, "Ứng dụng chưa được nối với máy chủ. Hãy cài bản APK đã cấu hình."
        )
    }

    private fun employeeEmail(code: String): String {
        val safe = code.trim().lowercase().replace(Regex("[^a-z0-9._-]"), "-")
        return "$safe@bao-hang-1291.local"
    }

    private fun JSONArray?.toStockIssues(): List<StockIssue> {
        val array = this ?: JSONArray()
        return buildList { for (i in 0 until array.length()) add(StockIssue.fromJson(array.getJSONObject(i))) }
    }
}

class ApiException(val statusCode: Int, override val message: String) : Exception(message)
