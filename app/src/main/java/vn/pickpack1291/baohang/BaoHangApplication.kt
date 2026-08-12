package vn.pickpack1291.baohang

import android.app.Application
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.google.firebase.messaging.FirebaseMessaging
import vn.pickpack1291.baohang.data.AppDatabase
import vn.pickpack1291.baohang.data.AppRepository
import vn.pickpack1291.baohang.data.SessionStore
import vn.pickpack1291.baohang.diagnostics.DiagnosticsLogger
import vn.pickpack1291.baohang.network.ApiClient
import vn.pickpack1291.baohang.notifications.NotificationHelper
import vn.pickpack1291.baohang.sync.SyncWorker
import java.util.concurrent.TimeUnit

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
        scheduleSync()

        FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
            if (session.isLoggedIn) repository.registerDeviceAsync(token)
        }.addOnFailureListener { diagnostics.error("fcm_token_read_failed", it) }
    }

    private fun scheduleSync() {
        val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        val request = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES).setConstraints(constraints).build()
        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
            SyncWorker.PERIODIC_WORK,
            ExistingPeriodicWorkPolicy.KEEP,
            request
        )
        diagnostics.info("periodic_sync_scheduled", mapOf("minutes" to 15))
    }
}
