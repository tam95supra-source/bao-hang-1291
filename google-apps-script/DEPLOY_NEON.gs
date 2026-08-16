/**
 * BÁO HÀNG 1291 — Neon/Firebase/Google worker bundle.
 * Target only: Firebase bao-hang-1291 + Neon tiny-boat-19315489.
 * No secret is stored in source. Secrets are bootstrapped into Script Properties.
 */
const BH_PROJECT = 'bao-hang-1291';
const BH_SOURCE_REF = 'oedasgcdjppjwidhlqdr';
const BH_NEON_PROJECT = 'tiny-boat-19315489';
const BH_NEON_BRANCH = 'br-delicate-scene-azdfkigf';
const BH_BOOTSTRAP_URL = 'https://oedasgcdjppjwidhlqdr.supabase.co/functions/v1/migration-apps-script-bootstrap';
const BH_STAFF_SHEET_ID = '1FRROqCp1lmkuHc3lc4UBpVI5_ZrtiPI1thlEymv458E';
const BH_STAFF_SHEET_NAME = 'DANH MỤC NHÂN SỰ';
const BH_PROTECTED_ADMIN_CODE = '6281280';
const BH_LOG_FOLDER = 'Báo hàng 1291 - Diagnostic Logs';
const BH_EVENT_HEADERS = ['Queue ID','Thời gian','Loại sự kiện','Ticket ID','SKU','Tên sản phẩm','Trạng thái','Số lượt báo','Người báo/Actor ID','Dữ liệu JSON'];
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
    ['Lưu báo cáo','Theo cấu hình hệ thống'],
    ['Cập nhật',new Date()]
  ]);
  getLogFolder_();
  return 'Đã tạo cấu trúc Google Sheet BÁO HÀNG 1291';
}

function bootstrapNeonWorker() {
  const props = PropertiesService.getScriptProperties();
  const secret = props.getProperty('WEBHOOK_SECRET') || '';
  if (secret.length < 20) throw new Error('WEBHOOK_SECRET chưa được cấu hình');
  const response = fetchJson_(BH_BOOTSTRAP_URL, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      project: BH_PROJECT,
      supabase_ref: BH_SOURCE_REF,
      neon_project: BH_NEON_PROJECT,
      neon_branch: BH_NEON_BRANCH,
      webhook_secret: secret
    }),
    muteHttpExceptions: true
  });
  if (!response.ok) throw new Error('Bootstrap thất bại: ' + String(response.error || 'UNKNOWN'));
  if (!response.scope || response.scope.project !== BH_PROJECT || response.scope.supabase_ref !== BH_SOURCE_REF || response.scope.neon_project !== BH_NEON_PROJECT || response.scope.neon_branch !== BH_NEON_BRANCH) {
    throw new Error('BOOTSTRAP_SCOPE_MISMATCH');
  }
  props.setProperties({
    FIREBASE_SERVICE_ACCOUNT: String(response.firebase_service_account || ''),
    STAFF_DEFAULT_PASSWORD: String(response.staff_default_password || ''),
    NEON_DATA_API: String(response.neon_data_api || ''),
    FIREBASE_WEB_API_KEY: String(response.firebase_web_api_key || ''),
    FIREBASE_PROJECT_ID: String(response.firebase_project_id || ''),
    WORKER_ADMIN_UID: String(response.worker_admin_uid || ''),
    NEON_PROJECT_ID: BH_NEON_PROJECT,
    NEON_BRANCH_ID: BH_NEON_BRANCH,
    BOOTSTRAP_VERSION: String(response.bootstrap_version || 1),
    BOOTSTRAP_AT: new Date().toISOString()
  }, false);
  assertScope_();
  installWorkerTriggers_();
  setupBaoHang1291();
  return {ok:true, project:BH_PROJECT, neon_project:BH_NEON_PROJECT, neon_branch:BH_NEON_BRANCH};
}

