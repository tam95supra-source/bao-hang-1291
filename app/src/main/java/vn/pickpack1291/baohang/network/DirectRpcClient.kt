package vn.pickpack1291.baohang.network

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import vn.pickpack1291.baohang.BuildConfig
import vn.pickpack1291.baohang.data.IssueBoard
import vn.pickpack1291.baohang.data.PendingAlert
import vn.pickpack1291.baohang.data.ReportResult
import vn.pickpack1291.baohang.data.SessionStore
import vn.pickpack1291.baohang.data.SkuItem
import vn.pickpack1291.baohang.data.StockIssue
import java.io.IOException
import java.util.concurrent.TimeUnit

class DirectRpcClient(private val session: SessionStore) {
    class RpcException(val status: Int, message: String) : IOException(message)

    private val jsonType = "application/json; charset=utf-8".toMediaType()
    private val client = OkHttpClient.Builder().connectTimeout(8, TimeUnit.SECONDS).readTimeout(12, TimeUnit.SECONDS).writeTimeout(12, TimeUnit.SECONDS).build()

    suspend fun reportShortage(sku: String, requestId: String): ReportResult {
        val json = rpcObject("report_shortage_rpc", JSONObject().put("p_sku", sku).put("p_client_request_id", requestId))
        return ReportResult(StockIssue.fromJson(json.getJSONObject("issue")), json.optBoolean("already_reported", false), json.optString("message", "Đã ghi nhận báo thiếu"))
    }
    suspend fun issueBoard(limit: Int = 250): IssueBoard {
        val json = rpcObject("issue_board_rpc", JSONObject().put("p_limit", limit))
        fun rows(name: String): List<StockIssue> { val a=json.optJSONArray(name)?:JSONArray(); return (0 until a.length()).mapNotNull{a.optJSONObject(it)?.let(StockIssue::fromJson)} }
        return IssueBoard(rows("open"), rows("claimed"), rows("recent"))
    }
    suspend fun myIssues(limit: Int = 200): List<StockIssue> { val a=rpcArray("my_issues_rpc",JSONObject().put("p_limit",limit)); return (0 until a.length()).mapNotNull{a.optJSONObject(it)?.let(StockIssue::fromJson)} }
    suspend fun issueDetail(issueId: String): StockIssue = StockIssue.fromJson(rpcObject("issue_detail_rpc", JSONObject().put("p_issue_id", issueId)))
    suspend fun claimIssue(issueId: String, requestId: String): StockIssue = StockIssue.fromJson(rpcObject("claim_issue_rpc", JSONObject().put("p_issue_id",issueId).put("p_client_request_id",requestId)))
    suspend fun updateIssue(issueId: String, action: String, requestId: String): StockIssue = StockIssue.fromJson(rpcObject("update_issue_rpc", JSONObject().put("p_issue_id",issueId).put("p_action",action).put("p_client_request_id",requestId)))
    suspend fun reassignIssue(issueId: String,newAssigneeId: String,reason: String,requestId: String): StockIssue = StockIssue.fromJson(rpcObject("reassign_issue_rpc",JSONObject().put("p_issue_id",issueId).put("p_new_assignee",newAssigneeId).put("p_reason",reason).put("p_client_request_id",requestId)))
    suspend fun pendingAlerts(): List<PendingAlert> { val a=rpcArray("pending_alerts_rpc",JSONObject()); return (0 until a.length()).mapNotNull{a.optJSONObject(it)?.let(PendingAlert::fromJson)} }
    suspend fun markAlertReceived(eventId: String) { rpcRaw("mark_alert_received_rpc",JSONObject().put("p_event_id",eventId)) }
    suspend fun markAlertDisplayed(eventId: String) { rpcRaw("mark_alert_displayed_rpc",JSONObject().put("p_event_id",eventId)) }
    suspend fun acknowledgeAlert(eventId: String) { rpcRaw("ack_alert_rpc",JSONObject().put("p_event_id",eventId)) }
    suspend fun registerDevice(token: String,deviceName: String,appVersion: String) { rpcRaw("register_device_rpc",JSONObject().put("p_fcm_token",token).put("p_platform","android").put("p_device_name",deviceName).put("p_app_version",appVersion)) }
    suspend fun searchSkus(query: String,limit: Int=20): List<SkuItem> { val a=rpcArray("search_skus_rpc",JSONObject().put("p_query",query).put("p_limit",limit)); return (0 until a.length()).mapNotNull{i->a.optJSONObject(i)?.let{SkuItem(it.optString("sku"),it.optString("product_name"))}} }

    private suspend fun rpcObject(function:String,payload:JSONObject):JSONObject { val raw=rpcRaw(function,payload).trim(); return if(raw.isBlank()||raw=="null")JSONObject() else JSONObject(raw) }
    private suspend fun rpcArray(function:String,payload:JSONObject):JSONArray { val raw=rpcRaw(function,payload).trim(); return if(raw.isBlank()||raw=="null")JSONArray() else JSONArray(raw) }
    private suspend fun rpcRaw(function:String,payload:JSONObject):String = withContext(Dispatchers.IO) {
        val token=session.accessToken; if(token.isBlank()) throw RpcException(401,"Phiên đăng nhập không hợp lệ")
        val request=Request.Builder().url(BuildConfig.SUPABASE_URL.trimEnd('/')+"/rest/v1/rpc/"+function).post(payload.toString().toRequestBody(jsonType)).header("apikey",BuildConfig.SUPABASE_ANON_KEY).header("Authorization","Bearer $token").header("Content-Type","application/json").header("Accept","application/json").build()
        client.newCall(request).execute().use{response->val text=response.body?.string().orEmpty();if(!response.isSuccessful){val parsed=runCatching{JSONObject(text)}.getOrNull();val message=parsed?.optString("message")?.takeIf{it.isNotBlank()}?:parsed?.optString("hint")?.takeIf{it.isNotBlank()}?:"RPC ${response.code}";throw RpcException(response.code,message)};text}
    }
}
