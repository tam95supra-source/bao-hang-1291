package vn.pickpack1291.baohang.realtime

import android.util.Base64
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
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
 * Foreground-only Supabase Realtime client.
 *
 * Subscription scope is derived from the authenticated user's own profile before
 * channels are joined. Picker never joins board/staff/config channels; it only
 * joins its own user channel plus the non-sensitive catalog channel.
 */
class RealtimeClient(
    private val diagnostics: DiagnosticsLogger,
    private val onIssueChanged: () -> Unit,
    private val onCatalogChanged: () -> Unit,
    private val onStaffChanged: () -> Unit,
    private val onConfigChanged: () -> Unit,
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
    private var issueDebounce: ScheduledFuture<*>? = null
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
        issueDebounce?.cancel(false)
        issueDebounce = null
        synchronized(joins) { joins.clear() }
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
                ws.send(
                    JSONObject()
                        .put("topic", topic)
                        .put("event", "access_token")
                        .put("payload", JSONObject().put("access_token", token))
                        .put("ref", nextRef())
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
        socket = client.newWebSocket(Request.Builder().url(endpoint).build(), Listener())
        diagnostics.info("realtime_connecting", mapOf("protocol" to "1.0.0"))
    }

    private data class Identity(val userId: String, val role: String)

    private fun resolveIdentity(token: String): Identity {
        val userId = runCatching {
            val payload = token.split('.').getOrNull(1).orEmpty()
            val bytes = Base64.decode(payload, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
            JSONObject(String(bytes, StandardCharsets.UTF_8)).optString("sub")
        }.getOrDefault("")
        if (userId.isBlank()) return Identity("", "PICKER")

        val role = runCatching {
            val url = BuildConfig.SUPABASE_URL.trimEnd('/') +
                "/rest/v1/profiles?id=eq." + URLEncoder.encode(userId, StandardCharsets.UTF_8.name()) +
                "&select=role&limit=1"
            val request = Request.Builder()
                .url(url)
                .header("apikey", BuildConfig.SUPABASE_ANON_KEY)
                .header("Authorization", "Bearer $token")
                .header("Accept", "application/json")
                .build()
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return@use "PICKER"
                val rows = JSONArray(response.body?.string().orEmpty())
                rows.optJSONObject(0)?.optString("role", "PICKER") ?: "PICKER"
            }
        }.getOrDefault("PICKER").uppercase()
        return Identity(userId, role)
    }

    private inner class Listener : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            if (!running) {
                webSocket.close(1000, "not foreground")
                return
            }
            reconnectAttempt = 0
            synchronized(joins) { joins.clear() }
            val tokenSnapshot = accessToken
            scheduler.execute {
                val identity = resolveIdentity(tokenSnapshot)
                if (!running || socket !== webSocket) return@execute
                if (identity.userId.isBlank()) {
                    diagnostics.warn("realtime_identity_unresolved")
                    onStatus(Status.FALLBACK)
                    return@execute
                }
                join(webSocket, "$USER_TOPIC_PREFIX${identity.userId}")
                join(webSocket, CATALOG_TOPIC)
                if (identity.role in OPS_ROLES) {
                    join(webSocket, ISSUE_TOPIC)
                    join(webSocket, STAFF_TOPIC)
                }
                if (identity.role in CONFIG_ROLES) join(webSocket, CONFIG_TOPIC)
                diagnostics.info("realtime_scope_ready", mapOf("role" to identity.role, "channel_count" to synchronized(joins) { joins.size }))
            }
            heartbeat?.cancel(false)
            heartbeat = scheduler.scheduleAtFixedRate({ if (running) sendHeartbeat() }, 20, 20, TimeUnit.SECONDS)
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
                        diagnostics.warn("realtime_join_rejected", mapOf("topic" to safeTopic(topic), "reason" to reason.take(240)))
                        onStatus(Status.FALLBACK)
                    }
                }
                "broadcast" -> {
                    val payload = message.optJSONObject("payload") ?: return
                    val broadcastEvent = payload.optString("event")
                    when {
                        topic == ISSUE_TOPIC && broadcastEvent in setOf("issue_changed", "sla_overdue") -> debounceIssueHint()
                        topic.startsWith(USER_TOPIC_PREFIX) && broadcastEvent == "picker_status_changed" -> onIssueChanged()
                        topic == CATALOG_TOPIC && broadcastEvent == "catalog_changed" -> onCatalogChanged()
                        topic == STAFF_TOPIC && broadcastEvent == "staff_changed" -> onStaffChanged()
                        topic == CONFIG_TOPIC && broadcastEvent == "config_changed" -> onConfigChanged()
                    }
                }
                "phx_error", "phx_close" -> {
                    diagnostics.warn("realtime_channel_closed", mapOf("event" to event, "topic" to safeTopic(topic)))
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

    private fun debounceIssueHint() {
        synchronized(this) {
            issueDebounce?.cancel(false)
            issueDebounce = scheduler.schedule({
                issueDebounce = null
                if (running) onIssueChanged()
            }, 1200, TimeUnit.MILLISECONDS)
        }
    }

    private fun join(ws: WebSocket, topic: String) {
        val ref = nextRef()
        synchronized(joins) { joins[topic] = ref }
        val config = JSONObject()
            .put("broadcast", JSONObject().put("ack", false).put("self", false))
            .put("presence", JSONObject().put("enabled", false))
            .put("postgres_changes", JSONArray())
            .put("private", true)
        ws.send(
            JSONObject()
                .put("topic", topic)
                .put("event", "phx_join")
                .put("payload", JSONObject().put("config", config).put("access_token", accessToken))
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
        reconnect = scheduler.schedule({ reconnect = null; if (running) connect() }, delayMs, TimeUnit.MILLISECONDS)
    }

    private fun safeTopic(topic: String): String = when {
        topic.startsWith(USER_TOPIC_PREFIX) -> "realtime:user:1291:self"
        else -> topic.take(120)
    }

    private fun nextRef(): String = refs.getAndIncrement().toString()

    companion object {
        private const val USER_TOPIC_PREFIX = "realtime:user:1291:"
        private const val ISSUE_TOPIC = "realtime:site:1291:issues"
        private const val CATALOG_TOPIC = "realtime:site:1291:catalog"
        private const val STAFF_TOPIC = "realtime:site:1291:staff"
        private const val CONFIG_TOPIC = "realtime:site:1291:config"
        private val OPS_ROLES = setOf("INVENT", "ADMIN_INVENT", "ADMIN")
        private val CONFIG_ROLES = setOf("ADMIN_INVENT", "ADMIN")
    }
}
