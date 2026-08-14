from pathlib import Path
import re
ROOT=Path('.')
def read(p): return (ROOT/p).read_text(encoding='utf-8')
def write(p,s): (ROOT/p).write_text(s,encoding='utf-8')
def replace_once(p,old,new):
    s=read(p)
    if old not in s: raise SystemExit(f'missing marker in {p}: {old[:100]!r}')
    write(p,s.replace(old,new,1))

# Android Firestore quota accounting uses the existing control-document write; no extra quota write.
p='app/src/main/java/vn/pickpack1291/baohang/network/EmergencyFirestoreClient.kt'
s=read(p)
if 'import java.time.ZoneId' not in s:
    s=s.replace('import java.time.Instant\n','import java.time.Instant\nimport java.time.ZoneId\nimport java.time.ZonedDateTime\n')
if 'var quotaLevel:' not in s:
    s=s.replace('''    val isProvisioned: Boolean get() = auth.currentUser?.uid == session.profile?.id''','''    @Volatile var quotaLevel: String = "OK"\n        private set\n\n    val isProvisioned: Boolean get() = auth.currentUser?.uid == session.profile?.id''')
# report projection/cost + control data
s=s.replace('''            val projection = tx.get(projectionRef)\n            val sequence = (if (control.exists()) control.getLong("next_sequence") ?: 0L else 0L) + 1L''','''            val projection = tx.get(projectionRef)\n            val projectionNeedsWrite = !projection.exists() || projection.getString("issue_id") != issueId\n            val writeCost = if (!active) 5 else if (projectionNeedsWrite) 4 else 3\n            val sequence = (if (control.exists()) control.getLong("next_sequence") ?: 0L else 0L) + 1L''')
s=s.replace('''            tx.set(eventRef, event)\n            tx.set(controlRef, mapOf("next_sequence" to sequence, "sheet_acked_sequence" to acked, "last_event_id" to requestId, "updated_at" to now))''','''            val quota = quotaControl(control, writeCost, sequence, acked, requestId, now)\n            tx.set(eventRef, event)\n            tx.set(controlRef, quota.fields)''',1)
s=s.replace('''            if (!projection.exists() || projection.getString("issue_id") != issueId) {''','''            if (projectionNeedsWrite) {''',1)
s=s.replace('''            EmergencyResult(issueId, sku, productName, status, version, "", 1)\n        }.await()\n        return ReportResult(result.toStockIssue(), false, "Đã ghi nhận báo thiếu qua Firebase Emergency")''','''            EmergencyResult(issueId, sku, productName, status, version, "", 1, quota.level)\n        }.await()\n        quotaLevel = result.quotaLevel\n        val message = if (quotaLevel == "DEGRADE_85") "Đã ghi nhận qua Firebase Emergency. Quota đang ở mức 85%; hệ thống chỉ duy trì nghiệp vụ cốt lõi." else "Đã ghi nhận báo thiếu qua Firebase Emergency"\n        return ReportResult(result.toStockIssue(), false, message)''')
# mutate control exact-ish cost
s=s.replace('''            val sequence = (if (control.exists()) control.getLong("next_sequence") ?: 0L else 0L) + 1L\n            val acked = if (control.exists()) control.getLong("sheet_acked_sequence") ?: 0L else 0L\n            val now = FieldValue.serverTimestamp()''','''            val writeCost = 4 + if (eventType in setOf("AVAILABLE", "SKIP_ALLOWED")) projections.size else 0\n            val sequence = (if (control.exists()) control.getLong("next_sequence") ?: 0L else 0L) + 1L\n            val acked = if (control.exists()) control.getLong("sheet_acked_sequence") ?: 0L else 0L\n            val now = FieldValue.serverTimestamp()''',1)
# Careful: first occurrence above after report may have been altered; this is intended next match.
s=s.replace('''            tx.set(eventRef, eventMap(requestId, sequence, eventType, issueId, sku, version, payload))\n            tx.set(controlRef, mapOf("next_sequence" to sequence, "sheet_acked_sequence" to acked, "last_event_id" to requestId, "updated_at" to now))''','''            val quota = quotaControl(control, writeCost, sequence, acked, requestId, now)\n            tx.set(eventRef, eventMap(requestId, sequence, eventType, issueId, sku, version, payload))\n            tx.set(controlRef, quota.fields)''')
s=s.replace('''            EmergencyResult(issueId, sku, "", newStatus, version, claimedBy, (ops.getLong("report_count") ?: 1L).toInt())\n        }.await()\n        return result.toStockIssue()''','''            EmergencyResult(issueId, sku, "", newStatus, version, claimedBy, (ops.getLong("report_count") ?: 1L).toInt(), quota.level)\n        }.await()\n        quotaLevel = result.quotaLevel\n        return result.toStockIssue()''')
# Constructors from idempotent/early-return get default quota level through default param below.
# Add quota helper before requireProvisioned.
if 'private fun quotaControl(' not in s:
    marker='''    private fun requireProvisioned() {'''
    helper='''    private data class QuotaControl(val fields: Map<String, Any>, val level: String)\n\n    private fun quotaControl(\n        control: com.google.firebase.firestore.DocumentSnapshot,\n        writeCost: Int,\n        sequence: Long,\n        acked: Long,\n        eventId: String,\n        now: Any\n    ): QuotaControl {\n        val bangkok = ZonedDateTime.now(ZoneId.of("Asia/Bangkok"))\n        val sameDay = control.exists()\n            && control.getLong("quota_year") == bangkok.year.toLong()\n            && control.getLong("quota_month") == bangkok.monthValue.toLong()\n            && control.getLong("quota_day") == bangkok.dayOfMonth.toLong()\n        val previous = if (sameDay) control.getLong("estimated_writes_today") ?: 0L else 0L\n        val next = previous + writeCost.toLong()\n        if (next > 19_500L) throw EmergencyException(\n            "FIRESTORE_QUOTA_GUARD",\n            "Firebase Emergency đã chạm ngưỡng an toàn 97,5% quota ghi/ngày. Thao tác chưa được gửi để tránh làm gián đoạn toàn bộ Emergency."\n        )\n        val level = when {\n            next >= 17_000L -> "DEGRADE_85"\n            next >= 14_000L -> "WARN_70"\n            next >= 10_000L -> "NOTICE_50"\n            else -> "OK"\n        }\n        return QuotaControl(\n            mapOf(\n                "next_sequence" to sequence, "sheet_acked_sequence" to acked, "last_event_id" to eventId, "updated_at" to now,\n                "quota_year" to bangkok.year, "quota_month" to bangkok.monthValue, "quota_day" to bangkok.dayOfMonth,\n                "estimated_writes_today" to next, "quota_level" to level\n            ),\n            level\n        )\n    }\n\n'''
    if marker not in s: raise SystemExit('quota helper marker missing')
    s=s.replace(marker,helper+marker)