function doPost(e) {
  const body = parseBody_(e);
  try {
    if (body.secret && Array.isArray(body.events)) return json_(sheetWebhook_(body));
    const action = String(body.action || '').trim();
    if (!action) return json_({ok:false,error:'ACTION_REQUIRED'});
    if (action === 'ping') return json_({ok:true,project:BH_PROJECT,provider:'NEON_FIREBASE_GOOGLE'});
    if (action === 'worker-kick') {
      requireUser_(String(body.id_token || ''), null);
      return json_(workerTick_('CLIENT_KICK'));
    }
    if (action === 'upload-log') return json_(uploadLog_(body));
    if (action === 'download-log') return json_(downloadLog_(body));
    if (action === 'user-upsert') return json_(userUpsert_(body));
    if (action === 'user-disable') return json_(userDisable_(body));
    if (action === 'staff-sync-now') {
      const caller = requireUser_(String(body.id_token || ''), ['ADMIN','ADMIN_INVENT']);
      return json_(runStaffSync_('MANUAL', caller.profile));
    }
    return json_({ok:false,error:'ACTION_NOT_SUPPORTED'});
  } catch (error) {
    return json_({ok:false,error:safeError_(error)});
  }
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
    const notifications = drainNotifications_(token);
    const pushes = drainPushes_(token);
    const sheet = drainSheet_(token);
    const realtime = drainRealtime_(token);
    maybeCleanup_(token);
    maybeStaffSync_(token);
    const schedule = neonRpc_('worker_schedule_rpc', {p_realtime_enabled: !!props.getProperty('RTDB_URL')}, token);
    scheduleAdaptiveTrigger_(schedule && schedule.next_at ? String(schedule.next_at) : '');
    return {ok:true,source:source,tick:tick,notifications:notifications,pushes:pushes,sheet:sheet,realtime:realtime,schedule:schedule};
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
  const batch = neonRpc_('worker_notification_batch_rpc', {p_limit:200}, token) || [];
  let accepted = 0, failed = 0;
  batch.forEach(function(event) {
    const result = sendEventToTokens_(event, String(event.status || ''), token);
    neonRpc_('worker_notification_result_rpc', {
      p_event_id:String(event.event_id),
      p_accepted:result.accepted,
      p_invalid_tokens:result.invalidTokens,
      p_error:result.error || ''
    }, token);
    result.accepted ? accepted++ : failed++;
  });
  return {count:batch.length,accepted:accepted,failed:failed};
}

function drainPushes_(token) {
  const batch = neonRpc_('worker_push_batch_rpc', {p_limit:200}, token) || [];
  let accepted = 0, failed = 0;
  batch.forEach(function(event) {
    const result = sendEventToTokens_(event, String(event.event_status || ''), token);
    neonRpc_('worker_push_result_rpc', {
      p_id:String(event.id),
      p_accepted:result.accepted,
      p_invalid_tokens:result.invalidTokens,
      p_error:result.error || ''
    }, token);
    result.accepted ? accepted++ : failed++;
  });
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
  const events = neonRpc_('worker_sheet_batch_rpc', {p_limit:500}, token) || [];
  if (!events.length) return {count:0};
  const ids = [];
  events.forEach(function(event) { applyEvent_(event); ids.push(Number(event.id)); });
  const acked = neonRpc_('worker_sheet_ack_rpc', {p_ids:ids}, token);
  return {count:events.length,acked:Number(acked || 0)};
}

