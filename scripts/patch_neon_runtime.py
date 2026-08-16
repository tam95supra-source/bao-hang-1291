from pathlib import Path
import re

REPO_GUARD = "tam95supra-source/bao-hang-1291"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count == 1:
        return text.replace(old, new, 1)
    if count == 0 and new in text:
        return text
    raise SystemExit(f"{label}: expected one old marker, found {count}")


shim_path = Path("web-admin/src/supabase-shim.js")
shim = shim_path.read_text()
shim = replace_once(
    shim,
    "  const raw = headerValue(init, 'x-test-role').trim().toUpperCase()",
    "  const raw = (headerValue(init, 'x-admin-test-role') || headerValue(init, 'x-test-role')).trim().toUpperCase()",
    "test-role header",
)
restore_line = "    case 'restore-skipped': return ['api_restore_skipped_issue_rpc', base({ p_issue_id: b.issue_id, p_reason: b.reason || '' })]"
withdraw_line = "    case 'withdraw-shortage': return ['api_withdraw_shortage_rpc', base({ p_issue_id: b.issue_id })]"
if restore_line not in shim:
    if shim.count(withdraw_line) != 1:
        raise SystemExit("withdraw mapping marker mismatch")
    shim = shim.replace(withdraw_line, restore_line + "\n" + withdraw_line, 1)

legacy_match = "    const functionMatch = url.pathname.match(/^\\/functions\\/v1\\/(?:web-api|api|issue-withdraw)\\/([^/]+)$/)"
new_match = "    const functionMatch = url.pathname.match(/^\\/functions\\/v1\\/(web-api|api|issue-withdraw)\\/([^/]+)$/)"
if legacy_match in shim:
    shim = shim.replace(legacy_match, new_match, 1)
    shim = shim.replace(
        "      const action = decodeURIComponent(functionMatch[1])\n      const body = parseBody(init)",
        "      const family = functionMatch[1]\n      let action = decodeURIComponent(functionMatch[2])\n      const body = parseBody(init)\n      if (family === 'issue-withdraw') {\n        action = ({ board:'withdrawn-board', search:'picker-search-digits', my:'picker-my-issues', withdraw:'withdraw-shortage' })[action] || action\n      }",
        1,
    )
if new_match not in shim:
    raise SystemExit("new function compatibility matcher missing")
shim_path.write_text(shim)

worker_path = Path("google-apps-script/DEPLOY_NEON.gs")
worker = worker_path.read_text()

old_actions = """    if (action === 'upload-log') return json_(uploadLog_(body));
    if (action === 'download-log') return json_(downloadLog_(body));
    if (action === 'user-upsert') return json_(userUpsert_(body));
    if (action === 'user-disable') return json_(userDisable_(body));"""
new_actions = """    if (action === 'upload-log') return json_(uploadLog_(body));
    if (action === 'download-log') return json_(downloadLog_(body));
    if (action === 'user-upsert' || action === 'update-user') {
      if (action === 'update-user') body.user = Object.assign({}, body);
      return json_(userUpsert_(body));
    }
    if (action === 'import-users') return json_(importUsers_(body));
    if (action === 'sync-google-sheet') {
      requireUser_(String(body.id_token || ''), ['ADMIN','ADMIN_INVENT']);
      return json_(workerTick_('SHEET_SYNC'));
    }
    if (action === 'user-disable') return json_(userDisable_(body));"""
worker = replace_once(worker, old_actions, new_actions, "doPost legacy actions")

worker = replace_once(
    worker,
    "    const schedule = neonRpc_('worker_schedule_rpc', {p_realtime_enabled: !!props.getProperty('RTDB_URL')}, token);",
    "    const schedule = neonRpc_('worker_schedule_rpc', {p_realtime_enabled:true}, token);",
    "worker schedule realtime",
)

