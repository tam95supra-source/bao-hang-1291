package vn.pickpack1291.baohang.network

import android.util.Base64
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import vn.pickpack1291.baohang.BuildConfig
import vn.pickpack1291.baohang.data.AppConfig
import vn.pickpack1291.baohang.data.AuthSession
import vn.pickpack1291.baohang.data.ImportUserRow
import vn.pickpack1291.baohang.data.IssueBoard
import vn.pickpack1291.baohang.data.IssueDelta
import vn.pickpack1291.baohang.data.IssueDeltaEvent
import vn.pickpack1291.baohang.data.IssueStatus
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
import java.time.Instant
import java.util.UUID

class ApiClient(
    private val sessionStore: SessionStore,
    private val diagnostics: DiagnosticsLogger
) {
    private val neonApi = BuildConfig.NEON_DATA_API.trimEnd('/')
    private val firebaseWebApiKey = BuildConfig.FIREBASE_WEB_API_KEY.trim()
    private val workerUrl = BuildConfig.APPS_SCRIPT_WORKER_URL.trim()
    private val signalScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    val isConfigured: Boolean
        get() = neonApi.startsWith("https://") && neonApi.contains("ap-southeast-1") &&
            firebaseWebApiKey.startsWith("AIza") && firebaseWebApiKey.length > 30

    suspend fun signIn(employeeCode: String, password: String): AuthSession = withContext(Dispatchers.IO) {
        requireConfigured()
        val code = employeeCode.trim()
        diagnostics.info("auth_login_start", mapOf("employee_code" to code, "provider" to "firebase"))
        val auth = requestJson(
            method = "POST",
            url = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${urlEncode(firebaseWebApiKey)}",
            body = JSONObject()
                .put("email", employeeEmail(code))
                .put("password", password)
                .put("returnSecureToken", true),
            token = null,
            eventName = "firebase_login"
        )
        val access = auth.getString("idToken")
        val refresh = auth.getString("refreshToken")
        val expiresAt = System.currentTimeMillis() / 1000L + auth.optString("expiresIn", "3600").toLongOrNull().orDefault(3600L)
        val sessionJson = neonRpc(
            "api_session_profile_rpc",
            JSONObject().put("p_test_role", JSONObject.NULL),
            explicitToken = access,
            eventName = "session_profile"
        )
        val profile = UserProfile.fromJson(sessionJson.getJSONObject("profile"))
        if (!profile.active) throw ApiException(403, "Tài khoản đã ngừng hoạt động")
        diagnostics.info("auth_login_success", mapOf("employee_code" to profile.employeeCode, "role" to profile.role.wire, "provider" to "firebase_neon"))
        AuthSession(access, refresh, expiresAt, profile)
    }

    suspend fun refreshSessionIfNeeded() = withContext(Dispatchers.IO) {
        if (sessionStore.expiresAt > System.currentTimeMillis() / 1000L + 120L) return@withContext
        val refresh = sessionStore.refreshToken
        if (refresh.isBlank()) return@withContext
        val result = requestForm(
            "https://securetoken.googleapis.com/v1/token?key=${urlEncode(firebaseWebApiKey)}",
            mapOf("grant_type" to "refresh_token", "refresh_token" to refresh),
            "firebase_refresh"
        )
        sessionStore.updateTokens(
            result.getString("id_token"),
            result.optString("refresh_token", refresh),
            System.currentTimeMillis() / 1000L + result.optString("expires_in", "3600").toLongOrNull().orDefault(3600L)
        )
    }

    suspend fun sessionProfile(): UserProfile = UserProfile.fromJson(
        invoke("session-profile", JSONObject()).getJSONObject("profile")
    )

    suspend fun searchSkus(query: String, limit: Int = 20): List<SkuItem> {
        val response = invoke("search-skus", JSONObject().put("query", query).put("limit", limit))
        return response.optJSONArray("items").toSkuItems()
    }

    suspend fun searchSkuDigits(query: String, limit: Int = 20): List<SkuItem> {
        val response = invoke("picker-search-digits", JSONObject().put("query", query).put("limit", limit))
        return response.optJSONArray("items").toSkuItems()
    }

    suspend fun withdrawShortage(issueId: String): JSONObject {
        val result = invoke("withdraw-shortage", JSONObject().put("issue_id", issueId))
        deferWorkerKick("withdraw_shortage")
        return result
    }

    suspend fun reportShortage(sku: String, clientRequestId: String): ReportResult {
        val json = invoke("report-shortage", JSONObject().put("sku", sku).put("client_request_id", clientRequestId))
        val issue = StockIssue.fromJson(json.getJSONObject("issue"))
        deferIssueTransport(issue, "report_shortage")
        return ReportResult(
            issue,
            json.optBoolean("already_reported", false),
            json.optString("message", "Đã ghi nhận báo thiếu")
        )
    }

    suspend fun activeIssues(): List<StockIssue> = invoke("active-issues", JSONObject()).optJSONArray("issues").toStockIssues()

    suspend fun issueBoard(): IssueBoard {
        val response = invoke("issue-board", JSONObject())
        val withdrawal = invoke("withdrawn-board", JSONObject())
        val open = response.optJSONArray("open").toStockIssues()
        val claimed = response.optJSONArray("claimed").toStockIssues()
        val recent = response.optJSONArray("recent").toStockIssues()
        val withdrawn = withdrawal.optJSONArray("withdrawn").toStockIssues()
        val counts = response.optJSONObject("counts") ?: JSONObject()
        return IssueBoard(
            open = open,
            claimed = claimed,
            recent = recent,
            withdrawn = withdrawn,
            openCount = counts.optInt("open", open.size),
            claimedCount = counts.optInt("claimed", claimed.size),
            availableCount = counts.optInt("available", recent.count { it.status == IssueStatus.AVAILABLE }),
            skippedCount = counts.optInt("skipped", recent.count { it.status == IssueStatus.SKIP_ALLOWED }),
            withdrawnCount = withdrawal.optInt("count", withdrawn.size),
            realtimeSeq = response.optLong("realtime_seq", 0L)
        )
    }

    suspend fun issueDetail(issueId: String): StockIssue = StockIssue.fromJson(
        invoke("issue-detail", JSONObject().put("issue_id", issueId)).getJSONObject("issue")
    )

    suspend fun issueDelta(afterSeq: Long, limit: Int = 200): IssueDelta {
        val response = invoke("issue-delta", JSONObject().put("after_seq", afterSeq).put("limit", limit))
        val array = response.optJSONArray("events") ?: JSONArray()
        val events = buildList {
            for (index in 0 until array.length()) {
                val row = array.getJSONObject(index)
                add(
                    IssueDeltaEvent(
                        seq = row.optLong("seq", afterSeq),
                        entityId = row.optString("entity_id"),
                        entityVersion = row.optLong("entity_version", 0L),
                        visible = row.optBoolean("visible", false),
                        withdrawnChanged = row.optBoolean("withdrawn_changed", false),
                        issue = row.optJSONObject("issue")?.let(StockIssue::fromJson)
                    )
                )
            }
        }
        return IssueDelta(
            events = events,
            latestSeq = response.optLong("latest_seq", afterSeq),
            serverSeq = response.optLong("server_seq", afterSeq),
            hasMore = response.optBoolean("has_more", false),
            requiresFullReconcile = response.optBoolean("requires_full_reconcile", false)
        )
    }

    suspend fun myIssues(): List<StockIssue> = invoke("picker-my-issues", JSONObject()).optJSONArray("issues").toStockIssues()

    suspend fun claimIssue(issueId: String): StockIssue {
        val issue = StockIssue.fromJson(
            invoke("claim-issue", JSONObject().put("issue_id", issueId).put("client_request_id", UUID.randomUUID().toString())).getJSONObject("issue")
        )
        deferIssueTransport(issue, "claim_issue")
        return issue
    }

    suspend fun reassignIssue(issueId: String, newAssigneeId: String, reason: String): StockIssue {
        val issue = StockIssue.fromJson(
            invoke(
                "reassign-issue",
                JSONObject()
                    .put("issue_id", issueId)
                    .put("new_assignee_id", newAssigneeId)
                    .put("reason", reason)
                    .put("client_request_id", UUID.randomUUID().toString())
            ).getJSONObject("issue")
        )
        deferIssueTransport(issue, "reassign_issue")
        return issue
    }

    suspend fun updateIssue(issueId: String, action: String): StockIssue {
        val issue = StockIssue.fromJson(
            invoke(
                "update-issue",
                JSONObject()
                    .put("issue_id", issueId)
                    .put("action", action)
                    .put("client_request_id", UUID.randomUUID().toString())
            ).getJSONObject("issue")
        )
        deferIssueTransport(issue, "update_issue")
        return issue
    }

    suspend fun restoreSkippedIssue(issueId: String): StockIssue {
        val issue = StockIssue.fromJson(
            invoke(
                "restore-skipped",
                JSONObject()
                    .put("issue_id", issueId)
                    .put("reason", "Đã tìm thấy hàng sau khi cho phép bỏ qua")
            ).getJSONObject("issue")
        )
        deferIssueTransport(issue, "restore_skipped")
        return issue
    }

    suspend fun pendingAlerts(): List<PendingAlert> {
        val array = invoke("pending-alerts", JSONObject()).optJSONArray("events") ?: JSONArray()
        return buildList { for (i in 0 until array.length()) add(PendingAlert.fromJson(array.getJSONObject(i))) }
    }

    suspend fun markAlertReceived(eventId: String) { invoke("mark-alert-received", JSONObject().put("event_id", eventId)) }
    suspend fun markAlertDisplayed(eventId: String) { invoke("mark-alert-displayed", JSONObject().put("event_id", eventId)) }
    suspend fun acknowledgeAlert(eventId: String) { invoke("ack-alert", JSONObject().put("event_id", eventId)) }

    suspend fun registerDevice(token: String, deviceName: String, appVersion: String) {
        invoke(
            "register-device-v2",
            JSONObject().put("fcm_token", token).put("device_name", deviceName)
                .put("app_version", appVersion).put("platform", "android")
                .put("realtime_topic_capable", true)
        )
    }

    data class CatalogPage(val items: List<SkuItem>, val hasMore: Boolean, val syncUntil: String, val revision: Long)

    suspend fun catalogPage(afterSku: String?, updatedSince: String?, syncUntil: String?, limit: Int = 1000): CatalogPage {
        val payload = JSONObject().put("limit", limit)
        if (!afterSku.isNullOrBlank()) payload.put("after_sku", afterSku)
        if (!updatedSince.isNullOrBlank()) payload.put("updated_since", updatedSince)
        if (!syncUntil.isNullOrBlank()) payload.put("sync_until", syncUntil)
        val response = invoke("sync-catalog", payload)
        val result = response.optJSONArray("items").toSkuItems()
        return CatalogPage(
            result,
            response.optBoolean("has_more", result.size == limit),
            response.optString("sync_until"),
            response.optLong("catalog_revision", 1L)
        )
    }

    suspend fun getOperationalConfig(): OperationalConfig = OperationalConfig.fromJson(invoke("get-operational-config", JSONObject()))
    suspend fun saveOperationalConfig(config: OperationalConfig): OperationalConfig = OperationalConfig.fromJson(invoke("save-operational-config", config.toJson()))
    suspend fun getConfig(): AppConfig = AppConfig.fromJson(invoke("get-config", JSONObject()))
    suspend fun saveConfig(config: AppConfig): AppConfig = AppConfig.fromJson(invoke("save-config", config.toJson()))

    suspend fun importSkus(items: List<SkuItem>): JSONObject {
        val array = JSONArray()
        items.forEach { array.put(JSONObject().put("sku", it.sku).put("product_name", it.productName)) }
        val result = invoke("import-skus", JSONObject().put("items", array))
        kickWorkerBestEffort("import_skus")
        return result
    }

    suspend fun replaceCatalog(items: List<SkuItem>, sourceName: String): JSONObject {
        val array = JSONArray()
        items.forEach { array.put(JSONObject().put("sku", it.sku).put("product_name", it.productName)) }
        val result = invoke("replace-catalog", JSONObject().put("items", array).put("source_name", sourceName))
        kickWorkerBestEffort("replace_catalog")
        return result
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
    ): UserProfile = withContext(Dispatchers.IO) {
        refreshSessionIfNeeded()
        val user = JSONObject()
            .put("id", id)
            .put("employee_code", employeeCode)
            .put("full_name", fullName)
            .put("contractor", contractor)
            .put("role", role.wire)
            .put("active", active)
        if (newPassword.isNotBlank()) user.put("new_password", newPassword)
        val result = workerRequest("user-upsert", JSONObject().put("user", user), "worker_user_upsert")
        UserProfile.fromJson(result.getJSONObject("profile"))
    }

    suspend fun importUsers(items: List<ImportUserRow>): JSONObject = withContext(Dispatchers.IO) {
        refreshSessionIfNeeded()
        var imported = 0
        val failures = JSONArray()
        items.forEach { row ->
            val user = JSONObject()
                .put("employee_code", row.employeeCode)
                .put("full_name", row.fullName)
                .put("contractor", row.contractor)
                .put("role", row.role.wire)
                .put("active", row.active)
                .put("initial_password", row.initialPassword)
            runCatching { workerRequest("user-upsert", JSONObject().put("user", user), "worker_import_user") }
                .onSuccess { imported++ }
                .onFailure { failures.put(JSONObject().put("employee_code", row.employeeCode).put("error", it.message.orEmpty().take(300))) }
        }
        JSONObject().put("imported", imported).put("failed", failures.length()).put("errors", failures)
    }

    suspend fun syncGoogleSheet(): JSONObject = withContext(Dispatchers.IO) {
        refreshSessionIfNeeded()
        workerRequest("worker-kick", JSONObject(), "worker_sheet_sync")
    }

    suspend fun reportsSummary(): JSONObject = invoke("reports-summary", JSONObject())
    suspend fun issueHistory(limit: Int = 200): JSONArray = invoke("issue-history", JSONObject().put("limit", limit)).optJSONArray("issues") ?: JSONArray()

    suspend fun uploadDiagnosticLog(bundle: DiagnosticsLogger.UploadBundle): JSONObject = withContext(Dispatchers.IO) {
        refreshSessionIfNeeded()
        workerRequest(
            "upload-log",
            JSONObject()
                .put("gzip_base64", Base64.encodeToString(bundle.gzipBytes, Base64.NO_WRAP))
                .put("sha256", bundle.sha256)
                .put("client_created_at", bundle.createdAt)
                .put("device_name", bundle.deviceName)
                .put("app_version", "${BuildConfig.VERSION_NAME} [${BuildConfig.OTA_CHANNEL.uppercase()}]"),
            "worker_upload_log"
        )
    }

    suspend fun invoke(action: String, payload: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        refreshSessionIfNeeded()
        val mapping = mapAction(action, payload)
        neonRpc(mapping.first, mapping.second, eventName = "neon_$action")
    }

    private fun mapAction(action: String, payload: JSONObject): Pair<String, JSONObject> {
        val testRole = sessionStore.adminTestRole?.wire
        fun base() = JSONObject().put("p_test_role", testRole ?: JSONObject.NULL)
        return when (action) {
            "session-profile" -> "api_session_profile_rpc" to base()
            "search-skus" -> "api_search_skus_rpc" to base().put("p_query", payload.optString("query")).put("p_limit", payload.optInt("limit", 20))
            "picker-search-digits" -> "api_picker_search_digits_rpc" to base().put("p_query", payload.optString("query")).put("p_limit", payload.optInt("limit", 20))
            "report-shortage" -> "report_shortage_rpc" to JSONObject().put("p_sku", payload.getString("sku")).put("p_client_request_id", payload.getString("client_request_id"))
            "active-issues" -> "api_active_issues_rpc" to base().put("p_limit", payload.optInt("limit", 250))
            "issue-board" -> "api_issue_board_rpc" to base()
            "withdrawn-board" -> "api_withdrawn_board_rpc" to base()
            "issue-detail" -> "api_issue_detail_rpc" to base().put("p_issue_id", payload.getString("issue_id"))
            "issue-delta" -> "api_issue_delta_rpc" to base()
                .put("p_after_seq", payload.optLong("after_seq", 0L))
                .put("p_limit", payload.optInt("limit", 200))
            "picker-my-issues", "my-issues" -> "api_picker_my_issues_rpc" to base()
            "claim-issue" -> "api_claim_issue_rpc" to base().put("p_issue_id", payload.getString("issue_id")).put("p_client_request_id", payload.optString("client_request_id", UUID.randomUUID().toString()))
            "reassign-issue" -> "api_reassign_issue_rpc" to base()
                .put("p_issue_id", payload.getString("issue_id"))
                .put("p_new_assignee_id", payload.getString("new_assignee_id"))
                .put("p_reason", payload.optString("reason"))
                .put("p_client_request_id", payload.optString("client_request_id", UUID.randomUUID().toString()))
            "update-issue" -> "api_update_issue_rpc" to base()
                .put("p_issue_id", payload.getString("issue_id"))
                .put("p_action", payload.getString("action"))
                .put("p_client_request_id", payload.optString("client_request_id", UUID.randomUUID().toString()))
            "restore-skipped" -> "api_restore_skipped_issue_rpc" to base()
                .put("p_issue_id", payload.getString("issue_id"))
                .put("p_reason", payload.optString("reason"))
            "withdraw-shortage" -> "api_withdraw_shortage_rpc" to base().put("p_issue_id", payload.getString("issue_id"))
            "pending-alerts" -> "api_pending_alerts_rpc" to base()
            "mark-alert-received" -> "api_mark_alert_received_rpc" to base().put("p_event_id", payload.getString("event_id"))
            "mark-alert-displayed" -> "api_mark_alert_displayed_rpc" to base().put("p_event_id", payload.getString("event_id"))
            "ack-alert" -> "api_ack_alert_rpc" to base().put("p_event_id", payload.getString("event_id"))
            "register-device" -> "api_register_device_rpc" to base()
                .put("p_fcm_token", payload.getString("fcm_token"))
                .put("p_device_name", payload.optString("device_name"))
                .put("p_app_version", payload.optString("app_version"))
                .put("p_platform", payload.optString("platform", "android"))
            "register-device-v2" -> "api_register_device_v2_rpc" to base()
                .put("p_fcm_token", payload.getString("fcm_token"))
                .put("p_device_name", payload.optString("device_name"))
                .put("p_app_version", payload.optString("app_version"))
                .put("p_platform", payload.optString("platform", "android"))
                .put("p_realtime_topic_capable", payload.optBoolean("realtime_topic_capable", true))
            "sync-catalog" -> "api_sync_catalog_rpc" to base()
                .putNullable("p_after_sku", payload.optNullableString("after_sku"))
                .putNullable("p_updated_since", payload.optNullableString("updated_since"))
                .putNullable("p_sync_until", payload.optNullableString("sync_until"))
                .put("p_limit", payload.optInt("limit", 1000))
            "get-operational-config" -> "api_get_operational_config_rpc" to base()
            "save-operational-config" -> "api_save_operational_config_rpc" to base()
                .put("p_acknowledge_minutes", payload.optInt("acknowledge_minutes", 15))
                .put("p_reminder_minutes", payload.optInt("reminder_minutes", 5))
                .put("p_replenish_minutes", payload.optInt("replenish_minutes", 15))
                .put("p_picker_ack_reminder_minutes", payload.optInt("picker_ack_reminder_minutes", 3))
                .put("p_auto_skip_enabled", payload.optBoolean("auto_skip_enabled", false))
                .put("p_auto_skip_after_minutes", payload.optInt("auto_skip_after_minutes", 120))
            "get-config" -> "api_get_config_rpc" to base()
            "save-config" -> "api_save_config_rpc" to base().put("p_config", payload)
            "import-skus" -> "api_import_skus_rpc" to base().put("p_items", payload.optJSONArray("items") ?: JSONArray())
            "replace-catalog" -> "api_replace_catalog_rpc" to base()
                .put("p_items", payload.optJSONArray("items") ?: JSONArray())
                .put("p_source_name", payload.optString("source_name"))
            "list-users" -> "api_list_users_rpc" to base()
            "staff-sync-status" -> "api_staff_sync_status_rpc" to base().put("p_limit", payload.optInt("limit", 20))
            "admin-summary" -> "api_admin_summary_rpc" to base()
            "service-metrics" -> "api_service_metrics_rpc" to base()
            "reports-summary" -> "api_reports_summary_rpc" to base()
            "issue-history" -> "api_issue_history_rpc" to base().put("p_limit", payload.optInt("limit", 200))
            "audit-history" -> "api_audit_history_rpc" to base().put("p_limit", payload.optInt("limit", 150))
            "list-logs" -> "api_list_logs_rpc" to base()
                .put("p_limit", payload.optInt("limit", 100))
                .put("p_employee_code", payload.optString("employee_code"))
            else -> throw ApiException(400, "Tác vụ chưa được chuyển sang máy chủ mới: $action", "MIGRATION_ACTION_UNSUPPORTED")
        }
    }

    private fun neonRpc(
        name: String,
        payload: JSONObject,
        explicitToken: String? = null,
        eventName: String
    ): JSONObject {
        val token = explicitToken ?: sessionStore.accessToken
        if (token.isBlank()) throw ApiException(401, "Phiên đăng nhập đã hết hạn")
        val raw = executeJson(
            method = "POST",
            url = "$neonApi/rpc/${urlEncode(name)}",
            body = payload,
            token = token,
            eventName = eventName,
            connectTimeout = 15_000,
            readTimeout = 30_000
        )
        if (raw.isBlank() || raw == "null") return JSONObject()
        return when {
            raw.trimStart().startsWith("{") -> JSONObject(raw)
            raw.trimStart().startsWith("[") -> JSONObject().put("data", JSONArray(raw))
            else -> JSONObject().put("value", parseScalar(raw))
        }
    }

    private fun workerRequest(action: String, payload: JSONObject, eventName: String): JSONObject {
        if (workerUrl.isBlank()) throw ApiException(503, "Worker Google chưa được triển khai", "WORKER_NOT_CONFIGURED")
        val body = JSONObject(payload.toString())
            .put("action", action)
            .put("id_token", sessionStore.accessToken)
        val result = requestJson("POST", workerUrl, body, token = null, eventName = eventName, connectTimeout = 12_000, readTimeout = 45_000)
        if (!result.optBoolean("ok", false)) {
            throw ApiException(500, result.optString("error", "Worker Google trả lỗi"), "WORKER_ERROR")
        }
        return result
    }

    private fun deferIssueTransport(issue: StockIssue, reason: String) {
        signalScope.launch {
            emitIssueRealtimeBestEffort(issue, reason)
            kickRealtimeBestEffort(issue, reason)
            if (reason == "update_issue" || reason == "restore_skipped") {
                kickWorkerBestEffort(reason)
            }
        }
    }

    private fun deferWorkerKick(reason: String) {
        signalScope.launch { kickWorkerBestEffort(reason) }
    }

    private suspend fun kickRealtimeBestEffort(issue: StockIssue, reason: String) = withContext(Dispatchers.IO) {
        if (workerUrl.isBlank() || sessionStore.accessToken.isBlank()) return@withContext
        runCatching {
            refreshSessionIfNeeded()
            val body = JSONObject()
                .put("action", "realtime-kick")
                .put("id_token", sessionStore.accessToken)
                .put("topic", "issues")
                .put("entity_id", issue.id)
                .put("entity_version", issue.issueVersion)
                .put("reason", reason)
            requestJson("POST", workerUrl, body, token = null, eventName = "realtime_kick_$reason", connectTimeout = 4_000, readTimeout = 8_000)
        }.onFailure {
            diagnostics.warn("realtime_kick_deferred", mapOf("reason" to reason, "error" to (it.message ?: it.javaClass.simpleName).take(240)))
        }
    }

    private suspend fun emitIssueRealtimeBestEffort(issue: StockIssue, reason: String) = withContext(Dispatchers.IO) {
        if (sessionStore.accessToken.isBlank()) return@withContext
        runCatching {
            refreshSessionIfNeeded()
            val fields = JSONObject()
                .put("event_type", JSONObject().put("stringValue", "issue_changed"))
                .put("topic", JSONObject().put("stringValue", "issues"))
                .put("entity_id", JSONObject().put("stringValue", issue.id))
                .put("entity_version", JSONObject().put("integerValue", issue.issueVersion.toString()))
                .put("source", JSONObject().put("stringValue", "android:$reason"))
                .put("client_at", JSONObject().put("timestampValue", Instant.now().toString()))
            requestJson(
                "PATCH",
                "https://firestore.googleapis.com/v1/projects/bao-hang-1291/databases/(default)/documents/realtime/issues",
                JSONObject().put("fields", fields),
                token = sessionStore.accessToken,
                eventName = "firestore_issue_signal_$reason",
                connectTimeout = 5_000,
                readTimeout = 8_000
            )
        }.onFailure { diagnostics.warn("issue_realtime_signal_deferred", mapOf("reason" to reason, "error" to (it.message ?: it.javaClass.simpleName).take(240))) }
    }

    private suspend fun kickWorkerBestEffort(reason: String) = withContext(Dispatchers.IO) {
        if (workerUrl.isBlank() || sessionStore.accessToken.isBlank()) return@withContext
        runCatching {
            val body = JSONObject()
                .put("action", "worker-kick")
                .put("id_token", sessionStore.accessToken)
                .put("reason", reason)
            requestJson("POST", workerUrl, body, token = null, eventName = "worker_kick_$reason", connectTimeout = 5_000, readTimeout = 10_000)
        }.onFailure { diagnostics.warn("worker_kick_deferred", mapOf("reason" to reason, "error" to (it.message ?: it.javaClass.simpleName).take(240))) }
    }

    private fun requestJson(
        method: String,
        url: String,
        body: JSONObject?,
        token: String?,
        eventName: String,
        connectTimeout: Int = 15_000,
        readTimeout: Int = 30_000
    ): JSONObject {
        val raw = executeJson(method, url, body, token, eventName, connectTimeout, readTimeout)
        return if (raw.isBlank()) JSONObject() else JSONObject(raw)
    }

    private fun requestForm(url: String, values: Map<String, String>, eventName: String): JSONObject {
        val started = System.nanoTime()
        val connection = URI(url).toURL().openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 15_000
            connection.readTimeout = 30_000
            connection.doOutput = true
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=utf-8")
            val encoded = values.entries.joinToString("&") { "${urlEncode(it.key)}=${urlEncode(it.value)}" }
            connection.outputStream.use { it.write(encoded.toByteArray(StandardCharsets.UTF_8)) }
            return parseJsonResponse(connection, started, eventName, "POST")
        } finally {
            connection.disconnect()
        }
    }

    private fun executeJson(
        method: String,
        url: String,
        body: JSONObject?,
        token: String?,
        eventName: String,
        connectTimeout: Int,
        readTimeout: Int
    ): String {
        val started = System.nanoTime()
        val connection = URI(url).toURL().openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = connectTimeout
            connection.readTimeout = readTimeout
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            if (!token.isNullOrBlank()) connection.setRequestProperty("Authorization", "Bearer $token")
            if (body != null) {
                connection.doOutput = true
                connection.outputStream.use { it.write(body.toString().toByteArray(StandardCharsets.UTF_8)) }
            }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val response = stream?.bufferedReader()?.use(BufferedReader::readText).orEmpty()
            logHttp(started, eventName, method, code)
            if (code !in 200..299) throw apiError(code, response, eventName)
            return response
        } catch (error: ApiException) {
            throw error
        } catch (error: Exception) {
            diagnostics.error("http_exception", error, mapOf("event" to eventName, "method" to method))
            throw error
        } finally {
            connection.disconnect()
        }
    }

    private fun parseJsonResponse(connection: HttpURLConnection, started: Long, eventName: String, method: String): JSONObject {
        val code = connection.responseCode
        val stream = if (code in 200..299) connection.inputStream else connection.errorStream
        val response = stream?.bufferedReader()?.use(BufferedReader::readText).orEmpty()
        logHttp(started, eventName, method, code)
        if (code !in 200..299) throw apiError(code, response, eventName)
        return if (response.isBlank()) JSONObject() else JSONObject(response)
    }

    private fun logHttp(started: Long, eventName: String, method: String, status: Int) {
        diagnostics.info(
            "http_result",
            mapOf(
                "event" to eventName,
                "method" to method,
                "status" to status,
                "elapsed_ms" to (System.nanoTime() - started) / 1_000_000,
                "test_role" to (sessionStore.adminTestRole?.wire ?: "")
            )
        )
    }

    private fun apiError(status: Int, response: String, eventName: String): ApiException {
        val parsed = runCatching { JSONObject(response) }.getOrNull()
        val message = parsed?.optString("message").orEmpty()
            .ifBlank { parsed?.optString("error").orEmpty() }
            .ifBlank { parsed?.optString("error_description").orEmpty() }
            .ifBlank { response.ifBlank { "Lỗi máy chủ $status" } }
        val code = parsed?.optString("code").orEmpty()
            .ifBlank { parsed?.optJSONObject("error")?.optString("message").orEmpty() }
        diagnostics.warn("http_error", mapOf("event" to eventName, "status" to status, "code" to code, "message" to message.take(500)))
        return ApiException(status, translateError(message, status), code)
    }

    private fun translateError(message: String, status: Int): String {
        val normalized = message.uppercase()
        return when {
            "INVALID_LOGIN_CREDENTIALS" in normalized || "INVALID_PASSWORD" in normalized || "EMAIL_NOT_FOUND" in normalized -> "Sai mã nhân viên hoặc mật khẩu"
            "USER_DISABLED" in normalized || "USER_INACTIVE" in normalized -> "Tài khoản đã ngừng hoạt động"
            "TOKEN_EXPIRED" in normalized || status == 401 -> "Phiên đăng nhập đã hết hạn"
            "FORBIDDEN" in normalized -> "Tài khoản không có quyền thực hiện thao tác này"
            "WITHDRAW_WINDOW_EXPIRED" in normalized -> "Đã quá 30 giây nên không thể thu hồi báo thiếu"
            "REPORT_NOT_FOUND" in normalized -> "Không tìm thấy lượt báo cần thu hồi"
            else -> message
        }
    }

    private fun requireConfigured() {
        if (!isConfigured) throw ApiException(503, "Ứng dụng chưa được nối với máy chủ mới")
    }

    private fun employeeEmail(code: String): String {
        val raw = code.trim().lowercase()
        val safe = raw.replace(Regex("[^a-z0-9._-]"), "-")
        if (safe.isBlank() || safe != raw) throw ApiException(400, "Mã nhân viên không hợp lệ")
        return "$safe@bao-hang-1291.local"
    }

    private fun urlEncode(value: String): String = URLEncoder.encode(value, StandardCharsets.UTF_8.name())

    private fun JSONObject.putNullable(key: String, value: String?): JSONObject =
        if (value.isNullOrBlank()) put(key, JSONObject.NULL) else put(key, value)

    private fun JSONObject.optNullableString(key: String): String? =
        if (!has(key) || isNull(key)) null else optString(key).ifBlank { null }

    private fun JSONArray?.toStockIssues(): List<StockIssue> {
        val array = this ?: JSONArray()
        return buildList { for (i in 0 until array.length()) add(StockIssue.fromJson(array.getJSONObject(i))) }
    }

    private fun JSONArray?.toSkuItems(): List<SkuItem> {
        val array = this ?: JSONArray()
        return buildList {
            for (i in 0 until array.length()) {
                val item = array.getJSONObject(i)
                add(SkuItem(item.getString("sku"), item.getString("product_name")))
            }
        }
    }

    private fun Long?.orDefault(default: Long): Long = this ?: default

    private fun parseScalar(raw: String): Any = when {
        raw == "true" -> true
        raw == "false" -> false
        raw.matches(Regex("^-?\\d+$")) -> raw.toLongOrNull() ?: raw
        raw.startsWith("\"") -> runCatching { JSONArray("[$raw]").get(0) }.getOrDefault(raw)
        else -> raw
    }
}

class ApiException(val statusCode: Int, override val message: String, val code: String = "") : Exception(message)