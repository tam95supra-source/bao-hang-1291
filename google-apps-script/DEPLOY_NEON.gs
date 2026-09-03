/**
 * BÁO HÀNG 1291 — Neon/Firebase/Google worker bundle.
 * Target only: Firebase bao-hang-1291 + Neon tiny-boat-19315489.
 * No secret is stored in source. Secrets are bootstrapped into Script Properties.
 */
const BH_PROJECT = 'bao-hang-1291';
const BH_PASSWORD_RECOVERY_EMAIL = 'tam95.supra@gmail.com';
const BH_TEMP_PASSWORD_PREFIX = 'R!';
const BH_PASSWORD_RESET_COOLDOWN_MS = 5 * 60 * 1000;
const BH_NEON_PROJECT = 'tiny-boat-19315489';
const BH_NEON_BRANCH = 'br-broad-resonance-aznwrpea';
const BH_NEON_DATA_API = 'https://ep-morning-bread-az3w94qb.apirest.c-3.ap-southeast-1.aws.neon.tech/neondb/rest/v1';
const BH_REPORT_SHEET_ID = '15_AJ8oB7cEeQjeM6Jb6dm0ki6NcqyxPRVRTAvQPHVM0';
const BH_STAFF_SHEET_ID = '1E7ZWz-4eMcBliQxDYBVoogIoeSYyiaXGwj0I6mbMm78';
const BH_STAFF_SHEET_NAME = 'DANH SÁCH NHÂN SỰ';
const BH_PROTECTED_ADMIN_CODE = '6281280';
const BH_LOG_FOLDER_ID = '1xB_h0A1Z_AKfX3TgnQyGgl7fM8qkANfs';
const BH_EVENT_HEADERS = ['Mã sự kiện','Thời gian','Loại sự kiện','Ticket ID','SKU','Tên sản phẩm','Trạng thái','Số lượt báo','Người báo/Actor ID','Dữ liệu JSON'];
const BH_ISSUE_HEADERS = ['Ticket ID','SKU','Tên sản phẩm','Trạng thái','Số lượt báo','Báo lần đầu','Cập nhật cuối','Invent xử lý','Số lần mở lại'];
const BH_USER_HEADERS = ['Mã nhân viên','Họ tên','Nhà thầu','Vai trò','Trạng thái','Cập nhật cuối'];

function setupBaoHang1291() {
  getOrCreateSheet_('SU_KIEN', BH_EVENT_HEADERS);
  getOrCreateSheet_('TRANG_THAI_SKU', BH_ISSUE_HEADERS);
  getOrCreateSheet_('NHAN_SU', BH_USER_HEADERS);
  const info = getOrCreateSheet_('THONG_TIN', ['Mục','Giá trị']);
  info.getRange(2,1,5,2).setValues([
    ['Nguồn dữ liệu','Neon PostgreSQL — BÁO HÀNG 1291'],
    ['Đăng nhập / thông báo','Firebase Auth + FCM — bao-hang-1291'],
    ['Mật khẩu','KHÔNG đồng bộ vào Google Sheet'],
    ['Lưu báo cáo','Sheet chính 15_AJ8oB7cEeQjeM6Jb6dm0ki6NcqyxPRVRTAvQPHVM0 — hàng đợi Neon'],
    ['Cập nhật',new Date()]
  ]);
  getLogFolder_();
  return 'Đã tạo cấu trúc Google Sheet BÁO HÀNG 1291';
}

function bootstrapNeonWorker() {
  const props = PropertiesService.getScriptProperties();
  const required = ['WEBHOOK_SECRET','FIREBASE_SERVICE_ACCOUNT','STAFF_DEFAULT_PASSWORD','NEON_DATA_API','FIREBASE_WEB_API_KEY','FIREBASE_PROJECT_ID','WORKER_ADMIN_UID'];
  required.forEach(function(key) {
    if (!String(props.getProperty(key) || '')) throw new Error(key + ' chưa được cấu hình');
  });
  if (String(props.getProperty('FIREBASE_PROJECT_ID')) !== BH_PROJECT) throw new Error('FIREBASE_SCOPE_MISMATCH');
  const neonApi = String(props.getProperty('NEON_DATA_API') || '');
  if (neonApi.indexOf('ep-morning-bread-az3w94qb.apirest.c-3.ap-southeast-1.aws.neon.tech/neondb/rest/v1') < 0) throw new Error('NEON_ENDPOINT_SCOPE_MISMATCH');
  props.setProperties({NEON_PROJECT_ID:BH_NEON_PROJECT,NEON_BRANCH_ID:BH_NEON_BRANCH,BOOTSTRAP_VERSION:'NEON_ONLY_V1',BOOTSTRAP_AT:new Date().toISOString()}, false);
  assertScope_();
  installWorkerTriggers_();
  setupBaoHang1291();
  return {ok:true,project:BH_PROJECT,neon_project:BH_NEON_PROJECT,neon_branch:BH_NEON_BRANCH};
}

function doPost(e) {
  const body = parseBody_(e);
  try {
    if (body.secret && Array.isArray(body.events)) return json_(sheetWebhook_(body));
    const action = String(body.action || '').trim();
    if (!action) return json_({ok:false,error:'ACTION_REQUIRED'});
    if (action === 'ping') { const source=staffSourceConfig_(); return json_({ok:true,project:BH_PROJECT,provider:'NEON_FIREBASE_GOOGLE',staff_sheet_id:source.sheetId,staff_sheet_name:source.sheetName}); }
    if (action === 'staff-source-ping' || action === 'staff-source-structure-ping') return json_(staffSourceBridgeReceive_(body));
    if (action === 'password-reset-preview') return json_(passwordResetPreview_(body));
    if (action === 'password-reset-request') return json_(passwordResetRequest_(body));
    if (action === 'password-reset-mail-capability') return json_(passwordResetMailCapability_(body));
    if (action === 'password-reset-mail-oauth-configure') return json_(passwordResetMailOAuthConfigure_(body));
    if (action === 'bootstrap-config') return json_(bootstrapConfig_(body));
    if (action === 'realtime-kick') {
      requireRealtimeCaller_(String(body.id_token || ''));
      return json_(realtimeKick_(body));
    }
    if (action === 'worker-kick') {
      requireUser_(String(body.id_token || ''), null);
      return json_(workerTick_('CLIENT_KICK'));
    }
    if (action === 'upload-log') return json_(uploadLog_(body));
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
    if (action === 'user-disable') return json_(userDisable_(body));
    if (action === 'staff-sync-now') {
      const caller = requireUser_(String(body.id_token || ''), ['ADMIN','ADMIN_INVENT']);
      return json_(Object.assign({ok:true}, runStaffSync_('MANUAL', caller.profile)));
    }
    if (action === 'staff-source-status') return json_(staffSourceStatus_(body));
    if (action === 'staff-source-bridge-status') {
      requireUser_(String(body.id_token || ''), ['ADMIN','ADMIN_INVENT']);
      return json_(getStaffSourceBridgeReceiverStatus());
    }
    if (action === 'staff-source-retire-legacy-watchers') {
      requireUser_(String(body.id_token || ''), ['ADMIN']);
      return json_(staffSourceBridgeRemoveLegacyWatchers_());
    }
    if (action === 'staff-source-configure') return json_(staffSourceConfigure_(body));
    if (action === 'staff-recovery-current-source') throw new Error('STAFF_RECOVERY_RETIRED_CANONICAL_HY1');
    if (action === 'staff-cleanup-orphans') {
      requireUser_(String(body.id_token || ''), ['ADMIN']);
      return json_(cleanupInactiveStaffOrphans_(workerAdminIdToken_(), Math.min(100, Math.max(1, Number(body.limit || 50))), String(body.after_code || '')));
    }
    return json_({ok:false,error:'ACTION_NOT_SUPPORTED'});
  } catch (error) {
    return json_({ok:false,error:safeError_(error)});
  }
}

