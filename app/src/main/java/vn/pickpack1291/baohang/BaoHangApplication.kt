package vn.pickpack1291.baohang

import android.app.Activity
import android.app.Application
import android.os.Bundle
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import vn.pickpack1291.baohang.data.AppDatabase
import vn.pickpack1291.baohang.data.AppRepository
import vn.pickpack1291.baohang.data.SessionStore
import vn.pickpack1291.baohang.diagnostics.DiagnosticsLogger
import vn.pickpack1291.baohang.network.ApiClient
import vn.pickpack1291.baohang.notifications.NotificationHelper
import vn.pickpack1291.baohang.realtime.RealtimeInvalidationStore
import vn.pickpack1291.baohang.realtime.RealtimeSignalBus
import vn.pickpack1291.baohang.sync.SyncScheduler

class BaoHangApplication : Application() {
    lateinit var database: AppDatabase
        private set
    lateinit var session: SessionStore
        private set
    lateinit var diagnostics: DiagnosticsLogger
        private set
    lateinit var api: ApiClient
        private set
    lateinit var repository: AppRepository
        private set

    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onCreate() {
        super.onCreate()
        diagnostics = DiagnosticsLogger(this)
        diagnostics.info("app_start", mapOf("version" to BuildConfig.VERSION_NAME, "build_type" to BuildConfig.BUILD_TYPE, "ota_channel" to BuildConfig.OTA_CHANNEL))
        database = AppDatabase(this)
        session = SessionStore(this)
        api = ApiClient(session, diagnostics)
        repository = AppRepository(this, database, session, api, diagnostics)
        NotificationHelper.createChannels(this)

        // No fixed heartbeat. Network work is event-driven or tied to a durable non-report outbox item.
        SyncScheduler.removeLegacyPeriodic(this)
        if (session.isLoggedIn && database.outboxCount() > 0) {
            SyncScheduler.enqueueOutbox(this)
            diagnostics.info("outbox_sync_scheduled_on_start", mapOf("pending" to database.outboxCount()))
        }

        registerActivityLifecycleCallbacks(object : ActivityLifecycleCallbacks {
            override fun onActivityResumed(activity: Activity) {
                if (!session.isLoggedIn) return
                val pending = RealtimeInvalidationStore.consume(this@BaoHangApplication)
                if (pending.isEmpty()) return
                diagnostics.info("realtime_pending_resume", mapOf("topics" to pending.sorted().joinToString(",")))
                appScope.launch {
                    pending.forEach { topic ->
                        runCatching {
                            when (topic) {
                                "catalog" -> repository.syncCatalog()
                                "issues" -> if (session.effectiveRole.canProcessIssues) repository.loadActiveIssues() else repository.loadMyIssues()
                                "staff" -> repository.refreshProfile()
                                "config" -> Unit
                            }
                        }.onFailure {
                            diagnostics.warn("realtime_pending_refresh_failed", mapOf("topic" to topic, "error" to it.message.orEmpty()))
                            RealtimeInvalidationStore.markPending(this@BaoHangApplication, topic)
                        }.onSuccess {
                            if (!RealtimeSignalBus.publish(topic)) RealtimeInvalidationStore.markPending(this@BaoHangApplication, topic)
                        }
                    }
                }
            }
            override fun onActivityCreated(activity: Activity, state: Bundle?) = Unit
            override fun onActivityStarted(activity: Activity) = Unit
            override fun onActivityPaused(activity: Activity) = Unit
            override fun onActivityStopped(activity: Activity) = Unit
            override fun onActivitySaveInstanceState(activity: Activity, state: Bundle) = Unit
            override fun onActivityDestroyed(activity: Activity) = Unit
        })

        FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
            if (session.isLoggedIn) repository.registerDeviceAsync(token)
        }.addOnFailureListener { diagnostics.error("fcm_token_read_failed", it) }
    }
}