function drainRealtime_(token) {
  const props = PropertiesService.getScriptProperties();
  const base = String(props.getProperty('RTDB_URL') || '').replace(/\/$/,'');
  if (!base) return {enabled:false,count:0};
  if (base.indexOf(BH_PROJECT) < 0) throw new Error('RTDB_SCOPE_MISMATCH');
  const events = neonRpc_('worker_realtime_batch_rpc', {p_limit:200}, token) || [];
  let published = 0;
  events.forEach(function(event) {
    try {
      const path = '/events/' + encodeURIComponent(String(event.topic)) + '/' + String(event.id) + '.json?auth=' + encodeURIComponent(token);
      const res = UrlFetchApp.fetch(base + path, {method:'put',contentType:'application/json',payload:JSON.stringify(event),muteHttpExceptions:true});
      if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) throw new Error('RTDB_HTTP_'+res.getResponseCode());
      neonRpc_('worker_realtime_result_rpc', {p_id:Number(event.id),p_published:true,p_error:''}, token);
      published++;
    } catch (error) {
      neonRpc_('worker_realtime_result_rpc', {p_id:Number(event.id),p_published:false,p_error:safeError_(error)}, token);
    }
  });
  return {enabled:true,count:events.length,published:published};
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
  try { cfg = neonRpc_('api_get_config_rpc', {p_test_role:null}, token); } catch (ignore) { return; }
  if (!cfg || !cfg.staff_auto_sync_enabled) return;
  const interval = Math.max(15, Number(cfg.staff_sync_interval_minutes || 60));
  if (Date.now() - last < interval * 60000) return;
  runStaffSync_('AUTO', {role:'ADMIN'});
}

function runStaffSync_(triggerSource, callerProfile) {
  assertScope_();
  if (!callerProfile || ['ADMIN','ADMIN_INVENT'].indexOf(String(callerProfile.role)) < 0) throw new Error('FORBIDDEN');
  const token = workerAdminIdToken_();
  const source = fetchFilteredStaff_();
  const status = neonRpc_('api_staff_sync_status_rpc', {p_test_role:null,p_limit:20}, token);
  const runs = status && Array.isArray(status.runs) ? status.runs : [];
  const lastGood = runs.find(function(r){ return r.status === 'SUCCEEDED' || r.status === 'NO_CHANGE'; });
  if (lastGood && String(lastGood.source_hash || '') === source.sourceHash) {
    PropertiesService.getScriptProperties().setProperty('LAST_STAFF_SYNC_AT_MS', String(Date.now()));
    return {status:'NO_CHANGE',changed:false,eligible_rows:source.staff.length,source_bytes:source.responseBytes};
  }
  const runId = String(neonRpc_('worker_staff_run_start_rpc', {p_trigger_source:triggerSource,p_source_sheet_id:BH_STAFF_SHEET_ID}, token));
  const profiles = neonRpc_('worker_profiles_snapshot_rpc', {}, token) || [];
  const existing = {};
  profiles.forEach(function(p){ existing[String(p.employee_code).toLowerCase()] = p; });
  const seen = {};
  let created=0,updated=0,deactivated=0,failed=0;
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
      } catch (error) { failed++; errors.push(code+': '+safeError_(error)); }
    });
  }
  const finalStatus = failed ? 'PARTIAL' : 'SUCCEEDED';
  const result = neonRpc_('worker_staff_run_finish_rpc',{p_run_id:runId,p_status:finalStatus,p_source_hash:source.sourceHash,p_source_rows:source.staff.length,p_eligible_rows:source.staff.length,p_created:created,p_updated:updated,p_deactivated:deactivated,p_failed:failed,p_error_summary:errors.slice(0,20).join('; ').slice(0,2000),p_source_response_bytes:source.responseBytes},token);
  PropertiesService.getScriptProperties().setProperty('LAST_STAFF_SYNC_AT_MS', String(Date.now()));
  return {status:finalStatus,changed:true,run_id:runId,created:created,updated:updated,deactivated:deactivated,failed:failed,run:result};
}

