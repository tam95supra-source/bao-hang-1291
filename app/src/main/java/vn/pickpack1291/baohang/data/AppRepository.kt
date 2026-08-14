package vn.pickpack1291.baohang.data

import android.content.Context
import android.os.Build
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import org.json.JSONArray
import org.json.JSONObject
import vn.pickpack1291.baohang.BuildConfig
import vn.pickpack1291.baohang.diagnostics.DiagnosticsLogger
import vn.pickpack1291.baohang.network.ApiClient
import vn.pickpack1291.baohang.network.DirectRpcClient
import vn.pickpack1291.baohang.sync.SyncScheduler
import java.time.Duration
import java.time.Instant
import java.util.UUID

class AppRepository(
    private val context: Context,
    private val database: AppDatabase,
    val session: SessionStore,
    private val api: ApiClient,
    private val diagnostics: DiagnosticsLogger
) {
    class MutationUnavailableException(message: String, cause: Throwable? = null) : Exception(message, cause)

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val direct = DirectRpcClient(session)

    suspend fun login(employeeCode: String, password: String): UserProfile {
        val auth = api.signIn(employeeCode.trim(), password)
        session.save(auth)
        diagnostics.info("session_saved", mapOf("employee_code" to auth.profile.employeeCode, "role" to auth.profile.role.wire))
        registerCurrentDevice()
        // Legacy queues created by older APKs are drained with their original request IDs.
        // This version never creates a new business mutation while no authority can confirm it.
        if (database.outboxCount() > 0) SyncScheduler.enqueueOutbox(context)
        if (catalogNeedsRefresh()) SyncScheduler.enqueueCatalog(context)
        return auth.profile
    }

    fun logout() {
        diagnostics.info("logout", mapOf("employee_code" to (session.profile?.employeeCode ?: "")))
        session.clear()
    }

    suspend fun refreshProfile(): UserProfile {
        val profile = api.sessionProfile()
        session.updateProfile(profile)
        diagnostics.info("profile_refreshed", mapOf("role" to profile.role.wire))
        return profile
    }

    fun setAdminTestRole(role: UserRole?) {
        session.setAdminTestRole(role)
        diagnostics.info("admin_test_role", mapOf("effective_role" to (role?.wire ?: "ADMIN")))
    }

    fun searchSkus(query: String) = database.searchSkus(query)
    suspend fun searchSkusOnline(query: String) = runCatching { direct.searchSkus(query) }.getOrElse { api.searchSkus(query) }

    suspend fun reportShortage(sku: String): ReportResult {
        val requestId = UUID.randomUUID().toString()
        diagnostics.info("shortage_submit", mapOf("sku" to sku, "request_id" to requestId))
        return try {
            val result = direct.reportShortage(sku, requestId)
            database.upsertIssues(listOf(result.issue))
            diagnostics.info("shortage_submit_success", mapOf("sku" to sku, "issue_id" to result.issue.id, "aggregated" to result.wasAlreadyReported, "authority" to "POSTGRES_RPC"))
            result
        } catch (error: Exception) {
            diagnostics.warn("shortage_authority_unavailable", mapOf("sku" to sku, "error" to error.message.orEmpty().take(240)))
            throw MutationUnavailableException(
                "Không thể xác nhận báo thiếu với hệ thống. Dữ liệu chưa được gửi; vui lòng kiểm tra kết nối và thử lại.",
                error
            )
        }
    }

    suspend fun loadMyIssues(): List<StockIssue> = try {
        direct.myIssues().also(database::upsertIssues)
    } catch (_: Exception) {
        try { api.myIssues().also(database::upsertIssues) } catch (_: Exception) { database.cachedIssues(100) }
    }

    suspend fun loadActiveIssues(): List<StockIssue> = try {
        direct.issueBoard().let { (it.open + it.claimed).also(database::upsertIssues) }
    } catch (_: Exception) {
        try { api.activeIssues().also(database::upsertIssues) } catch (_: Exception) { database.cachedIssues(200).filter { it.status.isOpenBucket } }
    }

    suspend fun loadIssueBoard(): IssueBoard = try {
        direct.issueBoard().also { database.upsertIssues(it.open + it.claimed + it.recent) }
    } catch (directError: Exception) {
        diagnostics.warn("board_rpc_fallback_edge", mapOf("error" to directError.message.orEmpty().take(200)))
        api.issueBoard().also { database.upsertIssues(it.open + it.claimed + it.recent) }
    }

    suspend fun claimIssue(issueId: String): StockIssue = try {
        direct.claimIssue(issueId).also {
            database.upsertIssues(listOf(it))
            diagnostics.info("issue_claim", mapOf("issue_id" to issueId, "sku" to it.sku, "version" to it.issueVersion, "authority" to "POSTGRES_RPC"))
        }
    } catch (error: Exception) {
        throw MutationUnavailableException("Không thể xác nhận nhận xử lý. Chưa có thay đổi nào được xác nhận cho thao tác này.", error)
    }

    suspend fun reassignIssue(issueId: String, newAssigneeId: String, reason: String): StockIssue = try {
        direct.reassignIssue(issueId, newAssigneeId, reason).also {
            database.upsertIssues(listOf(it))
            diagnostics.info("issue_reassign", mapOf("issue_id" to issueId, "new_assignee" to newAssigneeId, "version" to it.issueVersion, "authority" to "POSTGRES_RPC"))
        }
    } catch (error: Exception) {
        throw MutationUnavailableException("Không thể xác nhận điều phối lại. Dữ liệu chưa được ghi nhận.", error)
    }

    suspend fun updateIssue(issueId: String, action: String): StockIssue {
        diagnostics.info("issue_update_start", mapOf("issue_id" to issueId, "action" to action))
        return try {
            direct.updateIssue(issueId, action).also {
                database.upsertIssues(listOf(it))
                diagnostics.info("issue_update_success", mapOf("issue_id" to issueId, "sku" to it.sku, "status" to it.status.wire, "version" to it.issueVersion, "authority" to "POSTGRES_RPC"))
            }
        } catch (error: Exception) {
            throw MutationUnavailableException("Không thể xác nhận trạng thái SKU. Dữ liệu chưa được ghi nhận.", error)
        }
    }

    suspend fun pendingAlerts(): List<PendingAlert> = runCatching { direct.pendingAlerts() }.getOrElse { api.pendingAlerts() }
    suspend fun markAlertReceived(eventId: String) = runCatching { direct.markAlertReceived(eventId) }.getOrElse { api.markAlertReceived(eventId) }
    suspend fun markAlertDisplayed(eventId: String) = runCatching { direct.markAlertDisplayed(eventId) }.getOrElse { api.markAlertDisplayed(eventId) }

    suspend fun acknowledgeAlert(eventId: String) {
        try {
            direct.acknowledgeAlert(eventId)
            diagnostics.info("alert_ack", mapOf("event_id" to eventId, "authority" to "POSTGRES_RPC"))
        } catch (directError: Exception) {
            try {
                api.acknowledgeAlert(eventId)
                diagnostics.info("alert_ack", mapOf("event_id" to eventId, "authority" to "EDGE"))
            } catch (edgeError: Exception) {
                diagnostics.warn("alert_ack_unconfirmed", mapOf("event_id" to eventId, "error" to edgeError.message.orEmpty().take(200)))
                throw MutationUnavailableException("Không thể xác nhận cảnh báo khi chưa kết nối được hệ thống.", edgeError)
            }
        }
    }

    fun catalogNeedsRefresh(maxAgeHours: Long = 6): Boolean {
        if (database.skuCount() == 0) return true
        val last = database.metadata("catalog_last_sync") ?: return true
        return runCatching { Duration.between(Instant.parse(last), Instant.now()).toHours() >= maxAgeHours }.getOrDefault(true)
    }

    suspend fun syncCatalogIfStale(maxAgeHours: Long = 6): Int = if (catalogNeedsRefresh(maxAgeHours)) syncCatalog() else 0

    suspend fun syncCatalog(onPage: ((count: Int) -> Unit)? = null): Int {
        var syncUntil: String? = null
        var afterSku: String? = null
        var count = 0
        var revision: Long? = null
        var hasMore = true
        diagnostics.info("catalog_sync_start", mapOf("mode" to "active_full"))
        while (hasMore) {
            val page = api.catalogPage(afterSku, null, syncUntil)
            syncUntil = page.syncUntil
            if (revision == null) {
                revision = page.revision
                val localRevision = database.metadata("catalog_revision")?.toLongOrNull()
                if (localRevision != page.revision) database.clearSkus()
            }
            database.upsertSkus(page.items)
            count += page.items.size
            afterSku = page.items.lastOrNull()?.sku ?: afterSku
            onPage?.invoke(count)
            hasMore = page.hasMore && page.items.isNotEmpty()
        }
        syncUntil?.let { database.setMetadata("catalog_last_sync", it) }
        revision?.let { database.setMetadata("catalog_revision", it.toString()) }
        diagnostics.info("catalog_sync_success", mapOf("received" to count, "local_count" to database.skuCount(), "revision" to (revision ?: 0L)))
        return count
    }

    suspend fun flushOutbox(): Int {
        var sent = 0
        database.outbox().forEach { item ->
            try {
                when (item.action) {
                    "report-shortage" -> direct.reportShortage(
                        item.payload.optString("sku"),
                        item.payload.optString("client_request_id")
                    )
                    "ack-alert" -> direct.acknowledgeAlert(item.payload.optString("event_id"))
                    else -> api.invoke(item.action, item.payload)
                }
                database.removeOutbox(item.id)
                sent++
            } catch (error: Exception) {
                database.failOutbox(item.id, error.message.orEmpty())
                diagnostics.warn("legacy_outbox_flush_paused", mapOf("action" to item.action, "sent" to sent, "error" to error.message.orEmpty().take(200), "pending" to database.outboxCount()))
                return sent
            }
        }
        if (sent > 0) diagnostics.info("legacy_outbox_flush_success", mapOf("sent" to sent, "remaining" to database.outboxCount()))
        return sent
    }

    fun outboxCount(): Int = database.outboxCount()

    suspend fun registerCurrentDevice() {
        val token = FirebaseMessaging.getInstance().token.await()
        val device = "${Build.MANUFACTURER} ${Build.MODEL}"
        val version = "${BuildConfig.VERSION_NAME} [${BuildConfig.OTA_CHANNEL.uppercase()}]"
        runCatching { direct.registerDevice(token, device, version) }.getOrElse { api.registerDevice(token, device, version) }
        session.markDeviceRegistered()
        diagnostics.info("device_registered", mapOf("device" to device, "version" to BuildConfig.VERSION_NAME))
    }

    fun registerDeviceAsync(token: String) {
        scope.launch {
            val device = "${Build.MANUFACTURER} ${Build.MODEL}"
            val version = "${BuildConfig.VERSION_NAME} [${BuildConfig.OTA_CHANNEL.uppercase()}]"
            runCatching {
                runCatching { direct.registerDevice(token, device, version) }.getOrElse { api.registerDevice(token, device, version) }
                session.markDeviceRegistered()
                diagnostics.info("fcm_token_registered", mapOf("version" to BuildConfig.VERSION_NAME))
            }.onFailure { diagnostics.error("fcm_token_register_failed", it) }
        }
    }

    suspend fun sendDiagnosticLog(): JSONObject {
        diagnostics.info("diagnostic_upload_requested", mapOf("role" to session.effectiveRole.wire, "version" to BuildConfig.VERSION_NAME))
        val bundle = diagnostics.prepareUpload() ?: return JSONObject().put("uploaded", false).put("message", "Chưa có log để gửi")
        val result = api.uploadDiagnosticLog(bundle)
        if (result.optBoolean("uploaded", false)) diagnostics.clearAfterConfirmedUpload()
        return result
    }

    fun skuCount() = database.skuCount()
    suspend fun getOperationalConfig() = api.getOperationalConfig()
    suspend fun saveOperationalConfig(config: OperationalConfig) = api.saveOperationalConfig(config)
    suspend fun getConfig() = api.getConfig()
    suspend fun saveConfig(config: AppConfig) = api.saveConfig(config)
    suspend fun importSkus(items: List<SkuItem>) = api.importSkus(items)

    suspend fun replaceCatalog(items: List<SkuItem>, sourceName: String): JSONObject {
        val result = api.replaceCatalog(items, sourceName)
        database.clearSkus()
        database.setMetadata("catalog_revision", "0")
        syncCatalog()
        return result
    }
    suspend fun listUsers() = api.listUsers()
    suspend fun updateUser(user: UserProfile, employeeCode: String, fullName: String, contractor: String, role: UserRole, active: Boolean, newPassword: String) =
        api.updateUser(user.id, employeeCode, fullName, contractor, role, active, newPassword).also {
            diagnostics.info("user_updated", mapOf("target_employee_code" to it.employeeCode, "target_role" to it.role.wire, "active" to it.active))
        }
    suspend fun importUsers(items: List<ImportUserRow>) = api.importUsers(items)
    suspend fun syncGoogleSheet() = api.syncGoogleSheet()
    suspend fun reportsSummary() = api.reportsSummary()
    suspend fun issueHistory(limit: Int = 200): JSONArray = api.issueHistory(limit)
}
