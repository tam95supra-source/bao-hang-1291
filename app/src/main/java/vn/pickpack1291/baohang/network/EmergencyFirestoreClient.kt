package vn.pickpack1291.baohang.network

import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.SetOptions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import vn.pickpack1291.baohang.BuildConfig
import vn.pickpack1291.baohang.data.IssueBoard
import vn.pickpack1291.baohang.data.IssueStatus
import vn.pickpack1291.baohang.data.ReportResult
import vn.pickpack1291.baohang.data.SessionStore
import vn.pickpack1291.baohang.data.StockIssue
import java.io.IOException
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * Firestore is the third and final online authority.
 * Every accepted mutation is one transaction containing a monotonic sequence update + immutable event.
 * Picker-visible state never contains report_count or assignee metadata.
 */
class EmergencyFirestoreClient(private val session: SessionStore) {
    class EmergencyException(val code: String, message: String) : IOException(message)

    private val auth = FirebaseAuth.getInstance()
    private val db = FirebaseFirestore.getInstance()
    private val jsonType = "application/json; charset=utf-8".toMediaType()
    private val http = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS).readTimeout(12, TimeUnit.SECONDS).writeTimeout(12, TimeUnit.SECONDS).build()
    private val controlRef get() = db.collection("emergency_control").document("sequence")

    val isProvisioned: Boolean get() = auth.currentUser?.uid == session.profile?.id

    suspend fun provision(): Boolean {
        val bearer = session.accessToken
        if (bearer.isBlank()) return false
        val request = Request.Builder()
            .url(BuildConfig.SUPABASE_URL.trimEnd('/') + "/functions/v1/emergency-auth")
            .post(JSONObject().put("device_id", session.deviceId).toString().toRequestBody(jsonType))
            .header("Authorization", "Bearer $bearer")
            .header("apikey", BuildConfig.SUPABASE_ANON_KEY)
            .header("Content-Type", "application/json").build()
        val result = withContext(Dispatchers.IO) {
            http.newCall(request).execute().use { response ->
                val text = response.body?.string().orEmpty()
                if (!response.isSuccessful) throw EmergencyException("HTTP_${response.code}", "Emergency auth HTTP ${response.code}")
                JSONObject(text)
            }
        }
        val token = result.optString("custom_token")
        if (token.isBlank()) throw EmergencyException("INVALID_TOKEN", "Emergency token không hợp lệ")
        val signed = auth.signInWithCustomToken(token).await().user ?: throw EmergencyException("AUTH_FAILED", "Không thể provision Emergency account")
        if (signed.uid != session.profile?.id) { auth.signOut(); throw EmergencyException("UID_MISMATCH", "Emergency identity không khớp tài khoản") }
        return true
    }

    suspend fun provisionBackup(firebaseEmail: String, password: String, expectedUid: String): Boolean {
        if (firebaseEmail.isBlank() || password.isBlank() || expectedUid.isBlank()) return false
        val signed = auth.signInWithEmailAndPassword(firebaseEmail, password).await().user
            ?: throw EmergencyException("AUTH_FAILED", "Không thể provision Emergency backup account")
        if (signed.uid != expectedUid) { auth.signOut(); throw EmergencyException("UID_MISMATCH", "Emergency backup identity không khớp") }
        signed.getIdToken(true).await()
        return true
    }

    fun signOut() = auth.signOut()

    suspend fun reportShortage(skuRaw: String, productName: String, requestId: String): ReportResult {
        requireProvisioned()
        val sku = skuRaw.trim().uppercase()
        val actor = session.profile ?: throw EmergencyException("AUTH_REQUIRED", "Chưa đăng nhập")
        val key = skuKey(sku)
        val stateRef = db.collection("emergency_state").document(key)
        val opsRef = db.collection("emergency_ops_state").document(key)
        val eventRef = db.collection("emergency_events").document(requestId)

        val result = db.runTransaction { tx ->
            val prior = tx.get(eventRef)
            if (prior.exists()) return@runTransaction issueFromEvent(prior.data ?: emptyMap(), productName)
            val control = tx.get(controlRef)
            val state = tx.get(stateRef)
            val active = state.exists() && state.getString("status") in setOf("OPEN", "CLAIMED")
            val issueId = if (active) state.getString("issue_id").orEmpty() else deterministicIssueId(requestId)
            val status = if (active) state.getString("status").orEmpty() else "OPEN"
            val version = if (active) state.getLong("issue_version") ?: 1L else 1L
            val projectionRef = db.collection("emergency_user_state").document(userProjectionId(actor.id, issueId))
            val projection = tx.get(projectionRef)
            val sequence = (if (control.exists()) control.getLong("next_sequence") ?: 0L else 0L) + 1L
            val acked = if (control.exists()) control.getLong("sheet_acked_sequence") ?: 0L else 0L
            val now = FieldValue.serverTimestamp()
            val payload = canonicalJson(mapOf("sku" to sku, "product_name" to productName, "resulting_status" to status))
            val event = eventMap(requestId, sequence, "REPORT_SHORTAGE", issueId, sku, version, payload)

            tx.set(eventRef, event)
            tx.set(controlRef, mapOf("next_sequence" to sequence, "sheet_acked_sequence" to acked, "last_event_id" to requestId, "updated_at" to now))
            if (!active) {
                tx.set(stateRef, sharedState(sku, issueId, "OPEN", 1L, requestId, sequence, now))
                tx.set(opsRef, opsState(sku, issueId, "OPEN", 1L, "", 1L, requestId, sequence, now))
            } else {
                tx.set(opsRef, mapOf(
                    "report_count" to FieldValue.increment(1L), "updated_at" to now,
                    "last_event_id" to requestId, "last_emergency_sequence" to sequence
                ), SetOptions.merge())
            }
            if (!projection.exists() || projection.getString("issue_id") != issueId) {
                tx.set(projectionRef, userState(actor.id, issueId, sku, status, version, requestId, sequence, now))
            }
            EmergencyResult(issueId, sku, productName, status, version, "", 1)
        }.await()
        return ReportResult(result.toStockIssue(), false, "Đã ghi nhận báo thiếu qua Firebase Emergency")
    }

    suspend fun claimIssue(issueId: String, requestId: String): StockIssue = mutateIssue(issueId, requestId, "CLAIM")
    suspend fun updateIssue(issueId: String, action: String, requestId: String): StockIssue = mutateIssue(
        issueId, requestId, when (action.uppercase()) {
            "AVAILABLE" -> "AVAILABLE"
            "NOT_FOUND", "SKIP_ALLOWED" -> "SKIP_ALLOWED"
            else -> throw EmergencyException("INVALID_ACTION", "Trạng thái Emergency không hợp lệ")
        }
    )
    suspend fun reassignIssue(issueId: String, newAssigneeId: String, reason: String, requestId: String): StockIssue =
        mutateIssue(issueId, requestId, "REASSIGN", newAssigneeId, reason)

    private suspend fun mutateIssue(issueId: String, requestId: String, eventType: String, newAssigneeId: String = "", reason: String = ""): StockIssue {
        requireProvisioned()
        val actor = session.profile ?: throw EmergencyException("AUTH_REQUIRED", "Chưa đăng nhập")
        val role = session.effectiveRole.wire
        if (eventType == "REASSIGN" && role !in setOf("ADMIN_INVENT", "ADMIN")) throw EmergencyException("FORBIDDEN", "Không có quyền điều phối lại")
        if (eventType != "REASSIGN" && role !in setOf("INVENT", "ADMIN_INVENT", "ADMIN")) throw EmergencyException("FORBIDDEN", "Không có quyền xử lý")

        val stateSnap = db.collection("emergency_state").whereEqualTo("issue_id", issueId).limit(1).get().await().documents.firstOrNull()
            ?: throw EmergencyException("ISSUE_NOT_FOUND", "Không tìm thấy issue Emergency")
        val key = stateSnap.id
        val projections = if (eventType in setOf("AVAILABLE", "SKIP_ALLOWED"))
            db.collection("emergency_user_state").whereEqualTo("issue_id", issueId).get().await().documents
        else emptyList()
        val stateRef = db.collection("emergency_state").document(key)
        val opsRef = db.collection("emergency_ops_state").document(key)
        val eventRef = db.collection("emergency_events").document(requestId)

        val result = db.runTransaction { tx ->
            val prior = tx.get(eventRef)
            if (prior.exists()) return@runTransaction issueFromEvent(prior.data ?: emptyMap(), "")
            val control = tx.get(controlRef)
            val state = tx.get(stateRef)
            val ops = tx.get(opsRef)
            if (!state.exists() || !ops.exists() || state.getString("issue_id") != issueId || ops.getString("issue_id") != issueId)
                throw EmergencyException("ISSUE_CONFLICT", "Issue Emergency đã thay đổi")
            val sku = state.getString("sku").orEmpty()
            val oldStatus = state.getString("status").orEmpty()
            var claimedBy = ops.getString("claimed_by_account_id").orEmpty()
            var version = state.getLong("issue_version") ?: 1L
            var newStatus = oldStatus

            when (eventType) {
                "CLAIM" -> {
                    if (oldStatus !in setOf("OPEN", "CLAIMED")) throw EmergencyException("ISSUE_ALREADY_RESOLVED", "Issue đã kết thúc")
                    if (claimedBy.isNotBlank() && claimedBy != actor.id) throw EmergencyException("ALREADY_CLAIMED", "Issue đã có người nhận")
                    if (oldStatus == "CLAIMED" && claimedBy == actor.id) return@runTransaction EmergencyResult(issueId, sku, "", oldStatus, version, claimedBy, (ops.getLong("report_count") ?: 1L).toInt())
                    newStatus = "CLAIMED"; claimedBy = actor.id; version++
                }
                "AVAILABLE", "SKIP_ALLOWED" -> {
                    if (oldStatus !in setOf("OPEN", "CLAIMED")) {
                        if (oldStatus == eventType) return@runTransaction EmergencyResult(issueId, sku, "", oldStatus, version, claimedBy, (ops.getLong("report_count") ?: 1L).toInt())
                        throw EmergencyException("INVALID_TRANSITION", "Issue đã kết thúc ở trạng thái khác")
                    }
                    if (role == "INVENT" && claimedBy != actor.id) throw EmergencyException("ISSUE_NOT_OWNED", "Issue không thuộc người xử lý hiện tại")
                    newStatus = eventType; version++
                }
                "REASSIGN" -> {
                    if (oldStatus !in setOf("OPEN", "CLAIMED")) throw EmergencyException("ISSUE_ALREADY_RESOLVED", "Issue đã kết thúc")
                    if (newAssigneeId.isBlank() || reason.trim().length < 3) throw EmergencyException("REASSIGN_REQUIRED", "Thiếu người nhận hoặc lý do")
                    newStatus = "CLAIMED"; claimedBy = newAssigneeId; version++
                }
            }

            val sequence = (if (control.exists()) control.getLong("next_sequence") ?: 0L else 0L) + 1L
            val acked = if (control.exists()) control.getLong("sheet_acked_sequence") ?: 0L else 0L
            val now = FieldValue.serverTimestamp()
            val payloadMap = linkedMapOf<String, Any>("resulting_status" to newStatus, "claimed_by_account_id" to claimedBy)
            if (newAssigneeId.isNotBlank()) payloadMap["new_assignee_account_id"] = newAssigneeId
            if (reason.isNotBlank()) payloadMap["reason"] = reason.trim()
            val payload = canonicalJson(payloadMap)

            tx.set(eventRef, eventMap(requestId, sequence, eventType, issueId, sku, version, payload))
            tx.set(controlRef, mapOf("next_sequence" to sequence, "sheet_acked_sequence" to acked, "last_event_id" to requestId, "updated_at" to now))
            tx.update(stateRef, sharedState(sku, issueId, newStatus, version, requestId, sequence, now))
            tx.update(opsRef, mapOf(
                "status" to newStatus, "issue_version" to version, "claimed_by_account_id" to claimedBy,
                "updated_at" to now, "last_event_id" to requestId, "last_emergency_sequence" to sequence
            ))
            if (newStatus in setOf("AVAILABLE", "SKIP_ALLOWED")) {
                projections.forEach { p ->
                    tx.update(p.reference, mapOf(
                        "status" to newStatus, "issue_version" to version, "updated_at" to now,
                        "last_event_id" to requestId, "last_emergency_sequence" to sequence
                    ))
                }
            }
            EmergencyResult(issueId, sku, "", newStatus, version, claimedBy, (ops.getLong("report_count") ?: 1L).toInt())
        }.await()
        return result.toStockIssue()
    }

    suspend fun issueBoard(): IssueBoard {
        requireProvisioned()
        if (session.effectiveRole.wire !in setOf("INVENT", "ADMIN_INVENT", "ADMIN")) throw EmergencyException("FORBIDDEN", "Không có quyền xem board")
        val issues = db.collection("emergency_ops_state").get().await().documents.mapNotNull { d ->
            val status = d.getString("status") ?: return@mapNotNull null
            StockIssue(
                id = d.getString("issue_id").orEmpty(), sku = d.getString("sku").orEmpty(), productName = "", status = IssueStatus.from(status),
                reportCount = (d.getLong("report_count") ?: 1L).toInt(), reportedAt = "", updatedAt = d.getTimestamp("updated_at")?.toDate()?.toInstant()?.toString().orEmpty(),
                assignedId = d.getString("claimed_by_account_id")?.ifBlank { null }, issueVersion = d.getLong("issue_version") ?: 1L
            )
        }
        return IssueBoard(issues.filter { it.status == IssueStatus.OPEN }, issues.filter { it.status.isClaimedBucket }, issues.filter { !it.status.isOpenBucket })
    }

    suspend fun myIssues(): List<StockIssue> {
        requireProvisioned()
        val uid = auth.currentUser?.uid ?: return emptyList()
        return db.collection("emergency_user_state").whereEqualTo("target_user_id", uid).get().await().documents.mapNotNull { d ->
            val issue = d.getString("issue_id").orEmpty(); if (issue.isBlank()) return@mapNotNull null
            StockIssue(
                id = issue, sku = d.getString("sku").orEmpty(), productName = "", status = IssueStatus.from(d.getString("status")),
                reportCount = 1, reportedAt = "", updatedAt = d.getTimestamp("updated_at")?.toDate()?.toInstant()?.toString().orEmpty(),
                issueVersion = d.getLong("issue_version") ?: 1L
            )
        }
    }

    private fun requireProvisioned() {
        if (!isProvisioned) throw EmergencyException("NOT_PROVISIONED", "Thiết bị chưa được provision Emergency trước sự cố")
    }

    private fun sharedState(sku:String, issueId:String, status:String, version:Long, eventId:String, sequence:Long, now:Any) = mapOf(
        "sku" to sku, "issue_id" to issueId, "status" to status, "issue_version" to version,
        "updated_at" to now, "authority_mode" to "FIREBASE_EMERGENCY", "last_event_id" to eventId, "last_emergency_sequence" to sequence
    )
    private fun opsState(sku:String, issueId:String, status:String, reportCount:Long, claimedBy:String, version:Long, eventId:String, sequence:Long, now:Any) = mapOf(
        "sku" to sku, "issue_id" to issueId, "status" to status, "report_count" to reportCount, "issue_version" to version,
        "claimed_by_account_id" to claimedBy, "updated_at" to now, "authority_mode" to "FIREBASE_EMERGENCY",
        "last_event_id" to eventId, "last_emergency_sequence" to sequence
    )
    private fun userState(userId:String, issueId:String, sku:String, status:String, version:Long, eventId:String, sequence:Long, now:Any) = mapOf(
        "target_user_id" to userId, "issue_id" to issueId, "sku" to sku, "status" to status, "issue_version" to version,
        "updated_at" to now, "authority_mode" to "FIREBASE_EMERGENCY", "last_event_id" to eventId, "last_emergency_sequence" to sequence
    )

    private fun eventMap(eventId:String, sequence:Long, eventType:String, issueId:String, sku:String, version:Long, payload:String):Map<String,Any?> {
        val actor = session.profile ?: throw EmergencyException("AUTH_REQUIRED", "Chưa đăng nhập")
        return mapOf(
            "event_id" to eventId, "emergency_sequence" to sequence, "source_mode" to "FIREBASE_EMERGENCY", "event_type" to eventType,
            "occurred_at_device" to Instant.now().toString(), "accepted_at_authority" to FieldValue.serverTimestamp(),
            "actor_account_id" to actor.id, "actor_role" to session.effectiveRole.wire, "device_id" to session.deviceId,
            "issue_id" to issueId, "sku" to sku, "issue_version" to version, "payload_json" to payload, "payload_sha256" to sha256(payload),
            "sheet_ack_at" to null, "reconciliation_status" to "PENDING_SHEET"
        )
    }

    private fun issueFromEvent(data:Map<String,Any>, productName:String):EmergencyResult {
        val payload = runCatching { JSONObject(data["payload_json"]?.toString().orEmpty()) }.getOrDefault(JSONObject())
        return EmergencyResult(
            issueId = data["issue_id"]?.toString().orEmpty(), sku = data["sku"]?.toString().orEmpty(), productName = productName,
            status = payload.optString("resulting_status", "OPEN"), version = (data["issue_version"] as? Number)?.toLong() ?: 1L,
            claimedBy = payload.optString("claimed_by_account_id"), reportCount = 1
        )
    }

    private data class EmergencyResult(val issueId:String, val sku:String, val productName:String, val status:String, val version:Long, val claimedBy:String, val reportCount:Int) {
        fun toStockIssue() = StockIssue(
            id=issueId, sku=sku, productName=productName, status=IssueStatus.from(status), reportCount=reportCount,
            reportedAt=Instant.now().toString(), updatedAt=Instant.now().toString(), assignedId=claimedBy.ifBlank { null }, issueVersion=version
        )
    }

    private fun skuKey(sku:String)=sha256(sku.uppercase())
    private fun userProjectionId(userId:String,issueId:String)=sha256("$userId:$issueId")
    private fun deterministicIssueId(requestId:String)=UUID.nameUUIDFromBytes("bao-hang-1291-emergency:$requestId".toByteArray(StandardCharsets.UTF_8)).toString()
    private fun sha256(value:String)=MessageDigest.getInstance("SHA-256").digest(value.toByteArray(StandardCharsets.UTF_8)).joinToString(""){"%02x".format(it)}
    private fun canonicalJson(value:Map<String,Any>):String {
        val obj=JSONObject(); value.toSortedMap().forEach { (k,v) -> obj.put(k,v) }; return obj.toString()
    }
}