function fetchFilteredStaff_() {
  const variants = ["select A,B,D,E where G = 1291 and H = 'HY1'","select A,B,D,E where G = '1291' and H = 'HY1'"];
  let lastError='';
  for (let q=0;q<variants.length;q++) {
    try {
      const url='https://docs.google.com/spreadsheets/d/'+BH_STAFF_SHEET_ID+'/gviz/tq?tqx=out%3Acsv&sheet='+encodeURIComponent(BH_STAFF_SHEET_NAME)+'&tq='+encodeURIComponent(variants[q]);
      const res=UrlFetchApp.fetch(url,{headers:{Accept:'text/csv'},followRedirects:true,muteHttpExceptions:true});
      if(res.getResponseCode()!==200){lastError='Google Sheet HTTP '+res.getResponseCode();continue;}
      const text=res.getContentText();
      if(!text||text.length>1000000){lastError='Nguồn nhân sự rỗng hoặc quá lớn';continue;}
      const rows=Utilities.parseCsv(text);
      if(rows.length<2){lastError='Query không trả nhân sự';continue;}
      const byCode={};
      rows.slice(1).forEach(function(row){
        const code=String(row[0]||'').trim(),name=String(row[1]||'').trim();
        if(!code||!name)return;
        const contractor=String(row[2]||'').trim(),position=String(row[3]||'').trim();
        byCode[code.toLowerCase()]={employee_code:code,full_name:name,contractor:contractor,source_position:position,role:staffRole_(position,code)};
      });
      const staff=Object.keys(byCode).sort().map(function(k){return byCode[k];});
      if(!staff.length){lastError='Không có nhân sự Site 1291 / HY1';continue;}
      const canonical=staff.map(function(x){return [x.employee_code,x.full_name,x.contractor,x.source_position,x.role].join('|');}).join('\n');
      return {staff:staff,sourceHash:sha256Hex_(canonical),responseBytes:Utilities.newBlob(text).getBytes().length};
    } catch(error){lastError=safeError_(error);}
  }
  throw new Error(lastError||'Không đọc được nguồn nhân sự');
}

function userUpsert_(body) {
  const caller = requireUser_(String(body.id_token||''), ['ADMIN','ADMIN_INVENT']);
  const item = body.user || {};
  const code=String(item.employee_code||'').trim(),name=String(item.full_name||'').trim();
  if(!/^[a-z0-9._-]+$/i.test(code)||!name)throw new Error('INVALID_USER');
  const role=String(item.role||'PICKER').toUpperCase();
  if(['ADMIN','ADMIN_INVENT','INVENT','PICKER'].indexOf(role)<0)throw new Error('INVALID_ROLE');
  if(caller.profile.role==='ADMIN_INVENT' && role!=='PICKER')throw new Error('FORBIDDEN');
  if(code===BH_PROTECTED_ADMIN_CODE && caller.profile.role!=='ADMIN')throw new Error('FORBIDDEN');
  const token=workerAdminIdToken_();
  let uid=String(item.id||'').trim();
  const isNew=!uid;
  if(isNew)uid=Utilities.getUuid();
  const password=String(item.new_password||item.initial_password||'');
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
  if(caller.profile.role==='ADMIN_INVENT'&&target.role!=='PICKER')throw new Error('FORBIDDEN');
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
    return neonRpc_('diagnostic_log_register_rpc',{p_object_path:'drive:'+file.getId(),p_compressed_bytes:bytes.length,p_sha256:expected,p_device_name:String(body.device_name||''),p_app_version:String(body.app_version||''),p_client_created_at:body.client_created_at||null},idToken);
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
  return {ok:true,id:String(meta.id||body.id),file_name:file.getName(),gzip_base64:Utilities.base64Encode(bytes),sha256:meta.sha256,compressed_bytes:bytes.length};
}

function getLogFolder_() {
  const props=PropertiesService.getScriptProperties();
  const existing=props.getProperty('LOG_FOLDER_ID');
  if(existing){try{return DriveApp.getFolderById(existing);}catch(ignore){}}
  const book=SpreadsheetApp.getActiveSpreadsheet();
  const file=DriveApp.getFileById(book.getId());
  const parents=file.getParents();
  const parent=parents.hasNext()?parents.next():DriveApp.getRootFolder();
  const iter=parent.getFoldersByName(BH_LOG_FOLDER);
  const folder=iter.hasNext()?iter.next():parent.createFolder(BH_LOG_FOLDER);
  props.setProperty('LOG_FOLDER_ID',folder.getId());
  return folder;
}

