package vn.pickpack1291.baohang

import android.app.Activity
import android.app.Application
import android.os.Bundle
import com.google.firebase.appcheck.FirebaseAppCheck
import com.google.firebase.appcheck.playintegrity.PlayIntegrityAppCheckProviderFactory
import com.google.firebase.messaging.FirebaseMessaging
import vn.pickpack1291.baohang.data.AppDatabase
import vn.pickpack1291.baohang.data.AppRepository
import vn.pickpack1291.baohang.data.SessionStore
import vn.pickpack1291.baohang.diagnostics.DiagnosticsLogger
import vn.pickpack1291.baohang.network.ApiClient
import vn.pickpack1291.baohang.notifications.NotificationHelper
import vn.pickpack1291.baohang.sync.SyncScheduler

class BaoHangApplication : Application(), Application.ActivityLifecycleCallbacks {
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

    @Volatile private var startedActivities = 0
    val isAppForeground: Boolean get() = startedActivities > 0

    override fun onCreate() {
        super.onCreate()
        registerActivityLifecycleCallbacks(this)
        diagnostics = DiagnosticsLogger(this)
        diagnostics.info("app_start", mapOf("version" to BuildConfig.VERSION_NAME, "build_type" to BuildConfig.BUILD_TYPE, "ota_channel" to BuildConfig.OTA_CHANNEL))

        // App Check is initialized now, but backend enforcement remains off until Beta/PDA
        // field telemetry confirms valid Play Integrity attestations for legitimate devices.
        FirebaseAppCheck.getInstance().installAppCheckProviderFactory(
            PlayIntegrityAppCheckProviderFactory.getInstance()
        )
        diagnostics.info("firebase_app_check_initialized", mapOf("provider" to "PLAY_INTEGRITY", "enforcement" to "FIELD_GATE"))

        database = AppDatabase(this)
        session = SessionStore(this)
        api = ApiClient(session, diagnostics)
        repository = AppRepository(this, database, session, api, diagnostics)
        NotificationHelper.createChannels(this)

        // No fixed background heartbeat. Network work is event-driven; only legacy durable
        // outbox rows created by older APKs may be drained with their original request IDs.
        SyncScheduler.removeLegacyPeriodic(this)
        if (session.isLoggedIn && database.outboxCount() > 0) {
            SyncScheduler.enqueueOutbox(this)
            diagnostics.info("legacy_outbox_sync_scheduled_on_start", mapOf("pending" to database.outboxCount()))
        }

        FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
            if (session.isLoggedIn) repository.registerDeviceAsync(token)
        }.addOnFailureListener { diagnostics.error("fcm_token_read_failed", it) }
    }

    override fun onActivityStarted(activity: Activity) { startedActivities++ }
    override fun onActivityStopped(activity: Activity) { startedActivities = (startedActivities - 1).coerceAtLeast(0) }
    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
    override fun onActivityResumed(activity: Activity) = Unit
    override fun onActivityPaused(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) = Unit
}
