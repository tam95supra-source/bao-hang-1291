package vn.pickpack1291.baohang.realtime

import java.util.concurrent.CopyOnWriteArraySet

/**
 * In-process realtime invalidation bus. Payload is marker-only; canonical
 * business data stays in Neon and is reconciled by sequence/version.
 */
object RealtimeSignalBus {
    enum class Topic { ISSUES, CATALOG, STAFF, CONFIG }

    data class Signal(
        val topic: Topic,
        val entityId: String = "",
        val entityVersion: Long = 0L,
        val seq: Long = 0L
    )

    private val listeners = CopyOnWriteArraySet<(Signal) -> Unit>()

    fun subscribe(listener: (Signal) -> Unit) { listeners += listener }
    fun unsubscribe(listener: (Signal) -> Unit) { listeners -= listener }

    fun publish(
        rawTopic: String,
        entityId: String = "",
        entityVersion: Long = 0L,
        seq: Long = 0L
    ): Boolean {
        val topic = when (rawTopic.trim().lowercase()) {
            "issues" -> Topic.ISSUES
            "catalog" -> Topic.CATALOG
            "staff" -> Topic.STAFF
            "config" -> Topic.CONFIG
            else -> return false
        }
        val signal = Signal(topic, entityId, entityVersion, seq)
        val current = listeners.toList()
        current.forEach { listener -> runCatching { listener(signal) } }
        return current.isNotEmpty()
    }
}