function requireUser_(idToken,allowed) {
  if(!idToken)throw new Error('AUTH_REQUIRED');
  const result=neonRpc_('api_session_profile_rpc',{p_test_role:null},idToken);
  const profile=result&&result.profile?result.profile:null;
  if(!profile||profile.active===false)throw new Error('USER_INACTIVE');
  if(allowed&&allowed.indexOf(String(profile.role))<0)throw new Error('FORBIDDEN');
  return {profile:profile,effective_role:result.effective_role};
}

function neonRpc_(name,payload,idToken) {
  assertScope_();
  const base=requiredProp_('NEON_DATA_API').replace(/\/$/,'');
  if(base.indexOf('ep-flat-feather-azdi44be')<0||base.indexOf('ap-southeast-1')<0)throw new Error('NEON_ENDPOINT_SCOPE_MISMATCH');
  const token=idToken||workerAdminIdToken_();
  const res=UrlFetchApp.fetch(base+'/rpc/'+encodeURIComponent(name),{method:'post',contentType:'application/json',headers:{Authorization:'Bearer '+token},payload:JSON.stringify(payload||{}),muteHttpExceptions:true});
  const text=res.getContentText();
  if(res.getResponseCode()<200||res.getResponseCode()>=300)throw new Error('NEON_'+name+'_'+res.getResponseCode()+': '+text.slice(0,500));
  return text?JSON.parse(text):null;
}

function workerAdminIdToken_() {
  const cache=CacheService.getScriptCache();
  const cached=cache.get('WORKER_ADMIN_ID_TOKEN');
  if(cached)return cached;
  const sa=serviceAccount_(),uid=requiredProp_('WORKER_ADMIN_UID');
  const now=Math.floor(Date.now()/1000);
  const custom=signJwt_(sa,{iss:sa.client_email,sub:sa.client_email,aud:'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',iat:now,exp:now+3600,uid:uid});
  const url='https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key='+encodeURIComponent(requiredProp_('FIREBASE_WEB_API_KEY'));
  const r=fetchJson_(url,{method:'post',contentType:'application/json',payload:JSON.stringify({token:custom,returnSecureToken:true}),muteHttpExceptions:true});
  if(!r.idToken)throw new Error('WORKER_FIREBASE_TOKEN_FAILED');
  cache.put('WORKER_ADMIN_ID_TOKEN',String(r.idToken),3300);
  return String(r.idToken);
}

