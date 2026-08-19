package vn.pickpack1291.baohang.realtime

import android.content.Context

/** Persists FCM invalidation hints that arrived while no Activity listener was active. */
object RealtimeInvalidationStore {
    private const val PREFS = "bao_hang_realtime_pending"
    private val allowed = setOf("issues", "catalog", "staff", "config")

    @Synchronized
    fun markPending(context: Context, rawTopic: String) {
        val topic = rawTopic.trim().lowercase()
        if (topic !in allowed) return
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(topic, true)
            .apply()
    }

    @Synchronized
    fun consume(context: Context): Set<String> {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val pending = allowed.filterTo(linkedSetOf()) { prefs.getBoolean(it, false) }
        if (pending.isNotEmpty()) prefs.edit().clear().apply()
        return pending
    }
}
