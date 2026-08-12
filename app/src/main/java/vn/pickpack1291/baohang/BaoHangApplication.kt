package vn.pickpack1291.baohang

import android.app.Application
import com.google.firebase.messaging.FirebaseMessaging
import vn.pickpack1291.baohang.data.AppDatabase
import vn.pickpack1291.baohang.data.AppRepository
import vn.pickpack1291.baohang.data.SessionStore
import vn.pickpack1291.baohang.diagnostics.DiagnosticsLogger
import vn.pickpack1291.baohang.network.ApiClient
import vn.pickpack1291.baohang.notifications.NotificationHelper
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

    override fun onCreate() {
        super.onCreate()
        diagnostics = DiagnosticsLogger(this)
        diagnostics.info("app_start", mapOf("version" to BuildConfig.VERSION_NAME, "build_type" to BuildConfig.BUILD_TYPE, "ota_channel" to BuildConfig.OTA_CHANNEL))
        database = AppDatabase(this)
        session = SessionStore(this)
        api = ApiClient(session, diagnostics)
        repository = AppRepository(this, database, session, api, diagnostics)
        NotificationHelper.createChannels(this)

        // Target: no fixed 15-minute heartbeat. Remove legacy periodic work once and only
        // schedule network work when a durable outbox item actually exists.
        SyncScheduler.removeLegacyPeriodic(this)
        if (session.isLoggedIn && database.outboxCount() > 0) {
            SyncScheduler.enqueueOutbox(this)
            diagnostics.info("outbox_sync_scheduled_on_start", mapOf("pending" to database.outboxCount()))
        }

        FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
            if (session.isLoggedIn) repository.registerDeviceAsync(token)
        }.addOnFailureListener { diagnostics.error("fcm_token_read_failed", it) }
    }
}
