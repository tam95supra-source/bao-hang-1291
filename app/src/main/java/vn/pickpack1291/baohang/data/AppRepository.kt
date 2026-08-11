package vn.pickpack1291.baohang.data

import android.content.Context
import android.os.Build
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import org.json.JSONObject
import vn.pickpack1291.baohang.BuildConfig
import vn.pickpack1291.baohang.network.ApiClient
import java.time.Instant
import java.util.UUID

class AppRepository(
    private val context: Context,
    private val database: AppDatabase,
    private val session: SessionStore,
    private val api: ApiClient
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    suspend fun login(employeeCode: String, password: String): UserProfile {
        val auth = api.signIn(employeeCode.trim(), password)
        session.save(auth)
        registerCurrentDevice()
        return auth.profile
    }

    fun logout() = session.clear()

    fun searchSkus(query: String) = database.searchSkus(query)

    suspend fun reportShortage(sku: String): ReportResult {
        val requestId = UUID.randomUUID().toString()
        return try {
            val result = api.reportShortage(sku, requestId)
            database.upsertIssues(listOf(result.issue))
            result
        } catch (error: Exception) {
            val localId = "offline-${UUID.randomUUID()}"
            val now = Instant.now().toString()
            val item = database.searchSkus(sku, 1).firstOrNull()
            val issue = StockIssue(
                localId, sku, item?.productName.orEmpty(), IssueStatus.OPEN, 1, now, now,
                latestReporterName = session.profile?.fullName.orEmpty(),
                latestMessage = "Đang chờ đồng bộ"
            )
            database.upsertIssues(listOf(issue))
            database.enqueue(
                "report-shortage",
                JSONObject().put("sku", sku).put("client_request_id", requestId)
            )
            ReportResult(issue, false, "Đã lưu trên máy; ứng dụng sẽ tự gửi khi có mạng")
        }
    }

    suspend fun loadMyIssues(): List<StockIssue> = try {
        api.myIssues().also(database::upsertIssues)
    } catch (_: Exception) {
        database.cachedIssues(100)
    }

    suspend fun loadActiveIssues(): List<StockIssue> = try {
        api.activeIssues().also(database::upsertIssues)
    } catch (_: Exception) {
        database.cachedIssues(200).filter { it.status != IssueStatus.CLOSED }
    }

    suspend fun updateIssue(issueId: String, action: String): StockIssue {
        val issue = api.updateIssue(issueId, action)
        database.upsertIssues(listOf(issue))
        return issue
    }

    suspend fun syncCatalog(onPage: ((count: Int) -> Unit)? = null): Int {
        val updatedSince = if (database.skuCount() == 0) null else database.metadata("catalog_last_sync")
        var syncUntil: String? = null
        var count = 0
        var afterSku: String? = null
        var hasMore = true
        while (hasMore) {
            val page = api.catalogPage(afterSku, updatedSince, syncUntil)
            syncUntil = page.syncUntil
            database.upsertSkus(page.items)
            count += page.items.size
            afterSku = page.items.lastOrNull()?.sku ?: afterSku
            onPage?.invoke(count)
            hasMore = page.hasMore && page.items.isNotEmpty()
        }
        syncUntil?.let { database.setMetadata("catalog_last_sync", it) }
        return count
    }

    suspend fun flushOutbox(): Int {
        var sent = 0
        database.outbox().forEach { item ->
            try {
                api.invoke(item.action, item.payload)
                database.removeOutbox(item.id)
                sent++
            } catch (error: Exception) {
                database.failOutbox(item.id, error.message.orEmpty())
                return sent
            }
        }
        return sent
    }

    suspend fun acknowledgeAlert(eventId: String) {
        try {
            api.acknowledgeAlert(eventId)
        } catch (_: Exception) {
            database.enqueue("ack-alert", JSONObject().put("event_id", eventId))
        }
    }

    suspend fun registerCurrentDevice() {
        val token = FirebaseMessaging.getInstance().token.await()
        api.registerDevice(token, "${Build.MANUFACTURER} ${Build.MODEL}", BuildConfig.VERSION_NAME)
        session.markDeviceRegistered()
    }

    fun registerDeviceAsync(token: String) {
        scope.launch {
            runCatching {
                api.registerDevice(token, "${Build.MANUFACTURER} ${Build.MODEL}", BuildConfig.VERSION_NAME)
                session.markDeviceRegistered()
            }
        }
    }

    fun skuCount() = database.skuCount()
    suspend fun getConfig() = api.getConfig()
    suspend fun saveConfig(config: AppConfig) = api.saveConfig(config)
    suspend fun importSkus(items: List<SkuItem>) = api.importSkus(items)
    suspend fun importUsers(items: List<ImportUserRow>) = api.importUsers(items)
    suspend fun syncGoogleSheet() = api.syncGoogleSheet()
}
