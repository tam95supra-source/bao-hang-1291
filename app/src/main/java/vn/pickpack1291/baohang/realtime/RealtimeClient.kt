package vn.pickpack1291.baohang.realtime

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import vn.pickpack1291.baohang.BuildConfig
import vn.pickpack1291.baohang.diagnostics.DiagnosticsLogger
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.min

/**
 * Minimal Supabase Realtime protocol v1 client.
 *
 * It only exists while the visible Activity is started. There is no background
 * heartbeat/service. Database state remains authoritative; callbacks are hints
 * that cause the UI to refetch canonical rows through the authenticated API.
 */
class RealtimeClient(
    private val diagnostics: DiagnosticsLogger,
    private val onIssueChanged: () -> Unit,
    private val onCatalogChanged: () -> Unit,
    private val onStaffChanged: () -> Unit,
    private val onStatus: (Status) -> Unit = {}
) {
    enum class Status { CONNECTING, ONLINE, FALLBACK, OFFLINE }

    private val refs = AtomicLong(1)
    private val scheduler = Executors.newSingleThreadScheduledExecutor { runnable ->
        Thread(runnable, "bao-hang-realtime").apply { isDaemon = true }
    }
    private val client = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    @Volatile private var running = false
    @Volatile private var socket: WebSocket? = null
    @Volatile private var accessToken = ""
    @Volatile private var reconnectAttempt = 0
    private var heartbeat: ScheduledFuture<*>? = null
    private var reconnect: ScheduledFuture<*>? = null
    private val joins = mutableMapOf<String, String>()

    fun start(token: String) {
        accessToken = token
        if (running) {
            updateAccessToken(token)
            return
        }
        running = true
        reconnectAttempt = 0
        connect()
    }

    fun stop() {
        running = false
        reconnect?.cancel(false)
        reconnect = null
        heartbeat?.cancel(false)
        heartbeat = null
        joins.clear()
        socket?.close(1000, "foreground stopped")
        socket = null
        onStatus(Status.OFFLINE)
        diagnostics.info("realtime_stopped")
    }

    fun updateAccessToken(token: String) {
        accessToken = token
        val ws = socket ?: return
        synchronized(joins) {
            joins.forEach { (topic, joinRef) ->
                val ref = nextRef()
                ws.send(
                    JSONObject()
                        .put("topic", topic)
                        .put("event", "access_token")
                        .put("payload", JSONObject().put("access_token", token))
                        .put("ref", ref)
                        .put("join_ref", joinRef)
                        .toString()
                )
            }
        }
    }

    private fun connect() {
        if (!running || accessToken.isBlank()) return
        onStatus(Status.CONNECTING)
        val endpoint = BuildConfig.SUPABASE_URL.trimEnd('/')
            .replaceFirst("https://", "wss://")
            .replaceFirst("http://", "ws://") +
            "/realtime/v1/websocket?apikey=" +
            URLEncoder.encode(BuildConfig.SUPABASE_ANON_KEY, StandardCharsets.UTF_8.name()) +
            "&vsn=1.0.0"
        val request = Request.Builder().url(endpoint).build()
        socket = client.newWebSocket(request, Listener())
        diagnostics.info("realtime_connecting", mapOf("protocol" to "1.0.0"))
    }

    private inner class Listener : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            if (!running) {
                webSocket.close(1000, "not foreground")
                return
            }
            reconnectAttempt = 0
            synchronized(joins) { joins.clear() }
            join(webSocket, ISSUE_TOPIC)
            join(webSocket, CATALOG_TOPIC)
            join(webSocket, STAFF_TOPIC)
            heartbeat?.cancel(false)
            heartbeat = scheduler.scheduleAtFixedRate({
                if (running) sendHeartbeat()
            }, 20, 20, TimeUnit.SECONDS)
            diagnostics.info("realtime_socket_open")
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            val message = runCatching { JSONObject(text) }.getOrNull() ?: return
            val event = message.optString("event")
            val topic = message.optString("topic")
            when (event) {
                "phx_reply" -> {
                    val payload = message.optJSONObject("payload") ?: return
                    if (payload.optString("status") == "ok" && topic.startsWith("realtime:")) {
                        onStatus(Status.ONLINE)
                    } else if (payload.optString("status") == "error") {
                        val reason = payload.optJSONObject("response")?.optString("reason").orEmpty()
                        diagnostics.warn("realtime_join_rejected", mapOf("reason" to reason.take(240)))
                        onStatus(Status.FALLBACK)
                    }
                }
                "broadcast" -> {
                    val payload = message.optJSONObject("payload") ?: return
                    when {
                        topic == ISSUE_TOPIC && payload.optString("event") == "issue_changed" -> onIssueChanged()
                        topic == CATALOG_TOPIC && payload.optString("event") == "catalog_changed" -> onCatalogChanged()
                        topic == STAFF_TOPIC && payload.optString("event") == "staff_changed" -> onStaffChanged()
                    }
                }
                "phx_error", "phx_close" -> {
                    diagnostics.warn("realtime_channel_closed", mapOf("event" to event, "topic" to topic))
                    onStatus(Status.FALLBACK)
                }
                "system" -> {
                    val payload = message.optJSONObject("payload") ?: return
                    if (payload.optString("status") == "error") {
                        diagnostics.warn("realtime_system_error", mapOf("message" to payload.optString("message").take(240)))
                        onStatus(Status.FALLBACK)
                    }
                }
            }
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            if (!running) return
            diagnostics.warn("realtime_failure", mapOf("error" to (t.message ?: t.javaClass.simpleName).take(240)))
            onStatus(Status.FALLBACK)
            scheduleReconnect()
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            if (!running) return
            diagnostics.warn("realtime_closed", mapOf("code" to code, "reason" to reason.take(120)))
            onStatus(Status.FALLBACK)
            scheduleReconnect()
        }
    }

    private fun join(ws: WebSocket, topic: String) {
        val ref = nextRef()
        synchronized(joins) { joins[topic] = ref }
        val config = JSONObject()
            .put("broadcast", JSONObject().put("ack", false).put("self", false))
            .put("presence", JSONObject().put("enabled", false))
            .put("postgres_changes", org.json.JSONArray())
            .put("private", true)
        val payload = JSONObject().put("config", config).put("access_token", accessToken)
        ws.send(
            JSONObject()
                .put("topic", topic)
                .put("event", "phx_join")
                .put("payload", payload)
                .put("ref", ref)
                .put("join_ref", ref)
                .toString()
        )
    }

    private fun sendHeartbeat() {
        socket?.send(
            JSONObject()
                .put("topic", "phoenix")
                .put("event", "heartbeat")
                .put("payload", JSONObject())
                .put("ref", nextRef())
                .put("join_ref", JSONObject.NULL)
                .toString()
        )
    }

    private fun scheduleReconnect() {
        if (!running || reconnect?.isDone == false) return
        heartbeat?.cancel(false)
        heartbeat = null
        val attempt = reconnectAttempt++
        val delayMs = listOf(1_000L, 2_000L, 5_000L, 10_000L)[min(attempt, 3)]
        reconnect = scheduler.schedule({
            reconnect = null
            if (running) connect()
        }, delayMs, TimeUnit.MILLISECONDS)
    }

    private fun nextRef(): String = refs.getAndIncrement().toString()

    companion object {
        private const val ISSUE_TOPIC = "realtime:site:1291:issues"
        private const val CATALOG_TOPIC = "realtime:site:1291:catalog"
        private const val STAFF_TOPIC = "realtime:site:1291:staff"
    }
}