function bootstrapConfig_(body) {
  const props = PropertiesService.getScriptProperties();
  if (String(props.getProperty('BOOTSTRAP_LOCKED') || '') === '1') throw new Error('BOOTSTRAP_LOCKED');
  const idToken = String(body.id_token || '');
  if (!idToken) throw new Error('AUTH_REQUIRED');
  const authRes = UrlFetchApp.fetch(BH_NEON_DATA_API + '/rpc/api_session_profile_rpc', {
    method:'post',
    contentType:'application/json',
    headers:{Authorization:'Bearer ' + idToken},
    payload:JSON.stringify({p_test_role:null}),
    muteHttpExceptions:true
  });
  if (authRes.getResponseCode() < 200 || authRes.getResponseCode() >= 300) throw new Error('BOOTSTRAP_AUTH_FAILED');
  const session = JSON.parse(authRes.getContentText() || '{}');
  const profile = session && session.profile ? session.profile : {};
  if (String(session.effective_role || '').toUpperCase() !== 'ADMIN' || String(profile.employee_code || '') !== BH_PROTECTED_ADMIN_CODE || !profile.protected_account) {
    throw new Error('BOOTSTRAP_ADMIN_REQUIRED');
  }
  const cfg = body && body.config ? body.config : {};
  const neonApi = String(cfg.neon_data_api || '');
  const firebaseProject = String(cfg.firebase_project_id || '');
  const workerUid = String(cfg.worker_admin_uid || '');
  const webhookSecret = String(cfg.webhook_secret || '');
  const serviceAccount = String(cfg.firebase_service_account || '');
  const staffPassword = String(cfg.staff_default_password || '');
  const firebaseApiKey = String(cfg.firebase_web_api_key || '');
  if (neonApi !== BH_NEON_DATA_API || firebaseProject !== BH_PROJECT) throw new Error('BOOTSTRAP_SCOPE_MISMATCH');
  if (workerUid !== String(profile.id || '')) throw new Error('BOOTSTRAP_ADMIN_UID_MISMATCH');
  if (webhookSecret.length < 20 || !staffPassword || !firebaseApiKey) throw new Error('BOOTSTRAP_CONFIG_INCOMPLETE');
  let sa = {};
  try { sa = JSON.parse(serviceAccount); } catch (error) { throw new Error('BOOTSTRAP_SERVICE_ACCOUNT_INVALID'); }
  if (String(sa.project_id || '') !== BH_PROJECT || !sa.client_email || !sa.private_key) throw new Error('BOOTSTRAP_SERVICE_ACCOUNT_SCOPE_MISMATCH');
  props.setProperties({
    WEBHOOK_SECRET:webhookSecret,
    FIREBASE_SERVICE_ACCOUNT:serviceAccount,
    STAFF_DEFAULT_PASSWORD:staffPassword,
    NEON_DATA_API:BH_NEON_DATA_API,
    FIREBASE_WEB_API_KEY:firebaseApiKey,
    FIREBASE_PROJECT_ID:BH_PROJECT,
    WORKER_ADMIN_UID:workerUid,
    NEON_PROJECT_ID:BH_NEON_PROJECT,
    NEON_BRANCH_ID:BH_NEON_BRANCH,
    BOOTSTRAP_VERSION:'NEON_ONLY_V2',
    BOOTSTRAP_AT:new Date().toISOString(),
    BOOTSTRAP_LOCKED:'1'
  }, false);
  assertScope_();
  installWorkerTriggers_();
  setupBaoHang1291();
  return {ok:true,project:BH_PROJECT,provider:'NEON_FIREBASE_GOOGLE',locked:true};
}

function workerSafetyTick() { return workerTick_('SAFETY_30M'); }
function workerAdaptiveTick() { return workerTick_('ADAPTIVE'); }

function workerTick_(source) {
  assertScope_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return {ok:true,skipped:'LOCKED'};
  try {
    const props = PropertiesService.getScriptProperties();
    const last = Number(props.getProperty('LAST_WORKER_AT_MS') || 0);
    if (source === 'CLIENT_KICK' && Date.now() - last < 3000) return {ok:true,skipped:'COALESCED'};
    props.setProperty('LAST_WORKER_AT_MS', String(Date.now()));
    const token = workerAdminIdToken_();
    const tick = neonRpc_('worker_tick_rpc', {}, token);

    // Latency-sensitive transport must never sit behind Google Sheet export.
    // A CLIENT_KICK is the foreground fast path: publish realtime/FCM first and
    // leave bulk Sheet export + cleanup to adaptive/safety workers.
    const realtime = drainRealtime_(token);
    const notifications = drainNotifications_(token);
    const pushes = drainPushes_(token);
    const sheet = source === 'CLIENT_KICK' ? {count:0,skipped:'CLIENT_KICK'} : drainSheet_(token);
    if (source !== 'CLIENT_KICK') maybeCleanup_(token);
    const schedule = neonRpc_('worker_schedule_rpc', {p_realtime_enabled:true}, token);
    scheduleAdaptiveTrigger_(schedule && schedule.next_at ? String(schedule.next_at) : '');
    return {ok:true,source:source,tick:tick,realtime:realtime,notifications:notifications,pushes:pushes,sheet:sheet,schedule:schedule};
  } finally {
    lock.releaseLock();
  }
}

function installWorkerTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    const f = t.getHandlerFunction();
    if (f === 'workerSafetyTick' || f === 'workerAdaptiveTick') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('workerSafetyTick').timeBased().everyMinutes(30).create();
}

function scheduleAdaptiveTrigger_(iso) {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'workerAdaptiveTick') ScriptApp.deleteTrigger(t);
  });
  if (!iso) return;
  const delay = Math.max(60000, new Date(iso).getTime() - Date.now());
  if (delay >= 29 * 60 * 1000) return;
  ScriptApp.newTrigger('workerAdaptiveTick').timeBased().after(delay).create();
}

function drainNotifications_(token) {
  const batch=neonRpc_('worker_notification_batch_rpc',{p_limit:200},token)||[];
  let accepted=0,failed=0;
  const results=[];
  batch.forEach(function(event){
    const result=sendEventToTokens_(event,String(event.status||''),token);
    results.push({
      event_id:String(event.event_id),
      accepted:!!result.accepted,
      invalid_tokens:result.invalidTokens||[],
      error:result.error||''
    });
    result.accepted?accepted++:failed++;
  });
  if(results.length)neonRpc_('worker_notification_results_rpc',{p_results:results},token);
  return {count:batch.length,accepted:accepted,failed:failed};
}

function drainPushes_(token) {
  const batch=neonRpc_('worker_push_batch_rpc',{p_limit:200},token)||[];
  let accepted=0,failed=0;
  const results=[];
  batch.forEach(function(event){
    const result=sendEventToTokens_(event,String(event.event_status||''),token);
    results.push({
      id:String(event.id),
      accepted:!!result.accepted,
      invalid_tokens:result.invalidTokens||[],
      error:result.error||''
    });
    result.accepted?accepted++:failed++;
  });
  if(results.length)neonRpc_('worker_push_results_rpc',{p_results:results},token);
  return {count:batch.length,accepted:accepted,failed:failed};
}

function sendEventToTokens_(event, status, unusedIdToken) {
  const tokens = Array.isArray(event.device_tokens) ? event.device_tokens : [];
  if (!tokens.length) return {accepted:true,invalidTokens:[],error:''};
  const access = firebaseOAuthAccessToken_('https://www.googleapis.com/auth/firebase.messaging');
  const invalid = [];
  let success = 0, lastError = '';
  tokens.forEach(function(token) {
    const data = {
      event_id:String(event.event_id || event.id || ''),
      notification_event_id:String(event.event_id || ''),
      issue_id:String(event.issue_id || ''),
      issue_version:String(event.issue_version || 1),
      status:String(status || ''),
      target_user_id:String(event.target_user_id || ''),
      expiry:String(event.ttl_seconds || 86400),
      sku:String(event.sku || ''),
      product_name:String(event.product_name || ''),
      message:String(event.message || ''),
      critical:String(!!event.critical)
    };
    const ttl = Math.max(0, Number(event.ttl_seconds || 86400));
    const body = {message:{token:String(token),data:data,android:{priority:String(event.priority || 'high').toUpperCase(),ttl:String(ttl)+'s'}}};
    const collapse = String(event.collapse_key || event.issue_id || 'bao-hang-1291');
    if (collapse) body.message.android.collapse_key = collapse.slice(0,64);
    const url = 'https://fcm.googleapis.com/v1/projects/' + BH_PROJECT + '/messages:send';
    const res = UrlFetchApp.fetch(url, {method:'post',contentType:'application/json',headers:{Authorization:'Bearer '+access},payload:JSON.stringify(body),muteHttpExceptions:true});
    const code = res.getResponseCode();
    if (code >= 200 && code < 300) { success++; return; }
    const text = res.getContentText();
    lastError = ('FCM '+code+' '+text).slice(0,500);
    if (code === 404 || text.indexOf('UNREGISTERED') >= 0 || text.indexOf('registration-token-not-registered') >= 0) invalid.push(String(token));
  });
  return {accepted:success>0 || invalid.length===tokens.length,invalidTokens:invalid,error:lastError};
}

function drainSheet_(token) {
  const events=neonRpc_('worker_sheet_batch_rpc',{p_limit:500},token)||[];
  if(!events.length)return {count:0};
  const applied=applyEventsBatch_(events);
  const ids=events.map(function(event){return Number(event.id);});
  const acked=neonRpc_('worker_sheet_ack_rpc',{p_ids:ids},token);
  return {count:events.length,acked:Number(acked||0),sheet:applied};
}

