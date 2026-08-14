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

/** Firestore is the third and final online authority. Every mutation uses a server transaction. */
class EmergencyFirestoreClient(private val session: SessionStore) {
    class EmergencyException(val code: String, message: String) : IOException(message)

    private val auth = FirebaseAuth.getInstance()
    private val db = FirebaseFirestore.getInstance()
    private val jsonType = "application/json; charset=utf-8".toMediaType()
    private val http = OkHttpClient.Builder().connectTimeout(8, TimeUnit.SECONDS).readTimeout(12, TimeUnit.SECONDS).writeTimeout(12, TimeUnit.SECONDS).build()

    val isProvisioned: Boolean get() = auth.currentUser?.uid == session.profile?.id

    suspend fun provision(): Boolean {
        val bearer = session.accessToken
        if (bearer.isBlank()) return false
        val request = Request.Builder()
            .url(BuildConfig.SUPABASE_URL.trimEnd('/') + "/functions/v1/emergency-auth")
            .post(JSONObject().put("device_id", session.deviceId).toString().toRequestBody(jsonType))
            .header("Authorization", "Bearer $bearer")
            .header("apikey", BuildConfig.SUPABASE_ANON_KEY)
            .header("Content-Type", "application/json")
            .build()
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
        if (signed.uid != session.profile?.id) {
            auth.signOut()
            throw EmergencyException("UID_MISMATCH", "Emergency identity không khớp tài khoản")
        }
        return true
    }

    fun signOut() = auth.signOut()

    suspend fun reportShortage(skuRaw: String, productName: String, requestId: String): ReportResult {
        requireProvisioned()
        val sku = skuRaw.trim().uppercase()
        val key = skuKey(sku)
        val actor = session.profile ?: throw EmergencyException("AUTH_REQUIRED", "Chưa đăng nhập")
        val stateRef = db.collection("emergency_state").document(key)
        val opsRef = db.collection("emergency_ops_state").document(key)
        val eventRef = db.collection("emergency_events").document(requestId)

        val result = db.runTransaction { tx ->
            val previousEvent = tx.get(eventRef)
            if (previousEvent.exists()) return@runTransaction issueFromEvent(previousEvent.data ?: emptyMap(), productName)
            val stateDoc = tx.get(stateRef)
            val active = stateDoc.exists() && stateDoc.getString("status") in setOf("OPEN", "CLAIMED")
            val issueId = if (active) stateDoc.getString("issue_id").orEmpty() else deterministicIssueId(requestId)
            val status = if (active) stateDoc.getString("status").orEmpty() else "OPEN"
            val version = if (active) stateDoc.getLong("issue_version") ?: 1L else 1L
            val claimedBy = if (active) stateDoc.getString("claimed_by_account_id").orEmpty() else ""
            val now = FieldValue.serverTimestamp()

            if (!active) {
                tx.set(stateRef, mapOf(
                    "sku" to sku, "issue_id" to issueId, "status" to "OPEN", "issue_version" to 1L,
                    "claimed_by_account_id" to "", "updated_at" to now, "authority_mode" to "FIREBASE_EMERGENCY"
                ))
                tx.set(opsRef, mapOf(
                    "sku" to sku, "issue_id" to issueId, "status" to "OPEN", "report_count" to 1L,
                    "issue_version" to 1L, "claimed_by_account_id" to "", "updated_at" to now,
                    "authority_mode" to "FIREBASE_EMERGENCY"
                ))
            } else {
                tx.set(opsRef, mapOf("report_count" to FieldValue.increment(1), "updated_at" to now), SetOptions.merge())
            }
            val projectionId = userProjectionId(actor.id, issueId)
            tx.set(db.collection("emergency_user_state").document(projectionId), mapOf(
                "target_user_id" to actor.id, "issue_id" to issueId, "sku" to sku, "status" to status,
                "issue_version" to version, "updated_at" to now, "authority_mode" to "FIREBASE_EMERGENCY"
            ), SetOptions.merge())
            val payload = canonicalJson(mapOf("sku" to sku, "product_name" to productName, "resulting_status" to status))
            tx.set(eventRef, eventMap(requestId, "REPORT_SHORTAGE", issueId, sku, version, payload))
            EmergencyResult(issueId, sku, productName, status, version, claimedBy, 1)
        }.await()
        return ReportResult(result.toStockIssue(), false, "Đã ghi nhận báo thiếu qua Firebase Emergency")
    }

    suspend fun claimIssue(issueId: String, requestId: String): StockIssue = mutateIssue(issueId, requestId, "CLAIM")
    suspend fun updateIssue(issueId: String, action: String, requestId: String): StockIssue = mutateIssue(issueId, requestId, when (action.uppercase()) { "AVAILABLE" -> "AVAILABLE"; "NOT_FOUND", "SKIP_ALLOWED" -> "SKIP_ALLOWED"; else -> throw EmergencyException("INVALID_ACTION", "Trạng thái Emergency không hợp lệ") })
    suspend fun reassignIssue(issueId: String, newAssigneeId: String, reason: String, requestId: String): StockIssue = mutateIssue(issueId, requestId, "REASSIGN", newAssigneeId, reason)