# Add default quotaLevel field to result data class and preserve old call sites.
s=s.replace('''private data class EmergencyResult(val issueId:String, val sku:String, val productName:String, val status:String, val version:Long, val claimedBy:String, val reportCount:Int) {''','''private data class EmergencyResult(val issueId:String, val sku:String, val productName:String, val status:String, val version:Long, val claimedBy:String, val reportCount:Int, val quotaLevel:String = "OK") {''')
write(p,s)

# AppRepository logs quota thresholds after successful Emergency mutations.
p='app/src/main/java/vn/pickpack1291/baohang/data/AppRepository.kt'; s=read(p)
if 'firestore_quota_guard_level' not in s:
    # common success block marker in emergency path
    marker='''                    commitAuthority(AuthorityMode.EMERGENCY)\n                    diagnostics.warn("emergency_committed"'''
    if marker in s:
        s=s.replace(marker,'''                    commitAuthority(AuthorityMode.EMERGENCY)\n                    if (emergency.quotaLevel != "OK") diagnostics.warn("firestore_quota_guard_level", mapOf("level" to emergency.quotaLevel, "operation" to operation, "request_id" to requestId))\n                    diagnostics.warn("emergency_committed"''')
write(p,s)

# Apps Script: ordered Firestore query + seven-day cleanup (server rules enforce age).
p='google-apps-script/Code.gs'; s=read(p)
old=re.search(r'''function drainEmergencyToSheet_\(book\) \{.*?\n\}\n\nfunction importEmergencyEvents_''',s,re.S)
if not old: raise SystemExit('drain function marker missing')
new=r'''function drainEmergencyToSheet_(book) {
  let idToken=''; try{idToken=firebaseDrainToken_();}catch(error){auditSecurity_(book,'emergency_drain','','','DEFERRED',safeError_(error));return {drained:0,deferred:true};}
  const control=firestoreGet_('emergency_control/sequence',idToken); if(control.status===404){const cleaned=cleanupEmergencyAcked_(idToken);return {drained:0,caught_up:true,cleaned};} if(control.status!==200)throw new Error(`FIRESTORE_CONTROL_${control.status}`);
  const c=decodeFirestoreFields_(control.body.fields||{}),next=Number(c.next_sequence||0),acked=Number(c.sheet_acked_sequence||0);
  if(next<=acked){upsertControl_(book,'sheet_mode','EMERGENCY_CAUGHT_UP','Firestore already ACKed into Sheet');const cleaned=cleanupEmergencyAcked_(idToken);return {drained:0,caught_up:true,next_sequence:next,sheet_acked_sequence:acked,cleaned};}
  upsertControl_(book,'sheet_mode','EMERGENCY_DRAIN','Draining Firestore journal into Sheet');
  let expected=acked+1,lastAck=acked,drained=0,batches=0;
  while(lastAck<next && batches<20){
    const events=firestorePendingEvents_(lastAck,Math.min(200,next-lastAck),idToken); if(!events.length)throw new Error(`EMERGENCY_SEQUENCE_GAP:${expected}:NONE`);
    for(const event of events){const seq=Number(event.emergency_sequence||0);if(seq!==expected)throw new Error(`EMERGENCY_SEQUENCE_GAP:${expected}:${seq}`);const eventId=String(event.event_id||'');const existing=findRowByExact_(book.getSheetByName('FALLBACK_EVENTS'),2,eventId);if(existing<1){importEmergencyEvents_(book,[event]);drained++;}if(String(event.reconciliation_status||'')!=='SHEET_ACKED')firestoreAckEvent_(eventId,idToken);lastAck=seq;firestoreAckControl_(lastAck,idToken);expected++;if(lastAck>=next)break;}
    batches++;
  }
  const caught=lastAck>=next;upsertControl_(book,'sheet_mode',caught?'EMERGENCY_CAUGHT_UP':'EMERGENCY_DRAIN',caught?'Firestore events durably ACKed into Sheet':'Emergency drain incomplete');const cleaned=caught?cleanupEmergencyAcked_(idToken):0;return {drained,caught_up:caught,next_sequence:next,sheet_acked_sequence:lastAck,cleaned};
}

function importEmergencyEvents_'''
s=s[:old.start()]+new+s[old.end():]
# Insert helpers after firestoreGet_ if absent.
if 'function firestorePendingEvents_' not in s:
    marker='''function firestoreGet_(path,idToken){'''
    idx=s.find(marker)
    if idx<0: raise SystemExit('firestoreGet marker missing')
    # Find end of one-line function.
    end=s.find('\n',idx)
    helpers=r'''
function firestoreRunQuery_(structuredQuery,idToken){const url=`https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID_}/databases/(default)/documents:runQuery`,r=UrlFetchApp.fetch(url,{method:'post',contentType:'application/json',headers:{Authorization:`Bearer ${idToken}`},payload:JSON.stringify({structuredQuery}),muteHttpExceptions:true});if(r.getResponseCode()!==200)throw new Error(`FIRESTORE_QUERY_${r.getResponseCode()}`);return (JSON.parse(r.getContentText()||'[]')||[]).filter((x)=>x.document).map((x)=>Object.assign({__name:x.document.name},decodeFirestoreFields_(x.document.fields||{})));}
function firestorePendingEvents_(afterSequence,limit,idToken){return firestoreRunQuery_({from:[{collectionId:'emergency_events'}],where:{fieldFilter:{field:{fieldPath:'emergency_sequence'},op:'GREATER_THAN',value:{integerValue:String(afterSequence)}}},orderBy:[{field:{fieldPath:'emergency_sequence'},direction:'ASCENDING'}],limit:Math.max(1,Math.min(200,Number(limit||200)))},idToken);}
function cleanupEmergencyAcked_(idToken){const cutoff=new Date(Date.now()-7*24*60*60*1000).toISOString(),rows=firestoreRunQuery_({from:[{collectionId:'emergency_events'}],where:{fieldFilter:{field:{fieldPath:'sheet_ack_at'},op:'LESS_THAN',value:{timestampValue:cutoff}}},orderBy:[{field:{fieldPath:'sheet_ack_at'},direction:'ASCENDING'}],limit:200},idToken);let deleted=0;rows.forEach((event)=>{if(String(event.reconciliation_status||'')!=='SHEET_ACKED')return;const eventId=String(event.event_id||'');if(!eventId)return;const r=UrlFetchApp.fetch(`https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID_}/databases/(default)/documents/emergency_events/${encodeURIComponent(eventId)}`,{method:'delete',headers:{Authorization:`Bearer ${idToken}`},muteHttpExceptions:true});if(r.getResponseCode()===200)deleted++;else if(r.getResponseCode()!==404)throw new Error(`FIRESTORE_CLEANUP_${r.getResponseCode()}`);});return deleted;}
'''
    s=s[:end+1]+helpers+s[end+1:]
write(p,s)

Path('scripts/apply_emergency_quota_cleanup.py').unlink()
print('EMERGENCY_QUOTA_CLEANUP_PATCH=READY')