function drainRealtime_(token) {
  const events=neonRpc_('worker_realtime_batch_rpc',{p_limit:200},token)||[];
  if(!events.length)return {enabled:true,count:0,published:0,failed:0,groups:0};
  const groups={};
  events.forEach(function(event){
    const topic=String(event.topic||'');
    (groups[topic]||(groups[topic]=[])).push(event);
  });
  let published=0,failed=0;
  const results=[];
  Object.keys(groups).forEach(function(topic){
    const group=groups[topic];
    const latest=group[group.length-1];
    try{
      publishFirestoreRealtime_(latest);
      const push=sendRealtimeDeltaToTokens_(latest);
      if(!push.accepted)throw new Error(push.error||'REALTIME_FCM_FAILED');
      results.push({
        ids:group.map(function(e){return Number(e.id);}),
        published:true,
        invalid_tokens:push.invalidTokens||[],
        error:''
      });
      published+=group.length;
    }catch(error){
      failed+=group.length;
      results.push({
        ids:group.map(function(e){return Number(e.id);}),
        published:false,
        invalid_tokens:[],
        error:safeError_(error)
      });
    }
  });
  if(results.length)neonRpc_('worker_realtime_results_rpc',{p_results:results},token);
  return {enabled:true,count:events.length,published:published,failed:failed,groups:Object.keys(groups).length};
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
  const tokens=Array.isArray(event.device_tokens)?event.device_tokens:[];
  const access=firebaseOAuthAccessToken_('https://www.googleapis.com/auth/firebase.messaging');
  const invalid=[];
  let attempted=0,success=0,lastError='';
  const data={
    event_type:'REALTIME_DELTA',
    topic:String(event.topic||''),
    realtime_event_id:String(event.id||''),
    entity_id:String(event.entity_id||''),
    entity_version:String(event.entity_version||0)
  };
  const url='https://fcm.googleapis.com/v1/projects/'+BH_PROJECT+'/messages:send';

  if(String(event.topic||'')==='issues'){
    attempted++;
    const topicBody={message:{
      topic:'bao-hang-1291-issues-operators',
      data:data,
      android:{priority:'high',ttl:'60s',collapse_key:'realtime-issues'}
    }};
    const topicRes=UrlFetchApp.fetch(url,{method:'post',contentType:'application/json',headers:{Authorization:'Bearer '+access},payload:JSON.stringify(topicBody),muteHttpExceptions:true});
    const topicCode=topicRes.getResponseCode();
    if(topicCode>=200&&topicCode<300)success++;
    else lastError=('FCM_REALTIME_TOPIC '+topicCode+' '+topicRes.getContentText()).slice(0,500);
  }

  tokens.forEach(function(token){
    attempted++;
    const body={message:{
      token:String(token),
      data:data,
      android:{priority:'high',ttl:'60s',collapse_key:'realtime-'+String(event.topic||'all').slice(0,48)}
    }};
    const res=UrlFetchApp.fetch(url,{method:'post',contentType:'application/json',headers:{Authorization:'Bearer '+access},payload:JSON.stringify(body),muteHttpExceptions:true});
    const code=res.getResponseCode();
    if(code>=200&&code<300){success++;return;}
    const text=res.getContentText();
    lastError=('FCM_REALTIME '+code+' '+text).slice(0,500);
    if(code===404||text.indexOf('UNREGISTERED')>=0||text.indexOf('registration-token-not-registered')>=0)invalid.push(String(token));
  });
  return {accepted:attempted===0||success>0||invalid.length===tokens.length,invalidTokens:invalid,error:lastError};
}

function maybeCleanup_(token) {
  const props = PropertiesService.getScriptProperties();
  const last = Number(props.getProperty('LAST_CLEANUP_AT_MS') || 0);
  if (Date.now() - last < 6 * 60 * 60 * 1000) return;
  const oldLogs = neonRpc_('worker_old_logs_rpc', {p_limit:200}, token) || [];
  const removed = [];
  oldLogs.forEach(function(row) {
    const path = String(row.object_path || '');
    if (path.indexOf('drive:') !== 0) return;
    try { DriveApp.getFileById(path.substring(6)).setTrashed(true); removed.push(String(row.id)); } catch (ignore) {}
  });
  if (removed.length) neonRpc_('worker_delete_log_metadata_rpc', {p_ids:removed}, token);
  neonRpc_('worker_cleanup_rpc', {}, token);
  props.setProperty('LAST_CLEANUP_AT_MS', String(Date.now()));
}

function maybeStaffSync_(token) {
  const props = PropertiesService.getScriptProperties();
  const last = Number(props.getProperty('LAST_STAFF_SYNC_AT_MS') || 0);
  let cfg;
  try { cfg = neonRpc_('api_get_config_rpc', {p_test_role:null}, token); } catch (ignore) { return {status:'SKIPPED_CONFIG'}; }
  if (!cfg || !cfg.staff_auto_sync_enabled) return {status:'DISABLED'};
  const interval = Math.max(15, Number(cfg.staff_sync_interval_minutes || 60));
  if (Date.now() - last < interval * 60000) return {status:'NOT_DUE'};
  try {
    const result = runStaffSync_('AUTO', {role:'ADMIN'});
    props.deleteProperty('LAST_STAFF_SYNC_ERROR');
    return result;
  } catch (error) {
    props.setProperty('LAST_STAFF_SYNC_ERROR', safeError_(error));
    return {status:'FAILED',error:safeError_(error)};
  }
}

function normalizeStaffHeader_(value) {
  return String(value || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/Đ/g,'D').replace(/đ/g,'d').toLowerCase().replace(/\s+/g,' ');
}

function parseStaffSheetId_(value) {
  const raw=String(value || '').trim();
  if (/^[A-Za-z0-9_-]{20,120}$/.test(raw)) return raw;
  const match=raw.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{20,120})/);
  if (!match) throw new Error('STAFF_SOURCE_LINK_INVALID');
  return match[1];
}

function staffSourceConfig_() {
  const props=PropertiesService.getScriptProperties();
  return {
    sheetId:String(props.getProperty('STAFF_SOURCE_SHEET_ID') || BH_STAFF_SHEET_ID),
    sheetName:String(props.getProperty('STAFF_SOURCE_SHEET_NAME') || BH_STAFF_SHEET_NAME)
  };
}

function readStaffSource_(sheetId, sheetName) {
  const id=parseStaffSheetId_(sheetId);
  const tab=String(sheetName || '').trim();
  if (!tab || tab.length > 100) throw new Error('STAFF_SOURCE_TAB_INVALID');
  const ss=SpreadsheetApp.openById(id);
  if (ss.getId() !== id) throw new Error('STAFF_SOURCE_SHEET_ID_MISMATCH');
  const sheet=ss.getSheetByName(tab);
  if (!sheet) throw new Error('STAFF_SOURCE_TAB_NOT_FOUND');

  const expected=['ma nhan vien','ho va ten','so dien thoai','vi tri chinh','nha cung cap','bo phan','site','kho'];
  const header=sheet.getRange(1,1,1,8).getDisplayValues()[0].map(normalizeStaffHeader_);
  for (let i=0;i<expected.length;i++) {
    if (header[i] !== expected[i]) throw new Error('STAFF_SOURCE_STRUCTURE_MISMATCH:C'+(i+1));
  }

  const lastRow=Math.max(1,sheet.getLastRow());
  const values=lastRow>=2?sheet.getRange(2,1,lastRow-1,8).getDisplayValues():[];
  const byCode={};
  values.forEach(function(row){
    if (String(row[6] || '').trim() !== '1291' || String(row[7] || '').trim().toUpperCase() !== 'HY1') return;
    const code=String(row[0] || '').trim();
    const name=String(row[1] || '').trim();
    if (!code && !name) return;
    if (!/^[A-Za-z0-9._-]+$/.test(code) || !name) throw new Error('STAFF_SOURCE_ROW_INVALID:'+code);
    const key=code.toLowerCase();
    if (byCode[key]) throw new Error('STAFF_SOURCE_DUPLICATE_CODE:'+code);
    byCode[key]={
      employee_code:code,
      full_name:name,
      contractor:String(row[4] || '').trim(),
      source_position:String(row[3] || '').trim(),
      role:code===BH_PROTECTED_ADMIN_CODE?'ADMIN':'PICKER'
    };
  });
  const staff=Object.keys(byCode).sort().map(function(key){return byCode[key];});
  if (!staff.length || staff.length > 2000) throw new Error('STAFF_SOURCE_COUNT_GUARD:'+staff.length);
  const canonical=staff.map(function(x){return [x.employee_code,x.full_name,x.contractor,x.source_position,x.role].join('|');}).join('\n');
  return {
    staff:staff,
    sourceHash:sha256Hex_(canonical),
    responseBytes:Utilities.newBlob(JSON.stringify(staff)).getBytes().length,
    sheetId:id,
    sheetName:tab
  };
}

function fetchFilteredStaff_() {
  const source=staffSourceConfig_();
  return readStaffSource_(source.sheetId, source.sheetName);
}

