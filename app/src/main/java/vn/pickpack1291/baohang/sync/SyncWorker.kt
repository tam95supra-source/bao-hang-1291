package vn.pickpack1291.baohang.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import vn.pickpack1291.baohang.BaoHangApplication

class SyncWorker(appContext: Context, params: WorkerParameters) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val app = applicationContext as BaoHangApplication
        if (!app.session.isLoggedIn) return Result.success()
        return try {
            val before = app.repository.outboxCount()
            if (before > 0) app.repository.flushOutbox()
            if (app.repository.outboxCount() > 0) {
                app.diagnostics.warn("sync_worker_retry", mapOf("pending" to app.repository.outboxCount()))
                return Result.retry()
            }
            if (inputData.getBoolean(KEY_FORCE_CATALOG, false)) app.repository.syncCatalogIfStale()
            app.diagnostics.info("sync_worker_success", mapOf("outbox_before" to before, "catalog_forced" to inputData.getBoolean(KEY_FORCE_CATALOG, false)))
            Result.success()
        } catch (error: Exception) {
            app.diagnostics.error("sync_worker_failed", error)
            Result.retry()
        }
    }

    companion object {
        // Kept only so upgraded installations can cancel the legacy periodic work name.
        const val PERIODIC_WORK = "bao_hang_periodic_sync"
        const val KEY_FORCE_CATALOG = "force_catalog"
    }
}
