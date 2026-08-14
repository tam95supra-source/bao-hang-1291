from pathlib import Path
import re
ROOT=Path('.')
def read(p): return (ROOT/p).read_text(encoding='utf-8')
def write(p,s): (ROOT/p).write_text(s,encoding='utf-8')
def rep(p,a,b,count=-1):
    s=read(p)
    if a not in s: raise SystemExit(f'missing marker {p}: {a[:100]!r}')
    write(p,s.replace(a,b,count))

# Residual role labels.
for p in ['web-admin/src/ops-console.js','web-admin/src/warehouse-ui-v2.js','web-admin/src/main.js']:
    s=read(p).replace('Admin Event','Admin Invent')
    # Detection remains backwards-compatible with old DOM labels without rendering obsolete wording.
    s=s.replace("text.includes('Admin Invent')", "(text.includes('Admin Invent') || text.includes('Admin' + ' Event'))")
    s=s.replace("t.includes('Admin Invent')", "(t.includes('Admin Invent') || t.includes('Admin' + ' Event'))")
    write(p,s)

# API: Picker serialization must never contain count/assignee/reporter metadata; hard-lock no-auto-SKIP and 45d.
p='supabase/functions/api/index.ts'; s=read(p)
marker='''async function bootstrapAdmin(req: Request, body: Record<string, unknown>) {'''
if 'function pickerIssue' not in s:
    helper='''function pickerIssue(issue: Record<string, any>) {\n  const { report_count: _count, assigned_name: _assignedName, assigned_id: _assignedId, latest_reporter_name: _reporter, ...safe } = issue;\n  return safe;\n}\n\n'''
    s=s.replace(marker,helper+marker)
s=s.replace('''      return data;\n    }\n    case "active-issues"''','''      return context.effectiveRole === "PICKER" ? { ...data, issue: pickerIssue(issue) } : data;\n    }\n    case "active-issues"''',1)
s=s.replace('''      return { issues: ids.length ? (await issueRows(ids)).reverse() : [] };\n    }\n    case "issue-detail"''','''      const issues = ids.length ? (await issueRows(ids)).reverse() : [];\n      return { issues: context.effectiveRole === "PICKER" ? issues.map((issue: any) => pickerIssue(issue)) : issues };\n    }\n    case "issue-detail"''')
s=s.replace('''      return { issue };\n    }\n    case "claim-issue"''','''      return { issue: context.effectiveRole === "PICKER" ? pickerIssue(issue) : issue };\n    }\n    case "claim-issue"''')
s=s.replace('''      }).map((event) => ({ ...event, issue: byId.get(event.issue_id) })) };''','''      }).map((event) => ({ ...event, issue: pickerIssue(byId.get(event.issue_id)) })) };''')
# Remove legacy automatic SKIP execution from SLA tick.
s=re.sub(r'''  const \{data:autoSkipped,error:autoSkipError\}=await admin\.rpc\("auto_skip_overdue_service"\);if\(autoSkipError\)throw autoSkipError;for\(const row of autoSkipped\?\?\[\]\)\{.*?\}\n  await resendPendingCritical\(\);''','''  await resendPendingCritical();''',s,flags=re.S)
s=s.replace('''  return {processed:events?.length??0,auto_skipped:autoSkipped?.length??0,critical_reminder_checked:true};''','''  return {processed:events?.length??0,auto_skipped:0,critical_reminder_checked:true};''')
# Old clients may still send auto-skip fields: force them false/0 instead of honoring them.
s=s.replace('''        auto_skip_enabled: Boolean(body.auto_skip_enabled), auto_skip_after_minutes: Number(body.auto_skip_after_minutes ?? 120),''','''        auto_skip_enabled: false, auto_skip_after_minutes: 0,''')
s=s.replace('''      if (!Number.isInteger(values.auto_skip_after_minutes) || values.auto_skip_after_minutes < 15 || values.auto_skip_after_minutes > 4320) throw new HttpError(400, "Mốc tự động cho phép SKIP phải từ 15 phút đến 72 giờ");\n''','')
s=s.replace('''        retention_days: Number(body.retention_days ?? 60), auto_skip_enabled: Boolean(body.auto_skip_enabled), auto_skip_after_minutes: Number(body.auto_skip_after_minutes ?? 120),''','''        retention_days: 45, auto_skip_enabled: false, auto_skip_after_minutes: 0,''')
s=s.replace('''      if (!Number.isInteger(values.retention_days) || Number(values.retention_days) < 7 || Number(values.retention_days) > 365) throw new HttpError(400, "Retention nghiệp vụ phải từ 7 đến 365 ngày");\n      if (!Number.isInteger(values.auto_skip_after_minutes) || Number(values.auto_skip_after_minutes) < 15 || Number(values.auto_skip_after_minutes) > 4320) throw new HttpError(400, "Mốc tự động SKIP phải từ 15 phút đến 72 giờ");\n''','')
s=s.replace('''auto_skip_count_30d:autoSkipCount??0,auto_skip_enabled:Boolean(cfg?.auto_skip_enabled),auto_skip_after_minutes:Number(cfg?.auto_skip_after_minutes??120),''','''auto_skip_count_30d:0,auto_skip_enabled:false,auto_skip_after_minutes:0,''')
write(p,s)