function staffSourceStatus_(body) {
  requireUser_(String(body.id_token || ''), ['ADMIN','ADMIN_INVENT']);
  const source=staffSourceConfig_();
  const props=PropertiesService.getScriptProperties();
  return {
    ok:true,
    sheet_id:source.sheetId,
    sheet_name:source.sheetName,
    sheet_url:'https://docs.google.com/spreadsheets/d/'+source.sheetId+'/edit',
    fallback_only:source.sheetId!==BH_STAFF_SHEET_ID || source.sheetName!==BH_STAFF_SHEET_NAME,
    last_error:String(props.getProperty('LAST_STAFF_SYNC_ERROR') || '')
  };
}

function staffSourceConfigure_(body) {
  const caller=requireUser_(String(body.id_token || ''), ['ADMIN']);
  const id=parseStaffSheetId_(body.sheet_url || body.sheet_id || '');
  const tab=String(body.sheet_name || '').trim();
  const candidate=readStaffSource_(id, tab);
  const current=staffSourceConfig_();
  const sameSource=current.sheetId===id && current.sheetName===tab;

  if (sameSource) {
    return {
      ok:true,
      sheet_id:id,
      sheet_name:tab,
      eligible_rows:candidate.staff.length,
      status:'NO_CHANGE',
      changed:false,
      validation_only:true,
      created:0,
      updated:0,
      deactivated:0,
      failed:0,
      cleanup:{ok:true,skipped:'SAME_SOURCE_VALIDATION'}
    };
  }

  const props=PropertiesService.getScriptProperties();
  props.setProperties({STAFF_SOURCE_SHEET_ID:id,STAFF_SOURCE_SHEET_NAME:tab,STAFF_SOURCE_CHANGED_AT:new Date().toISOString()}, false);
  installStaffSourceFallbackTrigger_();
  const result=runStaffSync_('MANUAL', caller.profile, candidate);
  const cleanup=cleanupInactiveStaffOrphans_(workerAdminIdToken_(), 25);
  if (Number(result.failed || 0) > 0) throw new Error('STAFF_SOURCE_SYNC_PARTIAL:'+Number(result.failed || 0));
  return Object.assign({ok:true,sheet_id:id,sheet_name:tab,eligible_rows:candidate.staff.length,cleanup:cleanup}, result);
}

function staffRecoveryCurrentSource_(body) {
  throw new Error('STAFF_RECOVERY_RETIRED_CANONICAL_HY1');
}

function installStaffSourceFallbackTrigger_() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'staffSourceFallbackTick') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('staffSourceFallbackTick').timeBased().everyHours(1).create();
}

function staffSourceFallbackTick() {
  const props=PropertiesService.getScriptProperties();
  try {
    const result=runStaffSync_('AUTO', {role:'ADMIN'});
    cleanupInactiveStaffOrphans_(workerAdminIdToken_(), 20);
    props.deleteProperty('LAST_STAFF_SYNC_ERROR');
    return result;
  } catch (error) {
    props.setProperty('LAST_STAFF_SYNC_ERROR', safeError_(error));
    return {status:'FAILED',error:safeError_(error)};
  }
}

function purgeInactiveStaffProfile_(profile, token) {
  if (!profile || profile.active !== false || String(profile.source_kind || '') !== 'GSHEET' || profile.protected_account || String(profile.role || '') === 'ADMIN') {
    return {eligible:false,purged:false,reason:'NOT_CANDIDATE'};
  }
  const id=String(profile.id || '');
  const dry=neonRpc_('worker_profile_purge_if_orphan_rpc',{p_id:id,p_execute:false},token) || {};
  if (!dry.eligible) return dry;
  try {
    firebaseAdminDelete_(id);
  } catch (error) {
    if (safeError_(error).indexOf('USER_NOT_FOUND') < 0) throw error;
  }
  return neonRpc_('worker_profile_purge_if_orphan_rpc',{p_id:id,p_execute:true},token) || {eligible:true,purged:false,reason:'NO_RESULT'};
}

function cleanupInactiveStaffOrphans_(token, limit, afterCode) {
  const max=Math.min(100,Math.max(1,Number(limit || 25)));
  const after=String(afterCode || '').toLowerCase();
  const profiles=(neonRpc_('worker_profiles_snapshot_rpc', {}, token) || []).filter(function(p){
    return p && p.active === false && String(p.source_kind || '') === 'GSHEET' && !p.protected_account && String(p.role || '') !== 'ADMIN' && String(p.employee_code || '').toLowerCase() > after;
  }).sort(function(a,b){return String(a.employee_code || '').localeCompare(String(b.employee_code || ''));});
  const candidates=profiles.slice(0,max);
  let purged=0,retained=0,failed=0;
  const errors=[];
  candidates.forEach(function(profile){
    try {
      const result=purgeInactiveStaffProfile_(profile,token);
      result && result.purged ? purged++ : retained++;
    } catch (error) {
      failed++;
      errors.push(String(profile.employee_code || '')+': '+safeError_(error));
    }
  });
  const next=candidates.length?String(candidates[candidates.length-1].employee_code || ''):'';
  return {ok:failed===0,checked:candidates.length,purged:purged,retained:retained,failed:failed,errors:errors.slice(0,10),next_after_code:next,has_more:profiles.length>candidates.length};
}

function runStaffSync_(triggerSource, callerProfile, preloadedSource) {
  assertScope_();
  if (!callerProfile || ['ADMIN','ADMIN_INVENT'].indexOf(String(callerProfile.role)) < 0) throw new Error('FORBIDDEN');
  const token = workerAdminIdToken_();
  const source = preloadedSource || fetchFilteredStaff_();
  const status = neonRpc_('api_staff_sync_status_rpc', {p_test_role:null,p_limit:20}, token);
  const runs = status && Array.isArray(status.runs) ? status.runs : [];
  const lastGood = runs.find(function(r){ return r.status === 'SUCCEEDED' || r.status === 'NO_CHANGE'; });
  if (lastGood && String(lastGood.source_hash || '') === source.sourceHash) {
    PropertiesService.getScriptProperties().setProperty('LAST_STAFF_SYNC_AT_MS', String(Date.now()));
    return {status:'NO_CHANGE',changed:false,eligible_rows:source.staff.length,source_bytes:source.responseBytes,created:0,updated:0,deactivated:0,failed:0};
  }
  const runId = String(neonRpc_('worker_staff_run_start_rpc', {p_trigger_source:triggerSource,p_source_sheet_id:source.sheetId}, token));
  const profiles = neonRpc_('worker_profiles_snapshot_rpc', {}, token) || [];
  const existing = {};
  profiles.forEach(function(p){ existing[String(p.employee_code).toLowerCase()] = p; });
  const seen = {};
  let created=0,updated=0,deactivated=0,failed=0,purged=0;
  const errors=[];
  source.staff.forEach(function(item) {
    const key = item.employee_code.toLowerCase(); seen[key]=true;
    const old = existing[key];
    try {
      if (old && item.employee_code !== BH_PROTECTED_ADMIN_CODE && (old.protected_account || old.role === 'ADMIN')) return;
      const protectedAccount = item.employee_code === BH_PROTECTED_ADMIN_CODE;
      const changed = !old || old.full_name !== item.full_name || old.contractor !== item.contractor || old.role !== item.role || old.active !== true || old.source_kind !== 'GSHEET' || String(old.source_position || '') !== item.source_position || !!old.protected_account !== protectedAccount;
      if (!changed) return;
      let uid = old ? String(old.id) : Utilities.getUuid();
      if (old) {
        firebaseAdminUpdate_(uid,{email:employeeEmail_(item.employee_code),displayName:item.full_name,disableUser:false,customAttributes:claims_(item.employee_code,item.role)});
      } else {
        const password = requiredProp_('STAFF_DEFAULT_PASSWORD');
        firebaseAdminCreate_(uid,employeeEmail_(item.employee_code),password,item.full_name,false);
        try { firebaseAdminUpdate_(uid,{emailVerified:true,customAttributes:claims_(item.employee_code,item.role)}); }
        catch (error) { try { firebaseAdminDelete_(uid); } catch (ignore) {} throw error; }
      }
      try {
        neonRpc_('worker_profile_upsert_rpc', {p_id:uid,p_employee_code:item.employee_code,p_full_name:item.full_name,p_contractor:item.contractor,p_role:item.role,p_active:true,p_source_kind:'GSHEET',p_source_position:item.source_position,p_protected_account:protectedAccount}, token);
      } catch (error) {
        if (!old) try { firebaseAdminDelete_(uid); } catch (ignore) {}
        throw error;
      }
      old ? updated++ : created++;
    } catch (error) { failed++; errors.push(item.employee_code+': '+safeError_(error)); }
  });
  if (failed === 0) {
    profiles.forEach(function(old) {
      const code = String(old.employee_code || '');
      if (old.source_kind !== 'GSHEET' || old.protected_account || code === BH_PROTECTED_ADMIN_CODE || seen[code.toLowerCase()] || !old.active) return;
      try {
        firebaseAdminUpdate_(String(old.id),{disableUser:true});
        neonRpc_('worker_profile_deactivate_rpc',{p_id:String(old.id),p_reason:'STAFF_SOURCE_MISSING'},token);
        deactivated++;
        try {
          const purge=purgeInactiveStaffProfile_(Object.assign({},old,{active:false}),token);
          if (purge && purge.purged) purged++;
        } catch (cleanupError) {
          errors.push(code+': cleanup deferred: '+safeError_(cleanupError));
        }
      } catch (error) { failed++; errors.push(code+': '+safeError_(error)); }
    });
  }
  const finalStatus = failed ? 'PARTIAL' : 'SUCCEEDED';
  const result = neonRpc_('worker_staff_run_finish_rpc',{p_run_id:runId,p_status:finalStatus,p_source_hash:source.sourceHash,p_source_rows:source.staff.length,p_eligible_rows:source.staff.length,p_created:created,p_updated:updated,p_deactivated:deactivated,p_failed:failed,p_error_summary:errors.slice(0,20).join('; ').slice(0,2000),p_source_response_bytes:source.responseBytes},token);
  PropertiesService.getScriptProperties().setProperty('LAST_STAFF_SYNC_AT_MS', String(Date.now()));
  return {status:finalStatus,changed:true,run_id:runId,created:created,updated:updated,deactivated:deactivated,purged:purged,failed:failed,run:result};
}