function firebaseOAuthAccessToken_(scope) {
  const cache=CacheService.getScriptCache(),key='GOOGLE_OAUTH_'+sha256Hex_(scope).slice(0,12),cached=cache.get(key);
  if(cached)return cached;
  const sa=serviceAccount_(),now=Math.floor(Date.now()/1000);
  const assertion=signJwt_(sa,{iss:sa.client_email,scope:scope,aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
  const res=UrlFetchApp.fetch('https://oauth2.googleapis.com/token',{method:'post',payload:{grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:assertion},muteHttpExceptions:true});
  if(res.getResponseCode()!==200)throw new Error('GOOGLE_OAUTH_FAILED_'+res.getResponseCode());
  const json=JSON.parse(res.getContentText());
  if(!json.access_token)throw new Error('GOOGLE_OAUTH_NO_TOKEN');
  cache.put(key,String(json.access_token),3300);
  return String(json.access_token);
}

function firebaseAdminCreate_(localId,email,password,displayName,disabled) {
  const access=firebaseOAuthAccessToken_('https://www.googleapis.com/auth/identitytoolkit');
  const url='https://identitytoolkit.googleapis.com/v1/projects/'+BH_PROJECT+'/accounts';
  const body={localId:String(localId),email:String(email),password:String(password),displayName:String(displayName||''),emailVerified:true,disabled:!!disabled};
  const res=UrlFetchApp.fetch(url,{method:'post',contentType:'application/json',headers:{Authorization:'Bearer '+access},payload:JSON.stringify(body),muteHttpExceptions:true});
  if(res.getResponseCode()<200||res.getResponseCode()>=300)throw new Error('FIREBASE_CREATE_'+res.getResponseCode()+': '+res.getContentText().slice(0,400));
  return JSON.parse(res.getContentText());
}

function firebaseAdminUpdate_(localId,patch) {
  const access=firebaseOAuthAccessToken_('https://www.googleapis.com/auth/identitytoolkit');
  const url='https://identitytoolkit.googleapis.com/v1/projects/'+BH_PROJECT+'/accounts:update';
  const body={localId:String(localId),returnSecureToken:false};
  Object.keys(patch||{}).forEach(function(k){if(patch[k]!==undefined&&patch[k]!==null&&patch[k]!=='')body[k]=patch[k];});
  const res=UrlFetchApp.fetch(url,{method:'post',contentType:'application/json',headers:{Authorization:'Bearer '+access},payload:JSON.stringify(body),muteHttpExceptions:true});
  if(res.getResponseCode()<200||res.getResponseCode()>=300)throw new Error('FIREBASE_UPDATE_'+res.getResponseCode()+': '+res.getContentText().slice(0,400));
  CacheService.getScriptCache().remove('WORKER_ADMIN_ID_TOKEN');
  return JSON.parse(res.getContentText());
}

function firebaseAdminDelete_(localId) {
  if(String(localId)===requiredProp_('WORKER_ADMIN_UID'))throw new Error('PROTECTED_ADMIN');
  const access=firebaseOAuthAccessToken_('https://www.googleapis.com/auth/identitytoolkit');
  const url='https://identitytoolkit.googleapis.com/v1/projects/'+BH_PROJECT+'/accounts:delete';
  const res=UrlFetchApp.fetch(url,{method:'post',contentType:'application/json',headers:{Authorization:'Bearer '+access},payload:JSON.stringify({localId:String(localId)}),muteHttpExceptions:true});
  if(res.getResponseCode()<200||res.getResponseCode()>=300)throw new Error('FIREBASE_DELETE_'+res.getResponseCode());
}

function claims_(employeeCode,appRole) { return JSON.stringify({role:'authenticated',employee_code:String(employeeCode),app_role:String(appRole)}); }
function employeeEmail_(code) { const raw=String(code||'').trim().toLowerCase(); if(!/^[a-z0-9._-]+$/.test(raw))throw new Error('INVALID_EMPLOYEE_CODE'); return raw+'@bao-hang-1291.local'; }
function staffRole_(position,code) { if(String(code)===BH_PROTECTED_ADMIN_CODE)return 'ADMIN'; const p=normalize_(position); return ['chuyen vien','truong nhom','truong kho'].indexOf(p)>=0?'ADMIN_INVENT':'PICKER'; }
function normalize_(value) { return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/đ/g,'d').replace(/\s+/g,' ').trim(); }

function signJwt_(sa,claims) {
  const header=base64WebSafeText_(JSON.stringify({alg:'RS256',typ:'JWT'}));
  const payload=base64WebSafeText_(JSON.stringify(claims));
  const unsigned=header+'.'+payload;
  const signature=Utilities.computeRsaSha256Signature(unsigned,String(sa.private_key));
  return unsigned+'.'+Utilities.base64EncodeWebSafe(signature).replace(/=+$/,'');
}
function base64WebSafeText_(text){return Utilities.base64EncodeWebSafe(Utilities.newBlob(String(text)).getBytes()).replace(/=+$/,'');}
function serviceAccount_(){const raw=requiredProp_('FIREBASE_SERVICE_ACCOUNT');const sa=JSON.parse(raw);if(sa.project_id!==BH_PROJECT)throw new Error('FIREBASE_SCOPE_MISMATCH');return sa;}
function requiredProp_(name){const v=PropertiesService.getScriptProperties().getProperty(name)||'';if(!v)throw new Error(name+'_MISSING');return v;}
function assertScope_(){const p=PropertiesService.getScriptProperties();if(p.getProperty('FIREBASE_PROJECT_ID')!==BH_PROJECT||p.getProperty('NEON_PROJECT_ID')!==BH_NEON_PROJECT||p.getProperty('NEON_BRANCH_ID')!==BH_NEON_BRANCH)throw new Error('WORKER_SCOPE_MISMATCH');}

function sheetWebhook_(body) {
  const expected=PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET');
  if(!expected||String(body.secret)!==expected)return {ok:false,error:'Unauthorized'};
  const lock=LockService.getScriptLock(); lock.waitLock(25000);
  try{
    const events=Array.isArray(body.events)?body.events:[],state=PropertiesService.getScriptProperties();
    let lastId=Number(state.getProperty('LAST_QUEUE_ID')||0),processed=0;
    events.sort(function(a,b){return Number(a.id)-Number(b.id);}).forEach(function(event){const id=Number(event.id);if(!id||id<=lastId)return;applyEvent_(event);lastId=id;state.setProperty('LAST_QUEUE_ID',String(lastId));processed++;});
    return {ok:true,processed:processed,lastId:lastId};
  } finally {lock.releaseLock();}
}

function applyEvent_(event) {
  const payload=event.payload||{};
  getOrCreateSheet_('SU_KIEN',BH_EVENT_HEADERS).appendRow([event.id,new Date(event.created_at||Date.now()),event.event_type||'',payload.id||'',payload.sku||'',payload.product_name||'',payload.status||'',payload.report_count||'',payload.reporter_id||payload.actor_id||'',JSON.stringify(payload)]);
  if(event.event_type==='USER_UPSERT'){
    upsertByKey_(getOrCreateSheet_('NHAN_SU',BH_USER_HEADERS),1,payload.employee_code,[payload.employee_code||'',payload.full_name||'',payload.contractor||'',payload.role||'',payload.active?'HOẠT ĐỘNG':'NGỪNG HOẠT ĐỘNG',new Date(payload.updated_at||Date.now())]); return;
  }
  if(payload.id&&payload.sku)upsertByKey_(getOrCreateSheet_('TRANG_THAI_SKU',BH_ISSUE_HEADERS),1,payload.id,[payload.id,payload.sku,payload.product_name||'',payload.status||'',payload.report_count||1,new Date(payload.reported_at||event.created_at||Date.now()),new Date(payload.updated_at||event.created_at||Date.now()),payload.assigned_name||'',payload.reopen_count||0]);
}
function getOrCreateSheet_(name,headers){const book=SpreadsheetApp.getActiveSpreadsheet();let s=book.getSheetByName(name);if(!s)s=book.insertSheet(name);if(s.getLastRow()===0){s.getRange(1,1,1,headers.length).setValues([headers]);s.getRange(1,1,1,headers.length).setBackground('#123B5D').setFontColor('#FFFFFF').setFontWeight('bold');s.setFrozenRows(1);s.autoResizeColumns(1,headers.length);}return s;}
function upsertByKey_(sheet,keyColumn,key,rowValues){if(!key)return;const last=sheet.getLastRow();let row=last+1;if(last>=2){const match=sheet.getRange(2,keyColumn,last-1,1).createTextFinder(String(key)).matchEntireCell(true).findNext();if(match)row=match.getRow();}sheet.getRange(row,1,1,rowValues.length).setValues([rowValues]);}

function parseBody_(e){try{return JSON.parse(e&&e.postData&&e.postData.contents?e.postData.contents:'{}');}catch(error){return {};}}
function fetchJson_(url,options){const res=UrlFetchApp.fetch(url,options||{}),text=res.getContentText();let value={};try{value=text?JSON.parse(text):{};}catch(ignore){value={raw:text};}value.__http=res.getResponseCode();return value;}
function json_(value){return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);}
function safeError_(error){return String(error&&error.message?error.message:error).slice(0,700);}
function sha256Hex_(text){return sha256HexBytes_(Utilities.newBlob(String(text)).getBytes());}
function sha256HexBytes_(bytes){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes).map(function(b){const n=(b+256)%256;return ('0'+n.toString(16)).slice(-2);}).join('');}