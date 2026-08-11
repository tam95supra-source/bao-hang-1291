package vn.pickpack1291.baohang.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import vn.pickpack1291.baohang.BaoHangApplication

class SyncWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result {
        val app = applicationContext as BaoHangApplication
        if (!app.session.isLoggedIn || !app.api.isConfigured) return Result.success()
        return runCatching {
            app.repository.flushOutbox()
            app.repository.syncCatalog()
            Result.success()
        }.getOrElse { Result.retry() }
    }

    companion object {
        const val PERIODIC_WORK = "bao_hang_periodic_sync"
        const val KEY_FORCE_CATALOG = "force_catalog"
    }
}