function passwordResetProfile_(employeeCode) {
  const code=String(employeeCode||'').trim();
  if(!/^[a-z0-9._-]+$/i.test(code))throw new Error('INVALID_EMPLOYEE_CODE');
  const token=workerAdminIdToken_();
  const profiles=neonRpc_('worker_profiles_snapshot_rpc',{},token)||[];
  const target=profiles.find(function(p){return p&&p.active===true&&String(p.employee_code||'').toLowerCase()===code.toLowerCase();});
  if(!target)throw new Error('USER_NOT_FOUND_OR_INACTIVE');
  return target;
}

function passwordResetPreview_(body) {
  const target=passwordResetProfile_(body.employee_code);
  return {
    ok:true,
    employee_code:String(target.employee_code||''),
    full_name:String(target.full_name||''),
    recovery_email:BH_PASSWORD_RECOVERY_EMAIL
  };
}

function passwordResetCode4_() {
  const hex=sha256Hex_(Utilities.getUuid()+':'+Date.now()+':'+Math.random());
  return String(parseInt(hex.slice(0,8),16)%10000).padStart(4,'0');
}

function passwordResetMailOAuthConfigure_(body) {
  requireUser_(String(body.id_token||''),['ADMIN']);
  const clientId=String(body.client_id||'').trim();
  const clientSecret=String(body.client_secret||'').trim();
  const refreshToken=String(body.refresh_token||'').trim();
  const scopeVerified=String(body.scope_verified||'').trim();
  if(clientId.length<20||clientSecret.length<10||refreshToken.length<20||scopeVerified!=='gmail.send')throw new Error('MAIL_OAUTH_CONFIG_INVALID');
  PropertiesService.getScriptProperties().setProperties({
    MAIL_OAUTH_CLIENT_ID:clientId,
    MAIL_OAUTH_CLIENT_SECRET:clientSecret,
    MAIL_OAUTH_REFRESH_TOKEN:refreshToken,
    MAIL_OAUTH_SCOPE_VERIFIED:'gmail.send',
    MAIL_OAUTH_CONFIGURED_AT:new Date().toISOString()
  },false);
  return {ok:true,provider:'GMAIL_API_OAUTH',scope_verified:'gmail.send',recovery_email:BH_PASSWORD_RECOVERY_EMAIL};
}

function passwordResetMailAccessToken_() {
  const props=PropertiesService.getScriptProperties();
  if(String(props.getProperty('MAIL_OAUTH_SCOPE_VERIFIED')||'')!=='gmail.send')throw new Error('MAIL_OAUTH_SCOPE_NOT_VERIFIED');
  const response=UrlFetchApp.fetch('https://oauth2.googleapis.com/token',{
    method:'post',
    contentType:'application/x-www-form-urlencoded',
    payload:{
      client_id:requiredProp_('MAIL_OAUTH_CLIENT_ID'),
      client_secret:requiredProp_('MAIL_OAUTH_CLIENT_SECRET'),
      refresh_token:requiredProp_('MAIL_OAUTH_REFRESH_TOKEN'),
      grant_type:'refresh_token'
    },
    muteHttpExceptions:true
  });
  if(response.getResponseCode()<200||response.getResponseCode()>=300)throw new Error('MAIL_OAUTH_REFRESH_FAILED');
  const payload=JSON.parse(response.getContentText()||'{}');
  if(!payload.access_token)throw new Error('MAIL_OAUTH_ACCESS_TOKEN_MISSING');
  return String(payload.access_token);
}

function passwordResetGmailSend_(to,subject,bodyText) {
  const accessToken=passwordResetMailAccessToken_();
  const encodedSubject=Utilities.base64Encode(Utilities.newBlob(String(subject)).getBytes());
  const raw=[
    'To: '+String(to),
    'Subject: =?UTF-8?B?'+encodedSubject+'?=',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    String(bodyText)
  ].join('\r\n');
  const rawEncoded=Utilities.base64EncodeWebSafe(Utilities.newBlob(raw).getBytes()).replace(/=+$/,'');
  const response=UrlFetchApp.fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{
    method:'post',
    contentType:'application/json',
    headers:{Authorization:'Bearer '+accessToken},
    payload:JSON.stringify({raw:rawEncoded}),
    muteHttpExceptions:true
  });
  if(response.getResponseCode()<200||response.getResponseCode()>=300)throw new Error('PASSWORD_RESET_GMAIL_SEND_FAILED_HTTP_'+response.getResponseCode());
  return true;
}

function passwordResetMailCapability_(body) {
  requireUser_(String(body.id_token||''),['ADMIN']);
  passwordResetMailAccessToken_();
  return {ok:true,provider:'GMAIL_API_OAUTH',recovery_email:BH_PASSWORD_RECOVERY_EMAIL,send_scope_verified:true};
}

function passwordResetRequest_(body) {
  const target=passwordResetProfile_(body.employee_code);
  const employeeCode=String(target.employee_code||'');
  const fullName=String(target.full_name||'');
  const key='PWD_RESET_MS_'+sha256Hex_(employeeCode.toLowerCase()).slice(0,24);
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(10000))throw new Error('RESET_BUSY_TRY_AGAIN');
  try {
    const props=PropertiesService.getScriptProperties();
    const now=Date.now();
    const last=Number(props.getProperty(key)||0);
    if(last&&now-last<BH_PASSWORD_RESET_COOLDOWN_MS) {
      return {
        ok:false,
        error:'RESET_COOLDOWN',
        retry_after_seconds:Math.ceil((BH_PASSWORD_RESET_COOLDOWN_MS-(now-last))/1000),
        employee_code:employeeCode,
        full_name:fullName,
        recovery_email:BH_PASSWORD_RECOVERY_EMAIL
      };
    }
    passwordResetMailAccessToken_();
    props.setProperty(key,String(now));
    const code4=passwordResetCode4_();
    const subject='[Báo hàng 1291] Mật khẩu tạm cho '+employeeCode;
    const bodyText=[
      'BÁO HÀNG 1291',
      '',
      'Yêu cầu lấy lại mật khẩu đã được xác nhận.',
      'Mã nhân viên: '+employeeCode,
      'Họ tên: '+fullName,
      'Mật khẩu tạm 4 số: '+code4,
      '',
      'Đăng nhập Web bằng mã nhân viên và 4 số trên, sau đó đổi sang mật khẩu mới.',
      'Nếu không yêu cầu thao tác này, vui lòng bỏ qua email và liên hệ quản trị.'
    ].join('\n');
    passwordResetGmailSend_(BH_PASSWORD_RECOVERY_EMAIL,subject,bodyText);
    try {
      firebaseAdminUpdate_(String(target.id||''),{password:BH_TEMP_PASSWORD_PREFIX+code4,disableUser:false});
    } catch(error) {
      props.deleteProperty(key);
      throw error;
    }
    return {
      ok:true,
      sent:true,
      employee_code:employeeCode,
      full_name:fullName,
      recovery_email:BH_PASSWORD_RECOVERY_EMAIL,
      cooldown_seconds:Math.floor(BH_PASSWORD_RESET_COOLDOWN_MS/1000)
    };
  } finally {
    lock.releaseLock();
  }
}