    private suspend fun mutateIssue(issueId: String, requestId: String, eventType: String, newAssigneeId: String = "", reason: String = ""): StockIssue {
        requireProvisioned()
        val actor = session.profile ?: throw EmergencyException("AUTH_REQUIRED", "Chưa đăng nhập")
        val role = session.effectiveRole.wire
        if (eventType == "REASSIGN" && role !in setOf("ADMIN_INVENT", "ADMIN")) throw EmergencyException("FORBIDDEN", "Không có quyền điều phối lại")
        if (eventType != "REASSIGN" && eventType != "CLAIM" && role !in setOf("INVENT", "ADMIN_INVENT", "ADMIN")) throw EmergencyException("FORBIDDEN", "Không có quyền xử lý")

        val stateQuery = db.collection("emergency_state").whereEqualTo("issue_id", issueId).limit(1).get().await()
        val stateSnap = stateQuery.documents.firstOrNull() ?: throw EmergencyException("ISSUE_NOT_FOUND", "Không tìm thấy issue Emergency")
        val key = stateSnap.id
        val userProjections = if (eventType in setOf("AVAILABLE", "SKIP_ALLOWED")) {
            db.collection("emergency_user_state").whereEqualTo("issue_id", issueId).get().await().documents
        } else emptyList()
        val stateRef = db.collection("emergency_state").document(key)
        val opsRef = db.collection("emergency_ops_state").document(key)
        val eventRef = db.collection("emergency_events").document(requestId)

        val result = db.runTransaction { tx ->
            val prior = tx.get(eventRef)
            if (prior.exists()) return@runTransaction issueFromEvent(prior.data ?: emptyMap(), "")
            val state = tx.get(stateRef)
            if (!state.exists() || state.getString("issue_id") != issueId) throw EmergencyException("ISSUE_CONFLICT", "Issue Emergency đã thay đổi")
            val sku = state.getString("sku").orEmpty()
            val oldStatus = state.getString("status").orEmpty()
            var claimedBy = state.getString("claimed_by_account_id").orEmpty()
            var version = state.getLong("issue_version") ?: 1L
            var newStatus = oldStatus
            var changed = false

            when (eventType) {
                "CLAIM" -> {
                    if (oldStatus !in setOf("OPEN", "CLAIMED")) throw EmergencyException("ISSUE_ALREADY_RESOLVED", "Issue đã kết thúc")
                    if (claimedBy.isNotBlank() && claimedBy != actor.id) throw EmergencyException("ALREADY_CLAIMED", "Issue đã có người nhận")
                    if (oldStatus != "CLAIMED" || claimedBy.isBlank()) { newStatus = "CLAIMED"; claimedBy = actor.id; version++; changed = true }
                }
                "AVAILABLE", "SKIP_ALLOWED" -> {
                    if (oldStatus !in setOf("OPEN", "CLAIMED")) {
                        if (oldStatus == eventType) return@runTransaction EmergencyResult(issueId, sku, "", oldStatus, version, claimedBy, 0)
                        throw EmergencyException("INVALID_TRANSITION", "Issue đã kết thúc ở trạng thái khác")
                    }
                    if (role == "INVENT" && claimedBy != actor.id) throw EmergencyException("ISSUE_NOT_OWNED", "Issue không thuộc người xử lý hiện tại")
                    newStatus = eventType; version++; changed = true
                }
                "REASSIGN" -> {
                    if (oldStatus !in setOf("OPEN", "CLAIMED")) throw EmergencyException("ISSUE_ALREADY_RESOLVED", "Issue đã kết thúc")
                    if (newAssigneeId.isBlank() || reason.trim().length < 3) throw EmergencyException("REASSIGN_REQUIRED", "Thiếu người nhận hoặc lý do")
                    newStatus = "CLAIMED"; claimedBy = newAssigneeId; version++; changed = true
                }
            }
            val now = FieldValue.serverTimestamp()
            if (changed) {
                tx.update(stateRef, mapOf("status" to newStatus, "issue_version" to version, "claimed_by_account_id" to claimedBy, "updated_at" to now))
                tx.set(opsRef, mapOf("status" to newStatus, "issue_version" to version, "claimed_by_account_id" to claimedBy, "updated_at" to now), SetOptions.merge())
                if (newStatus in setOf("AVAILABLE", "SKIP_ALLOWED")) {
                    userProjections.forEach { projection ->
                        tx.update(projection.reference, mapOf("status" to newStatus, "issue_version" to version, "updated_at" to now))
                    }
                }
            }
            val payloadMap = linkedMapOf<String, Any>("resulting_status" to newStatus)
            if (newAssigneeId.isNotBlank()) payloadMap["new_assignee_account_id"] = newAssigneeId
            if (reason.isNotBlank()) payloadMap["reason"] = reason.trim()
            val payload = canonicalJson(payloadMap)
            tx.set(eventRef, eventMap(requestId, eventType, issueId, sku, version, payload))
            EmergencyResult(issueId, sku, "", newStatus, version, claimedBy, 0)
        }.await()
        return result.toStockIssue()
    }

