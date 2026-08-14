package vn.pickpack1291.baohang.network

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import vn.pickpack1291.baohang.BuildConfig
import vn.pickpack1291.baohang.data.IssueBoard
import vn.pickpack1291.baohang.data.IssueStatus
import vn.pickpack1291.baohang.data.ReportResult
import vn.pickpack1291.baohang.data.SessionStore
import vn.pickpack1291.baohang.data.StockIssue
import java.io.IOException
import java.time.Instant
import java.util.UUID
import java.util.concurrent.TimeUnit

class SheetFallbackClient(private val session: SessionStore) {
    class FallbackException(val code: String, message: String) : IOException(message)

    private val jsonType = "application/json; charset=utf-8".toMediaType()
    private val client = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()

    suspend fun refreshCredential() {
        val token = session.accessToken
        if (token.isBlank()) throw FallbackException("AUTH_REQUIRED", "Phiên đăng nhập không hợp lệ")
        val url = BuildConfig.SUPABASE_URL.trimEnd('/') + "/functions/v1/fallback-token"
        val request = Request.Builder().url(url)
            .post(JSONObject().put("device_id", session.deviceId).toString().toRequestBody(jsonType))
            .header("Authorization", "Bearer $token")
            .header("apikey", BuildConfig.SUPABASE_ANON_KEY)
            .header("Content-Type", "application/json")
            .build()
        val result = executeObject(request)
        val fallbackToken = result.optString("fallback_token")
        val fallbackUrl = result.optString("fallback_url")
        val expiresAt = runCatching { Instant.parse(result.optString("expires_at")).toEpochMilli() }.getOrDefault(0L)
        if (fallbackToken.isBlank() || !fallbackUrl.startsWith("https://") || expiresAt <= System.currentTimeMillis()) {
            throw FallbackException("INVALID_CREDENTIAL", "Fallback credential không hợp lệ")
        }
        session.saveFallbackCredential(fallbackToken, fallbackUrl, expiresAt)
    }

    suspend fun reportShortage(sku: String, eventId: String): ReportResult {
        val result = commit("REPORT_SHORTAGE", eventId, sku = sku)
        return ReportResult(result, wasAlreadyReported = false, message = "Đã ghi nhận báo thiếu qua Google Sheet fallback")
    }

    suspend fun claimIssue(issueId: String, eventId: String = UUID.randomUUID().toString()): StockIssue =
        commit("CLAIM", eventId, issueId = issueId)

    suspend fun updateIssue(issueId: String, action: String, eventId: String = UUID.randomUUID().toString()): StockIssue {
        val eventType = when (action.uppercase()) {
            "AVAILABLE" -> "AVAILABLE"
            "NOT_FOUND", "SKIP_ALLOWED" -> "SKIP_ALLOWED"
            else -> throw FallbackException("INVALID_ACTION", "Trạng thái không được hỗ trợ trong fallback")
        }
        return commit(eventType, eventId, issueId = issueId)
    }

    suspend fun reassignIssue(issueId: String, newAssigneeId: String, reason: String, eventId: String = UUID.randomUUID().toString()): StockIssue =
        commit("REASSIGN", eventId, issueId = issueId, payload = JSONObject().put("new_assignee_account_id", newAssigneeId).put("reason", reason))

    suspend fun issueBoard(): IssueBoard {
        val result = signedPost(JSONObject().put("mode", "fallback_query").put("query", "board"))
        val states = result.optJSONArray("states") ?: JSONArray()
        val issues = (0 until states.length()).mapNotNull { states.optJSONObject(it)?.let(::stockIssue) }
        return IssueBoard(
            open = issues.filter { it.status == IssueStatus.OPEN },
            claimed = issues.filter { it.status.isClaimedBucket },
            recent = emptyList()
        )
    }

    suspend fun myIssues(): List<StockIssue> {
        val result = signedPost(JSONObject().put("mode", "fallback_query").put("query", "my"))
        val states = result.optJSONArray("states") ?: JSONArray()
        return (0 until states.length()).mapNotNull { states.optJSONObject(it)?.let(::stockIssue) }
    }

    suspend fun issueBySku(sku: String): StockIssue? {
        val result = signedPost(JSONObject().put("mode", "fallback_query").put("query", "sku").put("sku", sku))
        return result.optJSONObject("state")?.let(::stockIssue)
    }

    private suspend fun commit(
        eventType: String,
        eventId: String,
        sku: String = "",
        issueId: String = "",
        payload: JSONObject = JSONObject()
    ): StockIssue {
        val event = JSONObject()
            .put("event_id", eventId)
            .put("event_type", eventType)
            .put("occurred_at_device", Instant.now().toString())
            .put("issue_id", issueId)
            .put("sku", sku)
            .put("payload_json", JSONObject(payload.toString()).apply {
                if (sku.isNotBlank()) put("sku", sku)
                if (issueId.isNotBlank()) put("issue_id", issueId)
            })
        val result = signedPost(JSONObject().put("mode", "fallback_commit").put("event", event))
        return stockIssue(result.getJSONObject("state"))
    }

    private suspend fun signedPost(body: JSONObject): JSONObject {
        if (!session.hasValidFallbackCredential) throw FallbackException("FALLBACK_TOKEN_EXPIRED", "Token fallback đã hết hạn")
        body.put("fallback_token", session.fallbackToken)
            .put("timestamp_ms", System.currentTimeMillis())
            .put("nonce", UUID.randomUUID().toString() + UUID.randomUUID().toString())
            .put("device_id", session.deviceId)
        val request = Request.Builder().url(session.fallbackUrl)
            .post(body.toString().toRequestBody(jsonType))
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .build()
        return executeObject(request)
    }

    private suspend fun executeObject(request: Request): JSONObject = withContext(Dispatchers.IO) {
        client.newCall(request).execute().use { response ->
            val text = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw FallbackException("HTTP_${response.code}", "Google Sheet HTTP ${response.code}")
            val json = runCatching { JSONObject(text) }.getOrElse { throw FallbackException("INVALID_RESPONSE", "Google Sheet trả dữ liệu không hợp lệ") }
            if (!json.optBoolean("ok", true)) {
                val error = json.optString("error", "FALLBACK_REJECTED")
                throw FallbackException(error.substringBefore(':').take(80), error.take(300))
            }
            json
        }
    }

    private fun stockIssue(json: JSONObject): StockIssue = StockIssue(
        id = json.optString("issue_id"),
        sku = json.optString("sku"),
        productName = json.optString("product_name"),
        status = IssueStatus.from(json.optString("status")),
        reportCount = json.optInt("report_count", 1),
        reportedAt = json.optString("first_reported_at", json.optString("updated_at")),
        updatedAt = json.optString("updated_at"),
        assignedName = json.optString("claimed_by_name"),
        assignedId = json.optString("claimed_by_account_id").ifBlank { null },
        issueVersion = json.optLong("issue_version", 1)
    )
}