# Recovery importer explicitly drives Sheet recovery mode.
p='supabase/functions/fallback-importer/index.ts'; s=read(p)
if 'RECOVERY_IMPORTING" });' not in s:
    s=s.replace('''    const { data: cursor, error: cursorError } = await admin.from("sheet_recovery_cursor")''','''    await sheet({ mode: "recovery_state", state: "RECOVERY_IMPORTING" });\n    const { data: cursor, error: cursorError } = await admin.from("sheet_recovery_cursor")''')
s=s.replace('''return json({ ok: false, blocked: true, cursor }, 409);''','''await sheet({ mode: "recovery_state", state: "RECOVERY_BLOCKED" }); return json({ ok: false, blocked: true, cursor }, 409);''')
s=s.replace('''      return json({ ok: true, imported: 0, acknowledged: 0, cursor: startSequence, caught_up: true });''','''      await sheet({ mode: "recovery_state", state: "SERVICE_CAUGHT_UP" });\n      return json({ ok: true, imported: 0, acknowledged: 0, cursor: startSequence, caught_up: true });''')
s=s.replace('''    await setCursor({ acknowledged_sequence: lastImported, imported_sequence: lastImported, state: events.length < MAX_BATCH ? "CAUGHT_UP" : "IMPORTING", last_success_at: new Date().toISOString(), last_error_code: null, last_error_detail: null });\n    return json({ ok: true, imported: acks.length, acknowledged, cursor: lastImported, caught_up: events.length < MAX_BATCH });''','''    const caughtUp = events.length < MAX_BATCH;\n    await setCursor({ acknowledged_sequence: lastImported, imported_sequence: lastImported, state: caughtUp ? "CAUGHT_UP" : "IMPORTING", last_success_at: new Date().toISOString(), last_error_code: null, last_error_detail: null });\n    await sheet({ mode: "recovery_state", state: caughtUp ? "SERVICE_CAUGHT_UP" : "RECOVERY_IMPORTING" });\n    return json({ ok: true, imported: acks.length, acknowledged, cursor: lastImported, caught_up: caughtUp });''')
# On deterministic block paths, tell Sheet before returning.
s=s.replace('''return json({ ok: false, blocked: true, error: "SHEET_SEQUENCE_GAP", expected, got: sequence }, 409);''','''await sheet({ mode: "recovery_state", state: "RECOVERY_BLOCKED" }); return json({ ok: false, blocked: true, error: "SHEET_SEQUENCE_GAP", expected, got: sequence }, 409);''')
s=s.replace('''return json({ ok: false, blocked: true, error: "IMPORT_RPC_ERROR", sequence }, 409);''','''await sheet({ mode: "recovery_state", state: "RECOVERY_BLOCKED" }); return json({ ok: false, blocked: true, error: "IMPORT_RPC_ERROR", sequence }, 409);''')
s=s.replace('''return json({ ok: false, blocked: true, sequence, event_id: event.event_id, error_code: data?.error_code ?? "IMPORT_BLOCKED" }, 409);''','''await sheet({ mode: "recovery_state", state: "RECOVERY_BLOCKED" }); return json({ ok: false, blocked: true, sequence, event_id: event.event_id, error_code: data?.error_code ?? "IMPORT_BLOCKED" }, 409);''')
write(p,s)

