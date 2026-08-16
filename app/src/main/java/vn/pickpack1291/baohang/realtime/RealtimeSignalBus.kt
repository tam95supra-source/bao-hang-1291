package vn.pickpack1291.baohang.realtime

import java.util.concurrent.CopyOnWriteArraySet

/**
 * Lightweight in-process invalidation bus fed by Firebase Cloud Messaging.
 * Business data never travels through this bus; listeners refetch canonical
 * state from Neon after receiving a topic hint.
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
