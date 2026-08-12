package vn.pickpack1291.baohang.sync

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

object SyncScheduler {
    const val OUTBOX_WORK = "bao_hang_outbox_sync"
    const val CATALOG_WORK = "bao_hang_catalog_refresh"

    private fun constraints() = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .build()

    fun enqueueOutbox(context: Context) {
        val request = OneTimeWorkRequestBuilder<SyncWorker>()
            .setConstraints(constraints())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(OUTBOX_WORK, ExistingWorkPolicy.KEEP, request)
    }

    fun enqueueCatalog(context: Context) {
        val request = OneTimeWorkRequestBuilder<SyncWorker>()
            .setConstraints(constraints())
            .setInputData(Data.Builder().putBoolean(SyncWorker.KEY_FORCE_CATALOG, true).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(CATALOG_WORK, ExistingWorkPolicy.KEEP, request)
    }

    fun removeLegacyPeriodic(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(SyncWorker.PERIODIC_WORK)
    }
}