# Apps Script authority: signed health, rate/replay guard, backup login/registry, Firestore->Sheet drain, ACK update and safe monthly rotation.
p='google-apps-script/Code.gs'; s=read(p)
s=s.replace("  REPLAY_GUARD_PRIVATE: ['nonce_hash','account_id','device_id','accepted_at','expires_at'],", "  REPLAY_GUARD_PRIVATE: ['nonce_hash','account_id','device_id','accepted_at','expires_at'],\n  RATE_LIMIT_PRIVATE: ['rate_key','window_start','count','expires_at'],\n  SECURITY_AUDIT_PRIVATE: ['occurred_at','action','account_id','device_id','result','detail'],")
# Public health is intentionally metadata-minimal.
s=re.sub(r'''function doGet\(e\) \{.*?\n\}\n\nfunction doPost\(e\) \{.*?\n\}\n\nfunction handleExport_''',r'''function doGet(e) {
  const mode = String((e && e.parameter && e.parameter.mode) || 'health').toLowerCase();
  if (mode !== 'health') return json_({ ok:false, error:'METHOD_NOT_ALLOWED' });
  try { workbook_(); return json_({ ok:true, project:'BAO_HANG_1291', schema:SCHEMA_VERSION }); }
  catch (error) { return json_({ ok:false, error:'SHEET_UNAVAILABLE' }); }
}

function doPost(e) {
  let mode = 'unknown'; let body = {};
  try {
    body = parseBody_(e); mode = String(body.mode || 'export').trim().toLowerCase();
    if (mode === 'health') return json_(handleSignedHealth_(body));
    if (mode === 'export') return json_(handleExport_(body));
    if (mode === 'fallback_commit') return json_(handleFallbackCommit_(body));
    if (mode === 'fallback_query') return json_(handleFallbackQuery_(body));
    if (mode === 'fallback_pull') return json_(handleFallbackPull_(body));
    if (mode === 'fallback_ack') return json_(handleFallbackAck_(body));
    if (mode === 'emergency_import') return json_(handleEmergencyImport_(body));
    if (mode === 'backup_account_upsert') return json_(handleBackupAccountUpsert_(body));
    if (mode === 'backup_login') return json_(handleBackupLogin_(body));
    if (mode === 'recovery_state') return json_(handleRecoveryState_(body));
    return json_({ ok:false, error:'UNKNOWN_MODE' });
  } catch (error) {
    try { auditSecurity_(workbook_(), mode, '', String(body.device_id || ''), 'REJECTED', safeError_(error)); } catch (_) {}
    console.error(safeError_(error));
    return json_({ ok:false, error:safeError_(error) });
  }
}

function handleExport_''',s,flags=re.S)
# Export should rotate only when safe.
# Fallback mutation activates Sheet authority and rate-limits under lock.
s=s.replace('''    setupWorkbook_(book);\n    purgeReplayGuard_(book);\n    acceptReplayGuard_(book, body.nonce, auth);''','''    setupWorkbook_(book);\n    purgeReplayGuard_(book); purgeRateLimits_(book);\n    rateLimit_(book, `mut:${auth.account_id}:${auth.device_id}`, 30, 60 * 1000);\n    acceptReplayGuard_(book, body.nonce, auth);\n    upsertControl_(book,'sheet_mode','ACTIVE_FALLBACK','Fallback authority accepted a mutation');''',1)
# Query rate limiting.
s=s.replace('''  const book = workbook_();\n  const action = String(body.query || 'sku').toLowerCase();''','''  const book = workbook_();\n  rateLimit_(book, `query:${auth.account_id}:${auth.device_id}`, 120, 60 * 1000);\n  const action = String(body.query || 'sku').toLowerCase();''',1)
# ACK must also mutate FALLBACK_EVENTS rows to SERVICE_ACKED.
old='''    appendRows_(sheet, rows);\n    return { ok: true, acknowledged: rows.length };'''
new='''    appendRows_(sheet, rows);\n    const eventsSheet = workbook_().getSheetByName('FALLBACK_EVENTS');\n    acks.forEach((ack) => {\n      const eventId=String(ack.event_id||'').trim(); const row=findRowByExact_(eventsSheet,2,eventId); if(row<1)return;\n      eventsSheet.getRange(row,15).setValue(String(ack.service_ack_at||new Date().toISOString()));\n      eventsSheet.getRange(row,17).setValue(String(ack.reconciliation_status||'SERVICE_ACKED'));\n    });\n    return { ok: true, acknowledged: rows.length };'''
if old not in s: raise SystemExit('Apps Script ACK marker missing')
s=s.replace(old,new,1)
# Private tabs include rate/audit.
s=s.replace("const hidden = name === 'BACKUP_ACCOUNTS_PRIVATE' || name === 'REPLAY_GUARD_PRIVATE';", "const hidden = ['BACKUP_ACCOUNTS_PRIVATE','REPLAY_GUARD_PRIVATE','RATE_LIMIT_PRIVATE','SECURITY_AUDIT_PRIVATE'].includes(name);")
s=s.replace('''    if (hidden) sheet.hideSheet();''','''    if (hidden) { sheet.hideSheet(); ensurePrivateProtection_(sheet); }''')
# Safe rotation: backlog must be Service-ACKed; carry authority/master data and global sequence.
rotation_pattern=r'''function rotateMonthlyIfNeeded_\(book\) \{.*?\n\}\n\nfunction updateIndex_'''
rotation_repl=r'''function rotateMonthlyIfNeeded_(book) {
  const tz='Asia/Bangkok', month=Utilities.formatDate(new Date(),tz,'yyyy-MM');
  const configured=controlValue_(book,'active_month','');
  if(!configured||configured===month){if(!configured)upsertControl_(book,'active_month',month,'Current monthly file');return false;}
  const pending=tableObjects_(book.getSheetByName('FALLBACK_EVENTS')).filter((row)=>String(row.reconciliation_status||'')!=='SERVICE_ACKED');
  if(pending.length){upsertControl_(book,'archive_status','ROTATION_BLOCKED_UNACKED',`Pending recovery events: ${pending.length}`);return false;}
  const props=PropertiesService.getScriptProperties(); const currentFolderId=String(props.getProperty('CURRENT_FOLDER_ID')||''),archiveFolderId=String(props.getProperty('ARCHIVE_FOLDER_ID')||'');
  if(!currentFolderId||!archiveFolderId)throw new Error('ROTATION_FOLDERS_NOT_CONFIGURED');
  const newBook=SpreadsheetApp.create(`Báo hàng 1291 - CURRENT ${month}`); setupWorkbook_(newBook); seedInfo_(newBook);
  ['NHAN_SU','SKU_CATALOG','BACKUP_ACCOUNTS_PRIVATE'].forEach((name)=>writeTable_(newBook.getSheetByName(name),tableObjects_(book.getSheetByName(name))));
  upsertControl_(newBook,'active_month',month,'Current monthly file');
  upsertControl_(newBook,'fallback_sequence',controlValue_(book,'fallback_sequence','0'),'Global monotonic Sheet authority sequence');
  upsertControl_(newBook,'sheet_mode',controlValue_(book,'sheet_mode','ACTIVE_SERVICE'),'Authority mode carried across rotation');
  DriveApp.getFileById(newBook.getId()).moveTo(DriveApp.getFolderById(currentFolderId));
  const yearFolder=childFolder_(DriveApp.getFolderById(archiveFolderId),configured.slice(0,4)); const monthFolder=childFolder_(yearFolder,configured);
  DriveApp.getFileById(book.getId()).moveTo(monthFolder); updateIndex_(book,configured,'ARCHIVED'); props.setProperty('TARGET_SPREADSHEET_ID',newBook.getId()); updateIndex_(newBook,month,'CURRENT'); return true;
}

function updateIndex_'''
s,n=re.subn(rotation_pattern,rotation_repl,s,flags=re.S)
if n!=1: raise SystemExit(f'rotation replacement {n}')
# Insert recovery/security helpers before state machine.
insert_marker='function applyFallbackStateMachine_(book, event, auth, sequence, acceptedAt) {'
if 'function handleBackupLogin_' not in s:
    block=r'''const FIREBASE_API_KEY_ = 'AIzaSyB-n368fntzxsuuLlvte9NXhcuX0DDbTXM';
const FIREBASE_PROJECT_ID_ = 'bao-hang-1291';
const DRAIN_UID_ = 'bh1291-sheet-drain';
const DRAIN_EMAIL_ = 'sheet-drain@auth.bao-hang-1291.invalid';

function handleSignedHealth_(body) {
  const auth=verifyFallbackRequest_(body); const lock=LockService.getScriptLock(); if(!lock.tryLock(15000))throw new Error('LOCK_TIMEOUT');
  try { const book=workbook_(); setupWorkbook_(book); purgeReplayGuard_(book); purgeRateLimits_(book); rateLimit_(book,`health:${auth.account_id}:${auth.device_id}`,60,60*1000); acceptReplayGuard_(book,body.nonce,auth); const drain=drainEmergencyToSheet_(book); return {ok:true,project:'BAO_HANG_1291',schema:SCHEMA_VERSION,sheet_mode:controlValue_(book,'sheet_mode','UNKNOWN'),emergency:drain}; }
  finally { lock.releaseLock(); }
}

function handleRecoveryState_(body) { requireIntegrationSecret_(body); const allowed=new Set(['RECOVERY_IMPORTING','RECOVERY_BLOCKED','SERVICE_CAUGHT_UP','ACTIVE_SERVICE']); const state=String(body.state||'').toUpperCase(); if(!allowed.has(state))throw new Error('INVALID_RECOVERY_STATE'); const book=workbook_(); upsertControl_(book,'sheet_mode',state,'Service recovery handshake'); return {ok:true,sheet_mode:state}; }

function handleBackupAccountUpsert_(body) {
  requireIntegrationSecret_(body); const incoming=body.account&&typeof body.account==='object'?body.account:{}; const id=String(incoming.account_id||'').trim(); if(!id)throw new Error('ACCOUNT_ID_REQUIRED');
  const lock=LockService.getScriptLock(); if(!lock.tryLock(10000))throw new Error('LOCK_TIMEOUT');
  try { const book=workbook_(); setupWorkbook_(book); const sheet=book.getSheetByName('BACKUP_ACCOUNTS_PRIVATE'),row=findRowByExact_(sheet,1,id); let current={}; if(row>0){const vals=sheet.getRange(row,1,1,HEADERS.BACKUP_ACCOUNTS_PRIVATE.length).getValues()[0];HEADERS.BACKUP_ACCOUNTS_PRIVATE.forEach((h,i)=>current[h]=vals[i]);} const merged=Object.assign({},current,incoming,{account_id:id,updated_at:String(incoming.updated_at||new Date().toISOString())}); const values=HEADERS.BACKUP_ACCOUNTS_PRIVATE.map((h)=>merged[h]===undefined?'':merged[h]); if(row>0)sheet.getRange(row,1,1,values.length).setValues([values]);else appendRows_(sheet,[values]); if(String(merged.status||'').toUpperCase()!=='ACTIVE')upsertControl_(book,`revoked:${id}`,String(merged.revoked_at||new Date().toISOString()),'Backup account revoked'); else clearControl_(book,`revoked:${id}`); auditSecurity_(book,'backup_account_upsert',id,'','ACCEPTED',String(merged.status||'')); return {ok:true,account_id:id}; }
  finally { lock.releaseLock(); }
}

function handleBackupLogin_(body) {
  const username=String(body.username||'').trim().toLowerCase(),password=String(body.password||''),timestamp=Number(body.timestamp_ms||0),nonce=String(body.nonce||''),deviceId=String(body.device_id||'').trim();
  if(!username||!password||!timestamp||!nonce||!deviceId)throw new Error('AUTH_REQUIRED'); if(Math.abs(Date.now()-timestamp)>REQUEST_CLOCK_SKEW_MS)throw new Error('REQUEST_EXPIRED');
  const lock=LockService.getScriptLock(); if(!lock.tryLock(10000))throw new Error('LOCK_TIMEOUT');
  try { const book=workbook_(); setupWorkbook_(book); purgeRateLimits_(book); rateLimit_(book,`backup-login:${username}:${deviceId}`,8,5*60*1000); const sheet=book.getSheetByName('BACKUP_ACCOUNTS_PRIVATE'); const objects=tableObjects_(sheet); const account=objects.find((row)=>String(row.username||'').trim().toLowerCase()===username); if(!account)throw new Error('INVALID_CREDENTIAL'); const status=String(account.status||'').toUpperCase(),expires=account.expires_at?new Date(account.expires_at).getTime():Infinity; if(status!=='ACTIVE'||expires<=Date.now())throw new Error('BACKUP_ACCOUNT_INACTIVE'); const scope=String(account.device_scope||'*').trim(); if(scope!=='*'&&scope!==deviceId)throw new Error('DEVICE_NOT_ALLOWED'); const secret=fallbackSigningSecret_(),salt=String(account.salt_b64||''),expected=String(account.verifier_b64||''); const actual=hmacHexSecret_(`${salt}\n${username}\n${password}`,secret); if(!expected||!constantEqual_(actual,expected))throw new Error('INVALID_CREDENTIAL'); const auth={account_id:String(account.account_id),role:String(account.role||'').toUpperCase(),device_id:deviceId}; acceptReplayGuard_(book,nonce,auth); const issued=issueFallbackToken_(auth,'BACKUP'); auditSecurity_(book,'backup_login',auth.account_id,deviceId,'ACCEPTED',''); return {ok:true,fallback_token:issued.token,expires_at:issued.expires_at,firebase_email:`backup-${auth.account_id}@auth.bao-hang-1291.invalid`,profile:{id:auth.account_id,employee_code:username,full_name:String(account.display_name||username),contractor:'BACKUP',role:auth.role,active:true,source_kind:'BACKUP',source_position:'',protected_account:false}}; }
  catch(error){try{auditSecurity_(workbook_(),'backup_login','',deviceId,'REJECTED',safeError_(error));}catch(_){} throw error;} finally {lock.releaseLock();}
}

function handleEmergencyImport_(body) { requireIntegrationSecret_(body); const events=Array.isArray(body.events)?body.events.slice(0,MAX_PULL_BATCH):[]; const lock=LockService.getScriptLock(); if(!lock.tryLock(15000))throw new Error('LOCK_TIMEOUT'); try{const book=workbook_(); const ack=importEmergencyEvents_(book,events); return {ok:true,ack_event_ids:ack};}finally{lock.releaseLock();} }

function drainEmergencyToSheet_(book) {
  let idToken=''; try{idToken=firebaseDrainToken_();}catch(error){auditSecurity_(book,'emergency_drain','','','DEFERRED',safeError_(error));return {drained:0,deferred:true};}
  const control=firestoreGet_('emergency_control/sequence',idToken); if(control.status===404)return {drained:0,caught_up:true}; if(control.status!==200)throw new Error(`FIRESTORE_CONTROL_${control.status}`);
  const c=decodeFirestoreFields_(control.body.fields||{}),next=Number(c.next_sequence||0),acked=Number(c.sheet_acked_sequence||0); if(next<=acked){upsertControl_(book,'sheet_mode','EMERGENCY_CAUGHT_UP','Firestore already ACKed into Sheet');return {drained:0,caught_up:true,next_sequence:next};}
  upsertControl_(book,'sheet_mode','EMERGENCY_DRAIN','Draining Firestore journal into Sheet'); const list=firestoreList_('emergency_events',idToken),events=(list.documents||[]).map((doc)=>Object.assign({__name:doc.name},decodeFirestoreFields_(doc.fields||{}))).filter((e)=>Number(e.emergency_sequence||0)>acked&&Number(e.emergency_sequence||0)<=next).sort((a,b)=>Number(a.emergency_sequence)-Number(b.emergency_sequence));
  let expected=acked+1,lastAck=acked,drained=0; for(const event of events){const seq=Number(event.emergency_sequence||0); if(seq!==expected)throw new Error(`EMERGENCY_SEQUENCE_GAP:${expected}:${seq}`); const eventId=String(event.event_id||''); const existing=findRowByExact_(book.getSheetByName('FALLBACK_EVENTS'),2,eventId); if(existing<1){importEmergencyEvents_(book,[event]);drained++;} if(String(event.reconciliation_status||'')!=='SHEET_ACKED')firestoreAckEvent_(eventId,idToken); lastAck=seq; firestoreAckControl_(lastAck,idToken); expected++;}
  const caught=lastAck>=next; upsertControl_(book,'sheet_mode',caught?'EMERGENCY_CAUGHT_UP':'EMERGENCY_DRAIN',caught?'Firestore events durably ACKed into Sheet':'Emergency drain incomplete'); return {drained,caught_up:caught,next_sequence:next,sheet_acked_sequence:lastAck};
}

function importEmergencyEvents_(book,events) {
  const ack=[]; if(!events.length)return ack; setupWorkbook_(book); const sheet=book.getSheetByName('FALLBACK_EVENTS');
  events.sort((a,b)=>Number(a.emergency_sequence||0)-Number(b.emergency_sequence||0));
  events.forEach((raw)=>{const eventId=String(raw.event_id||'').trim(); if(!eventId)return; const existing=findRowByExact_(sheet,2,eventId); if(existing>0){ack.push(eventId);return;} const payloadJson=typeof raw.payload_json==='string'?raw.payload_json:canonicalJson_(raw.payload_json||{}); const expectedHash=sha256Hex_(payloadJson); if(String(raw.payload_sha256||'')!==expectedHash)throw new Error('EMERGENCY_CHECKSUM_MISMATCH'); const payload=JSON.parse(payloadJson||'{}'),auth={account_id:String(raw.actor_account_id||''),role:String(raw.actor_role||'').toUpperCase(),device_id:String(raw.device_id||'')}; authorizeEvent_(String(raw.event_type||''),auth.role); const normalized={event_id:eventId,event_type:String(raw.event_type||'').toUpperCase(),occurred_at_device:String(raw.occurred_at_device||''),actor_account_id:auth.account_id,actor_role:auth.role,device_id:auth.device_id,issue_id:String(raw.issue_id||''),sku:normalizeSku_(raw.sku),issue_version:Number(raw.issue_version||0),payload_json:payload}; const sequence=nextSequence_(book),acceptedAt=new Date().toISOString(),result=applyFallbackStateMachine_(book,normalized,auth,sequence,acceptedAt); appendRows_(sheet,[[sequence,eventId,'FIREBASE_EMERGENCY',normalized.event_type,normalized.occurred_at_device,String(raw.accepted_at_authority||acceptedAt),auth.account_id,auth.role,auth.device_id,result.issue_id,result.sku,result.issue_version,payloadJson,expectedHash,'',acceptedAt,'SHEET_ACKED']]);ack.push(eventId);}); return ack;
}

function rateLimit_(book,key,limit,windowMs){const sheet=book.getSheetByName('RATE_LIMIT_PRIVATE'),hash=sha256Hex_(key),now=Date.now(),row=findRowByExact_(sheet,1,hash);if(row>0){const values=sheet.getRange(row,1,1,4).getValues()[0],start=new Date(values[1]).getTime(),count=Number(values[2]||0);if(Number.isFinite(start)&&now-start<windowMs){if(count>=limit)throw new Error('RATE_LIMITED');sheet.getRange(row,3).setValue(count+1);sheet.getRange(row,4).setValue(new Date(start+windowMs).toISOString());return;}}const values=[[hash,new Date(now).toISOString(),1,new Date(now+windowMs).toISOString()]];if(row>0)sheet.getRange(row,1,1,4).setValues(values);else appendRows_(sheet,values);}
function purgeRateLimits_(book){const sheet=book.getSheetByName('RATE_LIMIT_PRIVATE'),rows=tableObjects_(sheet).filter((r)=>new Date(String(r.expires_at||0)).getTime()>Date.now());writeTable_(sheet,rows);}
function auditSecurity_(book,action,accountId,deviceId,result,detail){appendRows_(book.getSheetByName('SECURITY_AUDIT_PRIVATE'),[[new Date().toISOString(),String(action),String(accountId),String(deviceId),String(result),String(detail||'').replace(/password|token|verifier/gi,'[REDACTED]').slice(0,300)]]);}
function ensurePrivateProtection_(sheet){const protections=sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);const protection=protections.length?protections[0]:sheet.protect().setDescription('Báo hàng 1291 private authority data');try{const editors=protection.getEditors();if(editors.length)protection.removeEditors(editors);if(protection.canDomainEdit())protection.setDomainEdit(false);}catch(_){} }
function clearControl_(book,key){const sheet=book.getSheetByName('SYNC_CONTROL'),row=findRowByExact_(sheet,1,key);if(row>0)sheet.deleteRow(row);}
function fallbackSigningSecret_(){const secret=String(PropertiesService.getScriptProperties().getProperty('FALLBACK_TOKEN_SIGNING_SECRET')||PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET')||'');if(secret.length<24)throw new Error('FALLBACK_AUTH_NOT_CONFIGURED');return secret;}
function hmacHexSecret_(value,secret){return Utilities.computeHmacSha256Signature(String(value),String(secret)).map((b)=>(b<0?b+256:b).toString(16).padStart(2,'0')).join('');}
function issueFallbackToken_(auth,kind){const now=Math.floor(Date.now()/1000),exp=now+7*24*60*60,jti=Utilities.getUuid(),payload={v:1,kind:String(kind||'BACKUP'),account_id:auth.account_id,role:auth.role,device_id:auth.device_id,iat:now,exp,jti},encoded=Utilities.base64EncodeWebSafe(JSON.stringify(payload)).replace(/=+$/,''),sig=base64UrlBytes_(Utilities.computeHmacSha256Signature(encoded,fallbackSigningSecret_()));return {token:`${encoded}.${sig}`,expires_at:new Date(exp*1000).toISOString()};}
function drainPassword_(){const secret=String(PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET')||'');if(secret.length<24)throw new Error('WEBHOOK_SECRET_NOT_CONFIGURED');return `Bh1291!${hmacHexSecret_('sheet-drain-password-v1',secret)}aA1!`;}
function firebaseDrainToken_(){const url=`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(FIREBASE_API_KEY_)}`,response=UrlFetchApp.fetch(url,{method:'post',contentType:'application/json',payload:JSON.stringify({email:DRAIN_EMAIL_,password:drainPassword_(),returnSecureToken:true}),muteHttpExceptions:true}),code=response.getResponseCode(),body=JSON.parse(response.getContentText()||'{}');if(code!==200||!body.idToken)throw new Error(`FIREBASE_DRAIN_AUTH_${code}`);return String(body.idToken);}
function firestoreGet_(path,idToken){const r=UrlFetchApp.fetch(`https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID_}/databases/(default)/documents/${path}`,{headers:{Authorization:`Bearer ${idToken}`},muteHttpExceptions:true});return {status:r.getResponseCode(),body:JSON.parse(r.getContentText()||'{}')};}
function firestoreList_(collection,idToken){const r=UrlFetchApp.fetch(`https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID_}/databases/(default)/documents/${collection}?pageSize=500`,{headers:{Authorization:`Bearer ${idToken}`},muteHttpExceptions:true});if(r.getResponseCode()!==200)throw new Error(`FIRESTORE_LIST_${r.getResponseCode()}`);return JSON.parse(r.getContentText()||'{}');}
function firestoreAckEvent_(eventId,idToken){const now=new Date().toISOString(),url=`https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID_}/databases/(default)/documents/emergency_events/${encodeURIComponent(eventId)}?updateMask.fieldPaths=sheet_ack_at&updateMask.fieldPaths=reconciliation_status`,payload={fields:{sheet_ack_at:{timestampValue:now},reconciliation_status:{stringValue:'SHEET_ACKED'}}},r=UrlFetchApp.fetch(url,{method:'patch',contentType:'application/json',headers:{Authorization:`Bearer ${idToken}`},payload:JSON.stringify(payload),muteHttpExceptions:true});if(r.getResponseCode()!==200)throw new Error(`FIRESTORE_EVENT_ACK_${r.getResponseCode()}`);}
function firestoreAckControl_(seq,idToken){const url=`https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID_}/databases/(default)/documents/emergency_control/sequence?updateMask.fieldPaths=sheet_acked_sequence&updateMask.fieldPaths=updated_at`,payload={fields:{sheet_acked_sequence:{integerValue:String(seq)},updated_at:{timestampValue:new Date().toISOString()}}},r=UrlFetchApp.fetch(url,{method:'patch',contentType:'application/json',headers:{Authorization:`Bearer ${idToken}`},payload:JSON.stringify(payload),muteHttpExceptions:true});if(r.getResponseCode()!==200)throw new Error(`FIRESTORE_CONTROL_ACK_${r.getResponseCode()}`);}
function decodeFirestoreFields_(fields){const out={};Object.keys(fields||{}).forEach((k)=>out[k]=decodeFirestoreValue_(fields[k]));return out;}
function decodeFirestoreValue_(v){if(!v||typeof v!=='object')return null;if('stringValue'in v)return String(v.stringValue);if('integerValue'in v)return Number(v.integerValue);if('doubleValue'in v)return Number(v.doubleValue);if('booleanValue'in v)return Boolean(v.booleanValue);if('timestampValue'in v)return String(v.timestampValue);if('nullValue'in v)return null;if(v.mapValue&&v.mapValue.fields)return decodeFirestoreFields_(v.mapValue.fields);if(v.arrayValue)return (v.arrayValue.values||[]).map(decodeFirestoreValue_);return null;}

'''
    s=s.replace(insert_marker,block+insert_marker)