if "function publishFirestoreRealtime_(event)" not in worker:
    pattern = re.compile(r"function drainRealtime_\(token\) \{.*?\n\}\n\nfunction maybeCleanup_", re.S)
    replacement = r'''function drainRealtime_(token) {
  const events = neonRpc_('worker_realtime_batch_rpc', {p_limit:200}, token) || [];
  let published = 0, failed = 0;
  events.forEach(function(event) {
    try {
      publishFirestoreRealtime_(event);
      const push = sendRealtimeDeltaToTokens_(event);
      if (!push.accepted) throw new Error(push.error || 'REALTIME_FCM_FAILED');
      neonRpc_('worker_realtime_result_rpc', {p_id:Number(event.id),p_published:true,p_error:''}, token);
      published++;
    } catch (error) {
      failed++;
      neonRpc_('worker_realtime_result_rpc', {p_id:Number(event.id),p_published:false,p_error:safeError_(error)}, token);
    }
  });
  return {enabled:true,count:events.length,published:published,failed:failed};
}

function publishFirestoreRealtime_(event) {
  const topic = String(event.topic || '');
  if (['issues','catalog','staff','config'].indexOf(topic) < 0) throw new Error('FIRESTORE_TOPIC_INVALID');
  const access = firebaseOAuthAccessToken_('https://www.googleapis.com/auth/datastore');
  const created = new Date(event.created_at || Date.now());
  const createdIso = isNaN(created.getTime()) ? new Date().toISOString() : created.toISOString();
  const fields = {
    event_type:{stringValue:String(event.event_type || '')},
    topic:{stringValue:topic},
    event_id:{integerValue:String(Number(event.id || 0))},
    entity_id:{stringValue:String(event.entity_id || '')},
    entity_version:{integerValue:String(Number(event.entity_version || 0))},
    created_at:{timestampValue:createdIso},
    payload_json:{stringValue:JSON.stringify(event.payload || {})}
  };
  const url='https://firestore.googleapis.com/v1/projects/'+BH_PROJECT+'/databases/(default)/documents/realtime/'+encodeURIComponent(topic);
  const res=UrlFetchApp.fetch(url,{method:'patch',contentType:'application/json',headers:{Authorization:'Bearer '+access},payload:JSON.stringify({fields:fields}),muteHttpExceptions:true});
  if(res.getResponseCode()<200||res.getResponseCode()>=300)throw new Error('FIRESTORE_'+res.getResponseCode()+': '+res.getContentText().slice(0,400));
}

function sendRealtimeDeltaToTokens_(event) {
  const tokens = Array.isArray(event.device_tokens) ? event.device_tokens : [];
  if (!tokens.length) return {accepted:true,invalidTokens:[],error:''};
  const access = firebaseOAuthAccessToken_('https://www.googleapis.com/auth/firebase.messaging');
  const invalid = [];
  let success = 0, lastError = '';
  tokens.forEach(function(token) {
    const data={event_type:'REALTIME_DELTA',topic:String(event.topic||''),realtime_event_id:String(event.id||''),entity_id:String(event.entity_id||''),entity_version:String(event.entity_version||0)};
    const body={message:{token:String(token),data:data,android:{priority:'high',ttl:'60s',collapse_key:'realtime-'+String(event.topic||'all').slice(0,48)}}};
    const url='https://fcm.googleapis.com/v1/projects/'+BH_PROJECT+'/messages:send';
    const res=UrlFetchApp.fetch(url,{method:'post',contentType:'application/json',headers:{Authorization:'Bearer '+access},payload:JSON.stringify(body),muteHttpExceptions:true});
    const code=res.getResponseCode();
    if(code>=200&&code<300){success++;return;}
    const text=res.getContentText();
    lastError=('FCM_REALTIME '+code+' '+text).slice(0,500);
    if(code===404||text.indexOf('UNREGISTERED')>=0||text.indexOf('registration-token-not-registered')>=0)invalid.push(String(token));
  });
  return {accepted:success>0||invalid.length===tokens.length,invalidTokens:invalid,error:lastError};
}

function maybeCleanup_'''
    worker, count = pattern.subn(replacement, worker, count=1)
    if count != 1:
        raise SystemExit(f"RTDB realtime block: expected one, got {count}")

import_marker = "function userUpsert_(body) {"
if "function importUsers_(body)" not in worker:
    if worker.count(import_marker) != 1:
        raise SystemExit("userUpsert marker mismatch")
    import_fn = '''function importUsers_(body) {
  requireUser_(String(body.id_token||''), ['ADMIN','ADMIN_INVENT']);
  const items=Array.isArray(body.items)?body.items:[];
  let imported=0;
  const errors=[];
  items.forEach(function(item){
    try {
      userUpsert_({id_token:String(body.id_token||''),user:Object.assign({},item)});
      imported++;
    } catch(error) {
      errors.push({employee_code:String(item&&item.employee_code||''),error:safeError_(error)});
    }
  });
  return {ok:errors.length===0,imported:imported,failed:errors.length,errors:errors};
}

'''
    worker = worker.replace(import_marker, import_fn + import_marker, 1)

old_password = "  const password=String(item.new_password||item.initial_password||'');\n  if(isNew && password.length<6)throw new Error('PASSWORD_TOO_SHORT');"
new_password = "  const suppliedPassword=String(item.new_password||item.initial_password||'');\n  const password=isNew && !suppliedPassword ? requiredProp_('STAFF_DEFAULT_PASSWORD') : suppliedPassword;\n  if(isNew && password.length<6)throw new Error('PASSWORD_TOO_SHORT');"
worker = replace_once(worker, old_password, new_password, "default password")

if "RTDB_URL" in worker or "RTDB_" in worker:
    raise SystemExit("RTDB reference remains")
if "FIRESTORE_TOPIC_INVALID" not in worker or "event_type:'REALTIME_DELTA'" not in worker:
    raise SystemExit("Firestore/FCM replacement missing")
worker_path.write_text(worker)