    suspend fun issueBoard(): IssueBoard {
        requireProvisioned()
        if (session.effectiveRole.wire !in setOf("INVENT", "ADMIN_INVENT", "ADMIN")) throw EmergencyException("FORBIDDEN", "Không có quyền xem board")
        val docs = db.collection("emergency_ops_state").get().await().documents
        val issues = docs.mapNotNull { d ->
            val status = d.getString("status") ?: return@mapNotNull null
            StockIssue(
                id=d.getString("issue_id").orEmpty(), sku=d.getString("sku").orEmpty(), productName="", status=IssueStatus.from(status),
                reportCount=(d.getLong("report_count")?:1L).toInt(), reportedAt="", updatedAt=d.getTimestamp("updated_at")?.toDate()?.toInstant()?.toString().orEmpty(),
                assignedId=d.getString("claimed_by_account_id")?.ifBlank { null }, issueVersion=d.getLong("issue_version")?:1L
            )
        }
        return IssueBoard(issues.filter { it.status==IssueStatus.OPEN },issues.filter { it.status.isClaimedBucket },issues.filter { !it.status.isOpenBucket })
    }

    suspend fun myIssues(): List<StockIssue> {
        requireProvisioned()
        val uid = auth.currentUser?.uid ?: return emptyList()
        return db.collection("emergency_user_state").whereEqualTo("target_user_id",uid).get().await().documents.mapNotNull { d ->
            val issue=d.getString("issue_id").orEmpty(); if(issue.isBlank()) return@mapNotNull null
            StockIssue(id=issue,sku=d.getString("sku").orEmpty(),productName="",status=IssueStatus.from(d.getString("status")),reportCount=1,reportedAt="",updatedAt=d.getTimestamp("updated_at")?.toDate()?.toInstant()?.toString().orEmpty(),issueVersion=d.getLong("issue_version")?:1L)
        }
    }

    private fun requireProvisioned() {
        if (!isProvisioned) throw EmergencyException("NOT_PROVISIONED", "Thiết bị chưa được provision Emergency trước sự cố")
    }

    private fun eventMap(eventId:String,eventType:String,issueId:String,sku:String,version:Long,payload:String):Map<String,Any?> {
        val actor=session.profile ?: throw EmergencyException("AUTH_REQUIRED","Chưa đăng nhập")
        return mapOf(
            "event_id" to eventId,"source_mode" to "FIREBASE_EMERGENCY","event_type" to eventType,"occurred_at_device" to Instant.now().toString(),
            "accepted_at_authority" to FieldValue.serverTimestamp(),"actor_account_id" to actor.id,"actor_role" to session.effectiveRole.wire,"device_id" to session.deviceId,
            "issue_id" to issueId,"sku" to sku,"issue_version" to version,"payload_json" to payload,"payload_sha256" to sha256(payload),
            "sheet_ack_at" to null,"reconciliation_status" to "PENDING_SHEET"
        )
    }

    private fun issueFromEvent(data:Map<String,Any>,productName:String):EmergencyResult = EmergencyResult(
        issueId=data["issue_id"]?.toString().orEmpty(),sku=data["sku"]?.toString().orEmpty(),productName=productName,
        status=runCatching { JSONObject(data["payload_json"]?.toString().orEmpty()).optString("resulting_status") }.getOrDefault("").ifBlank { "OPEN" },
        version=(data["issue_version"] as? Number)?.toLong()?:1L,claimedBy="",reportCount=1
    )

    private data class EmergencyResult(val issueId:String,val sku:String,val productName:String,val status:String,val version:Long,val claimedBy:String,val reportCount:Int) {
        fun toStockIssue()=StockIssue(id=issueId,sku=sku,productName=productName,status=IssueStatus.from(status),reportCount=reportCount,reportedAt=Instant.now().toString(),updatedAt=Instant.now().toString(),assignedId=claimedBy.ifBlank { null },issueVersion=version)
    }

    private fun skuKey(sku:String)=sha256(sku.uppercase())
    private fun userProjectionId(userId:String,issueId:String)=sha256("$userId:$issueId")
    private fun deterministicIssueId(requestId:String)=UUID.nameUUIDFromBytes("bao-hang-1291-emergency:$requestId".toByteArray(StandardCharsets.UTF_8)).toString()
    private fun sha256(value:String)=MessageDigest.getInstance("SHA-256").digest(value.toByteArray(StandardCharsets.UTF_8)).joinToString(""){"%02x".format(it)}
    private fun canonicalJson(values:Map<String,Any>):String { val o=JSONObject(); values.toSortedMap().forEach{o.put(it.key,it.value)}; return o.toString() }
}