function importUsers_(body) {
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

function userUpsert_(body) {
  const caller = requireUser_(String(body.id_token||''), ['ADMIN','ADMIN_INVENT']);
  const item = body.user || {};
  const code=String(item.employee_code||'').trim(),name=String(item.full_name||'').trim();
  if(!/^[a-z0-9._-]+$/i.test(code)||!name)throw new Error('INVALID_USER');
  const role=String(item.role||'PICKER').toUpperCase();
  if(['ADMIN','ADMIN_INVENT','INVENT','PICKER'].indexOf(role)<0)throw new Error('INVALID_ROLE');
  if(caller.profile.role==='ADMIN_INVENT' && ['INVENT','PICKER'].indexOf(role)<0)throw new Error('FORBIDDEN');
  if(code===BH_PROTECTED_ADMIN_CODE && caller.profile.role!=='ADMIN')throw new Error('FORBIDDEN');
  const token=workerAdminIdToken_();
  let uid=String(item.id||'').trim();
  const isNew=!uid;
  if(isNew)uid=Utilities.getUuid();
  const suppliedPassword=String(item.new_password||item.initial_password||'');
  const password=isNew && !suppliedPassword ? requiredProp_('STAFF_DEFAULT_PASSWORD') : suppliedPassword;
  if(isNew && password.length<6)throw new Error('PASSWORD_TOO_SHORT');
  if(isNew) firebaseAdminCreate_(uid,employeeEmail_(code),password,name,item.active===false);
  try {
    const patch={email:employeeEmail_(code),displayName:name,disableUser:item.active===false,customAttributes:claims_(code,role),emailVerified:true};
    if(!isNew && password)patch.password=password;
    firebaseAdminUpdate_(uid,patch);
    const profile=neonRpc_('worker_profile_upsert_rpc',{p_id:uid,p_employee_code:code,p_full_name:name,p_contractor:String(item.contractor||''),p_role:role,p_active:item.active!==false,p_source_kind:'MANUAL',p_source_position:String(item.source_position||''),p_protected_account:code===BH_PROTECTED_ADMIN_CODE},token);
    workerTick_('USER_UPSERT');
    return {ok:true,profile:profile};
  } catch(error){if(isNew)try{firebaseAdminDelete_(uid);}catch(ignore){}throw error;}
}

function userDisable_(body) {
  const caller=requireUser_(String(body.id_token||''),['ADMIN','ADMIN_INVENT']);
  const uid=String(body.user_id||'');
  if(!uid)throw new Error('USER_ID_REQUIRED');
  const token=workerAdminIdToken_();
  const list=neonRpc_('api_list_users_rpc',{p_test_role:null},token);
  const users=list&&Array.isArray(list.users)?list.users:[];
  const target=users.find(function(u){return String(u.id)===uid;});
  if(!target)throw new Error('USER_NOT_FOUND');
  if(target.protected_account||target.role==='ADMIN')throw new Error('PROTECTED_ADMIN');
  if(caller.profile.role==='ADMIN_INVENT'&&['INVENT','PICKER'].indexOf(String(target.role||''))<0)throw new Error('FORBIDDEN');
  firebaseAdminUpdate_(uid,{disableUser:true});
  const profile=neonRpc_('worker_profile_deactivate_rpc',{p_id:uid,p_reason:'ADMIN_DISABLE'},token);
  workerTick_('USER_DISABLE');
  return {ok:true,profile:profile};
}

function uploadLog_(body) {
  const idToken=String(body.id_token||'');
  const caller=requireUser_(idToken,null);
  const b64=String(body.gzip_base64||'');
  const bytes=Utilities.base64Decode(b64);
  if(!bytes.length||bytes.length>2097152)throw new Error('LOG_SIZE_INVALID');
  const expected=String(body.sha256||'').toLowerCase();
  if(!/^[0-9a-f]{64}$/.test(expected)||sha256HexBytes_(bytes)!==expected)throw new Error('LOG_SHA_MISMATCH');
  const safeCode=String(caller.profile.employee_code||'user').replace(/[^a-zA-Z0-9._-]/g,'-');
  const file=getLogFolder_().createFile(Utilities.newBlob(bytes,'application/gzip','log_'+safeCode+'_'+Date.now()+'_'+Utilities.getUuid()+'.jsonl.gz'));
  try {
    const registered=neonRpc_('diagnostic_log_register_rpc',{p_object_path:'drive:'+file.getId(),p_compressed_bytes:bytes.length,p_sha256:expected,p_device_name:String(body.device_name||''),p_app_version:String(body.app_version||''),p_client_created_at:body.client_created_at||null},idToken)||{};
    return Object.assign({ok:true},registered);
  } catch(error){try{file.setTrashed(true);}catch(ignore){}throw error;}
}

function downloadLog_(body) {
  const idToken=String(body.id_token||'');
  requireUser_(idToken,['ADMIN','ADMIN_INVENT']);
  const meta=neonRpc_('diagnostic_log_download_meta_rpc',{p_id:String(body.id||'')},idToken);
  const path=String(meta.object_path||'');
  if(path.indexOf('drive:')!==0)throw new Error('LOG_NOT_ON_DRIVE');
  const file=DriveApp.getFileById(path.substring(6));
  const bytes=file.getBlob().getBytes();
  if(bytes.length>2097152)throw new Error('LOG_SIZE_INVALID');
  if(sha256HexBytes_(bytes)!==String(meta.sha256||'').toLowerCase())throw new Error('LOG_SHA_MISMATCH');
  return {ok:true,id:String(meta.id),filename:file.getName(),mime_type:'application/gzip',gzip_base64:Utilities.base64Encode(bytes)};
}

function requireUser_(idToken, allowedRoles) {
  if(!idToken)throw new Error('AUTH_REQUIRED');
  const payload=verifyFirebaseIdToken_(idToken);
  const profile=neonRpc_('api_session_profile_rpc',{p_test_role:null},idToken);
  if(!profile||!profile.profile||profile.profile.active!==true)throw new Error('USER_INACTIVE');
  const role=String(profile.profile.role||'PICKER');
  if(allowedRoles&&allowedRoles.indexOf(role)<0)throw new Error('FORBIDDEN');
  return {uid:String(payload.sub||''),profile:profile.profile};
}

function requireRealtimeCaller_(idToken) {
  if(!idToken)throw new Error('AUTH_REQUIRED');
  // Neon Data API validates the Firebase JWT before the RPC executes, so the
  // high-frequency realtime kick does not need a second Firebase lookup.
  const session=neonRpc_('api_session_profile_rpc',{p_test_role:null},idToken);
  if(!session||!session.profile||session.profile.active!==true)throw new Error('USER_INACTIVE');
  return session.profile;
}

function realtimeKick_(body) {
  const topic=String(body.topic||'').trim();
  if(topic!=='issues')throw new Error('REALTIME_TOPIC_INVALID');
  const entityId=String(body.entity_id||'').trim();
  if(!/^[0-9a-f-]{36}$/i.test(entityId))throw new Error('REALTIME_ENTITY_INVALID');
  const entityVersion=Math.max(0,Number(body.entity_version||0));
  const reason=String(body.reason||'client').slice(0,80);
  const access=firebaseOAuthAccessToken_('https://www.googleapis.com/auth/firebase.messaging');
  const data={
    event_type:'REALTIME_DELTA',
    topic:'issues',
    realtime_event_id:'0',
    entity_id:entityId,
    entity_version:String(entityVersion),
    source:'client:'+reason
  };
  const message={
    topic:'bao-hang-1291-issues-operators',
    data:data,
    android:{priority:'high',ttl:'60s',collapse_key:'realtime-issues'}
  };
  const url='https://fcm.googleapis.com/v1/projects/'+BH_PROJECT+'/messages:send';
  const res=UrlFetchApp.fetch(url,{
    method:'post',
    contentType:'application/json',
    headers:{Authorization:'Bearer '+access},
    payload:JSON.stringify({message:message}),
    muteHttpExceptions:true
  });
  const code=res.getResponseCode();
  if(code<200||code>=300)throw new Error('FCM_REALTIME_TOPIC_'+code+': '+res.getContentText().slice(0,300));
  return {ok:true,topic:topic,entity_id:entityId,entity_version:entityVersion};
}

function neonRpc_(name, payload, idToken) {
  const allowed=/^(api_|worker_|diagnostic_)[a-z0-9_]+_rpc$/.test(name)||name==='report_shortage_rpc';
  if(!allowed)throw new Error('RPC_NOT_ALLOWED');
  const base=requiredProp_('NEON_DATA_API').replace(/\/$/,'');
  const res=UrlFetchApp.fetch(base+'/rpc/'+name,{method:'post',contentType:'application/json',headers:{Authorization:'Bearer '+idToken},payload:JSON.stringify(payload||{}),muteHttpExceptions:true});
  const code=res.getResponseCode();
  const text=res.getContentText();
  let parsed=null;try{parsed=text?JSON.parse(text):null}catch(ignore){}
  if(code<200||code>=300)throw new Error('NEON_'+code+': '+String(parsed&&parsed.message?parsed.message:text).slice(0,500));
  return parsed;
}

function workerAdminIdToken_() {
  const cache=CacheService.getScriptCache();
  const cached=cache.get('WORKER_ADMIN_ID_TOKEN');
  if(cached)return cached;
  const uid=requiredProp_('WORKER_ADMIN_UID');
  const sa=serviceAccount_();
  const now=Math.floor(Date.now()/1000);
  const custom=signJwt_(sa,{iss:sa.client_email,sub:sa.client_email,aud:'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',iat:now,exp:now+3600,uid:uid});
  const data=fetchJson_('https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key='+encodeURIComponent(requiredProp_('FIREBASE_WEB_API_KEY')),{method:'post',contentType:'application/json',payload:JSON.stringify({token:custom,returnSecureToken:true}),muteHttpExceptions:true});
  if(!data.idToken)throw new Error('FIREBASE_CUSTOM_TOKEN_FAILED');
  const token=String(data.idToken);
  cache.put('WORKER_ADMIN_ID_TOKEN',token,3000);
  return token;
}

function verifyFirebaseIdToken_(token) {
  const raw=String(token||'');
  const parts=raw.split('.');
  if(parts.length!==3)throw new Error('INVALID_TOKEN');
  let payload=null;
  try { payload=JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[1])).getDataAsString()); }
  catch(ignore) { throw new Error('INVALID_TOKEN'); }
  const now=Math.floor(Date.now()/1000);
  if(!payload||payload.aud!==BH_PROJECT||payload.iss!=='https://securetoken.google.com/'+BH_PROJECT||!payload.sub||Number(payload.exp||0)<=now||Number(payload.iat||0)>now+60)throw new Error('INVALID_TOKEN_CLAIMS');
  const res=UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key='+encodeURIComponent(requiredProp_('FIREBASE_WEB_API_KEY')),{method:'post',contentType:'application/json',payload:JSON.stringify({idToken:raw}),muteHttpExceptions:true});
  let body={};try{body=JSON.parse(res.getContentText()||'{}')}catch(ignore){}
  const user=body&&Array.isArray(body.users)&&body.users.length?body.users[0]:null;
  if(res.getResponseCode()!==200||!user||String(user.localId||'')!==String(payload.sub)||user.disabled===true)throw new Error('INVALID_TOKEN');
  const validSince=Number(user.validSince||0), authTime=Number(payload.auth_time||payload.iat||0);
  if(validSince&&authTime<validSince)throw new Error('TOKEN_REVOKED');
  return payload;
}