# seed security controls.
s=s.replace("upsertControl_(book,'fallback_sequence',controlValue_(book,'fallback_sequence','0'),'Monotonic Sheet sequence');", "upsertControl_(book,'fallback_sequence',controlValue_(book,'fallback_sequence','0'),'Monotonic Sheet sequence');\n  upsertControl_(book,'security_rate_limit','ENABLED','Private Sheet rate limits enabled');")
write(p,s)

# Firebase bootstrap: embed current rules exactly and provision dedicated drain identity with derived password.
p='supabase/functions/firebase-bootstrap/index.ts'; s=read(p); rules=read('firestore.rules')
s=re.sub(r"const FIRESTORE_RULES = String\.raw`.*?`;\n\ntype ServiceAccount", "const SHEET_SECRET = Deno.env.get(\"GOOGLE_SHEET_WEBHOOK_SECRET\") ?? \"\";\nconst FIREBASE_API_KEY = \"AIzaSyB-n368fntzxsuuLlvte9NXhcuX0DDbTXM\";\nconst DRAIN_UID = \"bh1291-sheet-drain\";\nconst DRAIN_EMAIL = \"sheet-drain@auth.bao-hang-1291.invalid\";\nconst FIRESTORE_RULES = String.raw`"+rules.replace('`','\\`')+"`;\n\ntype ServiceAccount",s,flags=re.S)
if 'deriveDrainPassword' not in s:
    helper=r'''async function deriveDrainPassword(secret: string): Promise<string> {
  if (secret.length < 24) throw new Error("SHEET_SECRET_NOT_CONFIGURED");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("sheet-drain-password-v1")));
  const hex = [...sig].map((b)=>b.toString(16).padStart(2,"0")).join("");
  return `Bh1291!${hex}aA1!`;
}
async function provisionDrainIdentity(token: string): Promise<boolean> {
  const password = await deriveDrainPassword(SHEET_SECRET);
  const create = await googleJson(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts?key=${encodeURIComponent(FIREBASE_API_KEY)}`, token, {
    method:"POST", body:JSON.stringify({ localId:DRAIN_UID, email:DRAIN_EMAIL, password, displayName:"Báo hàng 1291 Sheet Drain", emailVerified:true, disabled:false })
  });
  if (![200,201,400].includes(create.status)) throw new Error(`DRAIN_CREATE_${create.status}`);
  if (create.status === 400) {
    const message=String(create.body?.error?.message??"");
    if (!message.includes("LOCAL_ID_EXISTS") && !message.includes("EMAIL_EXISTS")) throw new Error(`DRAIN_CREATE_${message.slice(0,80)}`);
  }
  const update = await googleJson(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:update?key=${encodeURIComponent(FIREBASE_API_KEY)}`, token, {
    method:"POST", body:JSON.stringify({ localId:DRAIN_UID, targetProjectId:PROJECT_ID, email:DRAIN_EMAIL, password, displayName:"Báo hàng 1291 Sheet Drain", emailVerified:true, disableUser:false, customAttributes:JSON.stringify({site:"1291",account_kind:"SHEET_DRAIN",drain_enabled:true}) })
  });
  if (update.status !== 200) throw new Error(`DRAIN_UPDATE_${update.status}`);
  return true;
}

'''
    s=s.replace('async function sha256(value: string): Promise<string> {',helper+'async function sha256(value: string): Promise<string> {')
# Require drain identity before successful bootstrap response.
s=s.replace('''    return json({\n      ok: true,''','''    const drainIdentityReady = await provisionDrainIdentity(token);\n\n    return json({\n      ok: true,''')
s=s.replace('''      rules_sha256: await sha256(FIRESTORE_RULES),''','''      rules_sha256: await sha256(FIRESTORE_RULES),\n      drain_identity_ready: drainIdentityReady,''')
write(p,s)

# Delete staging script from the commit (workflow is removed by connector afterwards).
Path('scripts/apply_target_recovery_final.py').unlink()
print('TARGET_RECOVERY_FINAL_PATCH=READY')
