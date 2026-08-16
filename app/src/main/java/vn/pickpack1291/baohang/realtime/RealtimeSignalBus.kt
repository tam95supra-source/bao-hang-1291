package vn.pickpack1291.baohang.realtime

import java.util.concurrent.CopyOnWriteArraySet

/**
 * In-process invalidation bus fed by FCM data messages.
 *
 * It never carries authoritative business data. Receivers only use the signal
 * to refetch canonical state from Neon through the authenticated API.
 */
object RealtimeSignalBus {
    enum class Topic { ISSUES, CATALOG, STAFF, CONFIG }

    private val listeners = CopyOnWriteArraySet<(Topic) -> Unit>()

    fun subscribe(listener: (Topic) -> Unit) {
        listeners += listener
    }

    fun unsubscribe(listener: (Topic) -> Unit) {
        listeners -= listener
    }

    fun publish(rawTopic: String): Boolean {
        val topic = when (rawTopic.trim().lowercase()) {
            "issues" -> Topic.ISSUES
            "catalog" -> Topic.CATALOG
            "staff" -> Topic.STAFF
            "config" -> Topic.CONFIG
            else -> return false
        }
        listeners.forEach { listener -> runCatching { listener(topic) } }
        return true
    }
}