function firebaseOAuthAccessToken_(scope) {
  const cache=CacheService.getScriptCache();
  const key='OAUTH_'+String(scope||'').replace(/[^a-z0-9]/gi,'_').slice(-80);
  const cached=cache.get(key);
  if(cached)return cached;
  const sa=serviceAccount_();
  const now=Math.floor(Date.now()/1000);
  const assertion=signJwt_(sa,{iss:sa.client_email,scope:scope,aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
  const response=UrlFetchApp.fetch('https://oauth2.googleapis.com/token',{method:'post',payload:{grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:assertion},muteHttpExceptions:true});
  let body={};try{body=JSON.parse(response.getContentText()||'{}')}catch(ignore){}
  if(response.getResponseCode()!==200||!body.access_token)throw new Error('GOOGLE_OAUTH_FAILED');
  const token=String(body.access_token);
  cache.put(key,token,3000);
  return token;
}

function firebaseAdminCreate_(uid,email,password,displayName,disabled) {
  return firebaseIdentityPost_('projects/'+BH_PROJECT+'/accounts',{localId:uid,email:email,password:password,displayName:displayName,emailVerified:true,disabled:!!disabled});
}
function firebaseAdminUpdate_(uid,patch) {
  const body={localId:uid};
  if(patch.email!==undefined)body.email=patch.email;
  if(patch.password)body.password=patch.password;
  if(patch.displayName!==undefined)body.displayName=patch.displayName;
  if(patch.emailVerified!==undefined)body.emailVerified=!!patch.emailVerified;
  if(patch.disableUser!==undefined)body.disableUser=!!patch.disableUser;
  if(patch.customAttributes!==undefined)body.customAttributes=JSON.stringify(patch.customAttributes);
  return firebaseIdentityPost_('projects/'+BH_PROJECT+'/accounts:update',body);
}
function firebaseAdminDelete_(uid) { return firebaseIdentityPost_('projects/'+BH_PROJECT+'/accounts:delete',{localId:uid}); }
function firebaseIdentityPost_(path,body) {
  const access=firebaseOAuthAccessToken_('https://www.googleapis.com/auth/identitytoolkit');
  const res=UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/'+path,{method:'post',contentType:'application/json',headers:{Authorization:'Bearer '+access},payload:JSON.stringify(body),muteHttpExceptions:true});
  const text=res.getContentText();if(res.getResponseCode()<200||res.getResponseCode()>=300)throw new Error('FIREBASE_ADMIN_'+res.getResponseCode()+': '+text.slice(0,500));return text?JSON.parse(text):{};
}

function claims_(employeeCode, role) { return {role:'authenticated',employee_code:String(employeeCode),app_role:String(role)}; }
function employeeEmail_(code) { return String(code).toLowerCase()+'@bao-hang-1291.local'; }
function staffRole_(position,department,code) {
  if(String(code)===BH_PROTECTED_ADMIN_CODE)return 'ADMIN';
  const p=String(position||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/Đ/g,'D').toUpperCase();
  const d=String(department||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/Đ/g,'D').toUpperCase();
  if(p.indexOf('DIEU PHOI')>=0)return 'ADMIN_INVENT';
  if(d.indexOf('INVENT')>=0||p.indexOf('INVENT')>=0)return 'INVENT';
  return 'PICKER';
}

function sheetWebhook_(body) {
  const expected=PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET');
  if(!expected||String(body.secret)!==expected)return {ok:false,error:'Unauthorized'};
  const lock=LockService.getScriptLock();lock.waitLock(25000);
  try{
    const events=Array.isArray(body.events)?body.events:[];
    const applied=applyEventsBatch_(events);
    return {ok:true,processed:events.length,sheet:applied};
  }finally{lock.releaseLock();}
}

function applyEventsBatch_(events) {
  const list=Array.isArray(events)?events:[];
  if(!list.length)return {events_appended:0,users_upserted:0,issues_upserted:0};

  const ss=reportSpreadsheet_();
  const eventSheet=ss.getSheetByName('SU_KIEN');
  const userSheet=ss.getSheetByName('NHAN_SU');
  const issueSheet=ss.getSheetByName('TRANG_THAI_SKU');
  if(!eventSheet||!userSheet||!issueSheet)throw new Error('SHEET_STRUCTURE_MISSING');

  // SU_KIEN is append-only. Read only the recent tail so a retry after a
  // partial write remains idempotent without scanning the full history.
  const eventLast=eventSheet.getLastRow();
  const tailStart=Math.max(2,eventLast-4999);
  const tailCount=eventLast>=tailStart?eventLast-tailStart+1:0;
  const recentIds=new Set(
    tailCount>0
      ? eventSheet.getRange(tailStart,1,tailCount,1).getValues().map(function(row){return String(row[0]||'');})
      : []
  );

  const userLast=userSheet.getLastRow();
  const userRows=userLast>=2?userSheet.getRange(2,1,userLast-1,BH_USER_HEADERS.length).getValues():[];
  const userIndex={};
  userRows.forEach(function(row,i){const key=String(row[0]||'').trim();if(key)userIndex[key]=i;});

  const issueLast=issueSheet.getLastRow();
  const issueRows=issueLast>=2?issueSheet.getRange(2,1,issueLast-1,BH_ISSUE_HEADERS.length).getValues():[];
  const issueIndex={};
  issueRows.forEach(function(row,i){const key=String(row[0]||'').trim();if(key)issueIndex[key]=i;});

  const eventRows=[];
  let usersChanged=0,issuesChanged=0;

  list.forEach(function(event){
    if(!event||typeof event!=='object')throw new Error('SHEET_EVENT_INVALID');
    const payload=(event.payload&&typeof event.payload==='object'&&!Array.isArray(event.payload))?event.payload:{};
    const eventType=String(event.event_type||event.type||'').trim().toUpperCase();
    const eventId=String(event.event_id||event.queue_id||event.id||'').trim();
    if(!eventId)throw new Error('SHEET_EVENT_ID_REQUIRED');

    const issueId=String(event.issue_id||payload.id||event.ticket_id||'').trim();
    const sku=String(event.sku||payload.sku||'').trim();
    const productName=String(event.product_name||payload.product_name||'').trim();
    const status=String(event.status||payload.status||'').trim();
    const reportCount=Number(event.report_count!==undefined?event.report_count:(payload.report_count||0));
    const actorId=String(event.actor_account_id||event.actor_user_id||payload.actor_id||payload.reporter_id||'').trim();
    const eventTime=event.created_at||event.accepted_at_authority||event.occurred_at_device||payload.updated_at||new Date().toISOString();

    if(!recentIds.has(eventId)){
      eventRows.push([eventId,eventTime,eventType,issueId,sku,productName,status,reportCount,actorId,JSON.stringify(payload)]);
      recentIds.add(eventId);
    }

    if(eventType==='USER_UPSERT'||eventType==='USER'){
      const employeeCode=String(payload.employee_code||event.employee_code||'').trim();
      if(!employeeCode)throw new Error('SHEET_EMPLOYEE_CODE_REQUIRED');
      const active=(payload.active!==undefined?payload.active:event.active)!==false;
      const row=[
        employeeCode,
        String(payload.full_name||event.full_name||''),
        String(payload.contractor||event.contractor||''),
        String(payload.role||event.role||''),
        active?'HOẠT ĐỘNG':'NGỪNG HOẠT ĐỘNG',
        payload.updated_at||event.updated_at||eventTime
      ];
      if(userIndex[employeeCode]===undefined){
        userIndex[employeeCode]=userRows.length;
        userRows.push(row);
      }else userRows[userIndex[employeeCode]]=row;
      usersChanged++;
    }

    if(eventType==='REPORT_SHORTAGE'||eventType==='ISSUE_STATUS'||eventType==='ISSUE'){
      if(!issueId)throw new Error('SHEET_ISSUE_ID_REQUIRED');
      const row=[
        issueId,
        sku,
        productName,
        status,
        reportCount,
        payload.first_reported_at||payload.reported_at||event.first_reported_at||'',
        payload.updated_at||event.last_reported_at||event.updated_at||eventTime,
        String(payload.assigned_name||event.invent_assignee_name||event.invent_assignee_id||''),
        Number(payload.reopen_count!==undefined?payload.reopen_count:(event.reopen_count||0))
      ];
      if(issueIndex[issueId]===undefined){
        issueIndex[issueId]=issueRows.length;
        issueRows.push(row);
      }else issueRows[issueIndex[issueId]]=row;
      issuesChanged++;
    }
  });

  if(eventRows.length){
    eventSheet.getRange(eventLast+1,1,eventRows.length,BH_EVENT_HEADERS.length).setValues(eventRows);
  }
  if(usersChanged&&userRows.length){
    userSheet.getRange(2,1,userRows.length,BH_USER_HEADERS.length).setValues(userRows);
  }
  if(issuesChanged&&issueRows.length){
    issueSheet.getRange(2,1,issueRows.length,BH_ISSUE_HEADERS.length).setValues(issueRows);
  }

  return {
    events_appended:eventRows.length,
    users_upserted:usersChanged,
    issues_upserted:issuesChanged
  };
}

function applyEvent_(event) {
  if(!event || typeof event !== 'object') throw new Error('SHEET_EVENT_INVALID');
  const payload=(event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)) ? event.payload : {};
  const eventType=String(event.event_type || event.type || '').trim().toUpperCase();
  const eventId=String(event.event_id || event.queue_id || event.id || '').trim();
  if(!eventId) throw new Error('SHEET_EVENT_ID_REQUIRED');

  const issueId=String(event.issue_id || payload.id || event.ticket_id || '').trim();
  const sku=String(event.sku || payload.sku || '').trim();
  const productName=String(event.product_name || payload.product_name || '').trim();
  const status=String(event.status || payload.status || '').trim();
  const reportCount=Number(event.report_count !== undefined ? event.report_count : (payload.report_count || 0));
  const actorId=String(event.actor_account_id || event.actor_user_id || payload.actor_id || payload.reporter_id || '').trim();
  const eventTime=event.created_at || event.accepted_at_authority || event.occurred_at_device || payload.updated_at || new Date().toISOString();

  const eventSheet=reportSpreadsheet_().getSheetByName('SU_KIEN');
  if(!eventSheet) throw new Error('Thiếu tab SU_KIEN');
  upsertByKey_(eventSheet,1,eventId,[eventId,eventTime,eventType,issueId,sku,productName,status,reportCount,actorId,JSON.stringify(payload)]);

  if(eventType === 'USER_UPSERT' || eventType === 'USER') {
    const employeeCode=String(payload.employee_code || event.employee_code || '').trim();
    if(!employeeCode) throw new Error('SHEET_EMPLOYEE_CODE_REQUIRED');
    const userSheet=reportSpreadsheet_().getSheetByName('NHAN_SU');
    if(!userSheet) throw new Error('Thiếu tab NHAN_SU');
    const active=(payload.active !== undefined ? payload.active : event.active) !== false;
    upsertByKey_(userSheet,1,employeeCode,[
      employeeCode,
      String(payload.full_name || event.full_name || ''),
      String(payload.contractor || event.contractor || ''),
      String(payload.role || event.role || ''),
      active ? 'HOẠT ĐỘNG' : 'NGỪNG HOẠT ĐỘNG',
      payload.updated_at || event.updated_at || eventTime
    ]);
  }

  if(eventType === 'REPORT_SHORTAGE' || eventType === 'ISSUE_STATUS' || eventType === 'ISSUE') {
    if(!issueId) throw new Error('SHEET_ISSUE_ID_REQUIRED');
    const issueSheet=reportSpreadsheet_().getSheetByName('TRANG_THAI_SKU');
    if(!issueSheet) throw new Error('Thiếu tab TRANG_THAI_SKU');
    upsertByKey_(issueSheet,1,issueId,[
      issueId,
      sku,
      productName,
      status,
      reportCount,
      payload.first_reported_at || payload.reported_at || event.first_reported_at || '',
      payload.updated_at || event.last_reported_at || event.updated_at || eventTime,
      String(payload.assigned_name || event.invent_assignee_name || event.invent_assignee_id || ''),
      Number(payload.reopen_count !== undefined ? payload.reopen_count : (event.reopen_count || 0))
    ]);
  }
}

function upsertByKey_(sheet,keyCol,key,values) {
  const last=sheet.getLastRow();let row=0;
  if(last>=2){const found=sheet.getRange(2,keyCol,last-1,1).createTextFinder(String(key)).matchEntireCell(true).findNext();if(found)row=found.getRow();}
  if(row)sheet.getRange(row,1,1,values.length).setValues([values]);else sheet.appendRow(values);
}

function reportSpreadsheet_(){const ss=SpreadsheetApp.openById(BH_REPORT_SHEET_ID);if(ss.getId()!==BH_REPORT_SHEET_ID)throw new Error('REPORT_SHEET_SCOPE_MISMATCH');return ss;}
function getOrCreateSheet_(name,headers) {
  const ss=reportSpreadsheet_();
  let s=ss.getSheetByName(name);
  if(!s)s=ss.insertSheet(name);
  if(s.getMaxColumns()<headers.length)s.insertColumnsAfter(s.getMaxColumns(),headers.length-s.getMaxColumns());
  s.getRange(1,1,1,headers.length).setValues([headers]);
  s.setFrozenRows(1);
  return s;
}
function getLogFolder_(){return DriveApp.getFolderById(BH_LOG_FOLDER_ID);}
function parseBody_(e){if(!e||!e.postData||!e.postData.contents)return{};try{return JSON.parse(e.postData.contents)}catch(ignore){return{}}}
function fetchJson_(url,opts){const r=UrlFetchApp.fetch(url,opts||{});const t=r.getContentText();try{return t?JSON.parse(t):{}}catch(ignore){return{ok:false,error:'INVALID_JSON',http:r.getResponseCode()}}}
function safeError_(e){return String(e&&e.message?e.message:e).slice(0,1000)}
function json_(obj){return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON)}
function sha256Hex_(text){return sha256HexBytes_(Utilities.newBlob(text).getBytes())}
function sha256HexBytes_(bytes){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes).map(function(b){const n=(b+256)%256;return('0'+n.toString(16)).slice(-2)}).join('')}
function signJwt_(sa,claims){const h=base64WebSafeText_(JSON.stringify({alg:'RS256',typ:'JWT'}));const p=base64WebSafeText_(JSON.stringify(claims));const unsigned=h+'.'+p;const signature=Utilities.computeRsaSha256Signature(unsigned,sa.private_key);return unsigned+'.'+Utilities.base64EncodeWebSafe(signature).replace(/=+$/,'')}
function base64WebSafeText_(text){return Utilities.base64EncodeWebSafe(Utilities.newBlob(String(text)).getBytes()).replace(/=+$/,'')}
function serviceAccount_(){const raw=requiredProp_('FIREBASE_SERVICE_ACCOUNT');const sa=JSON.parse(raw);if(sa.project_id!==BH_PROJECT)throw new Error('FIREBASE_SCOPE_MISMATCH');return sa;}
function requiredProp_(name){const v=PropertiesService.getScriptProperties().getProperty(name)||'';if(!v)throw new Error(name+'_MISSING');return v;}
function assertScope_(){const p=PropertiesService.getScriptProperties();if(p.getProperty('FIREBASE_PROJECT_ID')!==BH_PROJECT||p.getProperty('NEON_PROJECT_ID')!==BH_NEON_PROJECT||p.getProperty('NEON_BRANCH_ID')!==BH_NEON_BRANCH)throw new Error('WORKER_SCOPE_MISMATCH');}
