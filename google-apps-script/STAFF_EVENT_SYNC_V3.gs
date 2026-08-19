// BÁO HÀNG 1291 — STAFF EVENT SYNC V3.3 RELIABLE DELTA
// Source: DỮ LIỆU THEO NGÀY / DANH SÁCH NHÂN SỰ.
// Rule: no full backend reconcile. Normal edits process only affected rows.
// Structural changes/recovery read the source sheet locally, diff snapshot, then mutate only changed codes.
// Setup preserves an existing V3.2 snapshot and immediately recovers only missed deltas.

var BH_STAFF_V33_SOURCE_ID = '1E7ZWz-4eMcBliQxDYBVoogIoeSYyiaXGwj0I6mbMm78';
var BH_STAFF_V33_SOURCE_TITLE = 'DỮ LIỆU THEO NGÀY';
var BH_STAFF_V33_SOURCE_TAB = 'DANH SÁCH NHÂN SỰ';
var BH_STAFF_V33_PROTECTED_ADMIN = '6281280';
var BH_STAFF_V33_RELEVANT_COLUMNS = [1, 2, 4, 5, 6]; // A,B,D,E,F
var BH_STAFF_V33_MIN_ROWS = 300;
var BH_STAFF_V33_MAX_ROWS = 500;
var BH_STAFF_V33_SNAPSHOT_KEY = 'STAFF_EVENT_SYNC_V32_SNAPSHOT';
var BH_STAFF_V33_ENABLED_KEY = 'STAFF_EVENT_SYNC_V33_ENABLED';
var BH_STAFF_V33_PENDING_KEY = 'STAFF_EVENT_SYNC_V33_PENDING';
var BH_STAFF_V33_LAST_KEY = 'LAST_STAFF_EVENT_SYNC_V33';
var BH_STAFF_V33_ERROR_KEY = 'LAST_STAFF_EVENT_SYNC_V33_ERROR';
var BH_STAFF_V33_DIAG_LABEL = 'STAFF_EVENT_SYNC_V3.3';

function setupStaffEventSyncV3() {
  assertScope_();
  var state = staffReadSourceV33_();
  staffDeleteTriggersV33_();
  ScriptApp.newTrigger('staffSourceEditV3').forSpreadsheet(BH_STAFF_V33_SOURCE_ID).onEdit().create();
  ScriptApp.newTrigger('staffSourceChangeV3').forSpreadsheet(BH_STAFF_V33_SOURCE_ID).onChange().create();

  var props = PropertiesService.getScriptProperties();
  props.deleteProperty('STAFF_EVENT_SYNC_V2_ENABLED');
  props.deleteProperty('STAFF_EVENT_SYNC_V32_ENABLED');
  props.setProperty(BH_STAFF_V33_ENABLED_KEY, '1');
  props.setProperty('STAFF_EVENT_SYNC_V3_ENABLED', '1');
  props.setProperty('STAFF_EVENT_SYNC_V3_SOURCE_ID', BH_STAFF_V33_SOURCE_ID);
  props.setProperty('STAFF_EVENT_SYNC_V3_SOURCE_TAB', BH_STAFF_V33_SOURCE_TAB);

  var snapshot = staffLoadSnapshotV33_();
  var initialized = false;
  if (!Object.keys(snapshot).length) {
    staffSaveSnapshotV33_(state.items);
    initialized = true;
  }

  var recovery = initialized
    ? staffProofV33_('SETUP_INITIAL_SNAPSHOT', 0, 0, 0, 'SNAPSHOT_INITIALIZED')
    : staffSyncDiffV33_('SETUP_RECOVER_MISSED_EVENTS');

  var result = {
    ok:true,
    version:'3.3_RELIABLE_DELTA',
    source_id:BH_STAFF_V33_SOURCE_ID,
    source_tab:BH_STAFF_V33_SOURCE_TAB,
    snapshot_initialized:initialized,
    recovery:recovery,
    full_backend_reconcile:false,
    triggers:['staffSourceEditV3','staffSourceChangeV3'],
    at:new Date().toISOString()
  };
  props.setProperty(BH_STAFF_V33_LAST_KEY, JSON.stringify(result));
  props.deleteProperty(BH_STAFF_V33_ERROR_KEY);
  staffDiagV33_('SETUP', result);
  return result;
}

function removeStaffEventSyncV3() {
  staffDeleteTriggersV33_();
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty(BH_STAFF_V33_ENABLED_KEY);
  props.deleteProperty('STAFF_EVENT_SYNC_V3_ENABLED');
  props.deleteProperty(BH_STAFF_V33_PENDING_KEY);
  return {ok:true};
}

function getStaffEventSyncV3Status() {
  var props = PropertiesService.getScriptProperties();
  var handlers = ScriptApp.getProjectTriggers().map(function(t){ return t.getHandlerFunction(); });
  var snapshot = staffLoadSnapshotV33_();
  return {
    version:'3.3_RELIABLE_DELTA',
    enabled:props.getProperty(BH_STAFF_V33_ENABLED_KEY) === '1',
    source_id:BH_STAFF_V33_SOURCE_ID,
    source_tab:BH_STAFF_V33_SOURCE_TAB,
    has_edit_trigger:handlers.indexOf('staffSourceEditV3') >= 0,
    has_change_trigger:handlers.indexOf('staffSourceChangeV3') >= 0,
    has_retry_trigger:handlers.indexOf('staffRetryPendingV3') >= 0,
    snapshot_rows:Object.keys(snapshot).length,
    pending:props.getProperty(BH_STAFF_V33_PENDING_KEY) || '',
    last_sync:props.getProperty(BH_STAFF_V33_LAST_KEY) || '',
    last_error:props.getProperty(BH_STAFF_V33_ERROR_KEY) || ''
  };
}

function staffSourceEditV3(e) {
  try {
    if (!e || !e.range) return;
    var sheet = e.range.getSheet();
    if (!sheet || sheet.getParent().getId() !== BH_STAFF_V33_SOURCE_ID || sheet.getName() !== BH_STAFF_V33_SOURCE_TAB) return;
    if (e.range.getLastRow() <= 1) return;
    if (!staffTouchesRelevantV33_(e.range)) return;

    staffDiagV33_('EVENT_RECEIVED', {kind:'EDIT',range:e.range.getA1Notation(),at:new Date().toISOString()});
    var proof;
    if (e.range.getColumn() <= 1 && e.range.getLastColumn() >= 1) {
      proof = staffSyncDiffV33_('EDIT_EMPLOYEE_CODE_' + e.range.getA1Notation());
    } else {
      proof = staffSyncEditedRangeV33_(e.range, 'EDIT_ROWS_' + e.range.getA1Notation());
    }
    staffClearPendingV33_();
    staffDiagV33_('EVENT_DONE', proof);
    return proof;
  } catch (error) {
    staffHandleFailureV33_('EDIT', error);
  }
}

function staffSourceChangeV3(e) {
  try {
    var changeType = String(e && e.changeType || '').toUpperCase();
    if (changeType === 'EDIT') return;
    staffDiagV33_('EVENT_RECEIVED', {kind:'CHANGE',change_type:changeType || 'OTHER',at:new Date().toISOString()});
    var proof = staffSyncDiffV33_('CHANGE_' + (changeType || 'OTHER'));
    staffClearPendingV33_();
    staffDiagV33_('EVENT_DONE', proof);
    return proof;
  } catch (error) {
    staffHandleFailureV33_('CHANGE', error);
  }
}

function staffRetryPendingV3() {
  try {
    var props = PropertiesService.getScriptProperties();
    if (!props.getProperty(BH_STAFF_V33_PENDING_KEY)) {
      staffDeleteRetryTriggersV33_();
      return {ok:true,skipped:'NO_PENDING'};
    }
    var proof = staffSyncDiffV33_('RETRY_PENDING');
    staffClearPendingV33_();
    staffDeleteRetryTriggersV33_();
    staffDiagV33_('RETRY_DONE', proof);
    return proof;
  } catch (error) {
    staffRecordErrorV33_('RETRY', error);
    staffDiagV33_('RETRY_ERROR', {error:safeError_(error),at:new Date().toISOString()});
    staffEnsureRetryTriggerV33_();
    throw error;
  }
}

function staffSyncEditedRangeV33_(range, reason) {
  var lock = LockService.getUserLock();
  if (!lock.tryLock(5000)) throw new Error('STAFF_V33_BUSY_RETRY');
  var changed = 0;
  var proof = null;
  try {
    var snapshot = staffLoadSnapshotV33_();
    if (!Object.keys(snapshot).length) return staffSyncDiffLockedV33_(reason + '_NO_SNAPSHOT');
    var startRow = Math.max(2, range.getRow());
    var endRow = Math.max(startRow, range.getLastRow());
    var rows = range.getSheet().getRange(startRow, 1, endRow - startRow + 1, 6).getValues();
    var items = [];
    var needsDiff = false;
    rows.forEach(function(row) {
      var item = staffRowV33_(row);
      if (!item) { needsDiff = true; return; }
      items.push(item);
    });
    if (needsDiff) return staffSyncDiffLockedV33_(reason + '_CLEAR_OR_INVALID');

    var dirty = items.filter(function(item) { return snapshot[item.employee_code] !== staffItemHashV33_(item); });
    if (!dirty.length) {
      proof = staffProofV33_(reason, 0, 0, 0, 'NO_CHANGE');
      staffSaveProofV33_(proof);
      return proof;
    }

    var token = workerAdminIdToken_();
    var profiles = neonRpc_('worker_profiles_by_codes_rpc', {p_codes:dirty.map(function(item){ return item.employee_code; })}, token) || [];
    var existing = {};
    profiles.forEach(function(p){ existing[String(p.employee_code || '')] = p; });
    var created = 0, updated = 0;
    dirty.forEach(function(item) {
      var r = staffApplyItemV33_(item, existing[item.employee_code], token);
      if (r === 'CREATED') created++;
      else if (r === 'UPDATED') updated++;
      snapshot[item.employee_code] = staffItemHashV33_(item);
    });
    staffSaveSnapshotMapV33_(snapshot);
    changed = created + updated;
    proof = staffProofV33_(reason, created, updated, 0, 'SUCCEEDED');
    staffSaveProofV33_(proof);
  } finally {
    lock.releaseLock();
  }
  if (changed) staffKickRealtimeV33_(reason);
  return proof;
}

function staffSyncDiffV33_(reason) {
  var lock = LockService.getUserLock();
  if (!lock.tryLock(5000)) throw new Error('STAFF_V33_BUSY_RETRY');
  var proof;
  var changed = 0;
  try {
    proof = staffSyncDiffLockedV33_(reason);
    changed = Number(proof.created || 0) + Number(proof.updated || 0) + Number(proof.deactivated || 0);
  } finally {
    lock.releaseLock();
  }
  if (changed) staffKickRealtimeV33_(reason);
  return proof;
}

function staffSyncDiffLockedV33_(reason) {
  var state = staffReadSourceV33_();
  var previous = staffLoadSnapshotV33_();
  if (!Object.keys(previous).length) {
    staffSaveSnapshotV33_(state.items);
    var initProof = staffProofV33_(reason, 0, 0, 0, 'SNAPSHOT_INITIALIZED');
    staffSaveProofV33_(initProof);
    return initProof;
  }

  var current = {};
  var currentItems = {};
  state.items.forEach(function(item) {
    current[item.employee_code] = staffItemHashV33_(item);
    currentItems[item.employee_code] = item;
  });
  var upsertItems = [];
  Object.keys(current).forEach(function(code) { if (previous[code] !== current[code]) upsertItems.push(currentItems[code]); });
  var deletedCodes = Object.keys(previous).filter(function(code) { return !current[code]; });

  if (!upsertItems.length && !deletedCodes.length) {
    var noChange = staffProofV33_(reason, 0, 0, 0, 'NO_CHANGE');
    staffSaveProofV33_(noChange);
    return noChange;
  }
  if (upsertItems.length + deletedCodes.length > 50) throw new Error('STAFF_V33_DIFF_SUSPICIOUS:' + (upsertItems.length + deletedCodes.length));

  var token = workerAdminIdToken_();
  var codes = upsertItems.map(function(i){ return i.employee_code; }).concat(deletedCodes);
  var profiles = codes.length ? (neonRpc_('worker_profiles_by_codes_rpc', {p_codes:codes}, token) || []) : [];
  var existing = {};
  profiles.forEach(function(p){ existing[String(p.employee_code || '')] = p; });

  var created = 0, updated = 0, deactivated = 0;
  upsertItems.forEach(function(item) {
    var r = staffApplyItemV33_(item, existing[item.employee_code], token);
    if (r === 'CREATED') created++;
    else if (r === 'UPDATED') updated++;
  });
  deletedCodes.forEach(function(code) {
    var old = existing[code];
    if (!old || old.protected_account || old.role === 'ADMIN' || old.source_kind !== 'GSHEET' || old.active !== true) return;
    firebaseAdminUpdate_(String(old.id), {disableUser:true});
    neonRpc_('worker_profile_deactivate_rpc', {p_id:String(old.id),p_reason:'STAFF_SOURCE_MISSING'}, token);
    deactivated++;
  });

  staffSaveSnapshotMapV33_(current);
  var proof = staffProofV33_(reason, created, updated, deactivated, 'SUCCEEDED');
  staffSaveProofV33_(proof);
  return proof;
}

function staffApplyItemV33_(item, old, token) {
  if (item.employee_code === BH_STAFF_V33_PROTECTED_ADMIN) return 'UNCHANGED';
  if (old && (old.protected_account || old.role === 'ADMIN')) throw new Error('PROTECTED_PROFILE_COLLISION:' + item.employee_code);
  var changed = !old || String(old.full_name || '') !== item.full_name || String(old.contractor || '') !== item.contractor || String(old.role || '') !== item.role || old.active !== true || String(old.source_kind || '') !== 'GSHEET' || String(old.source_position || '') !== item.source_position;
  if (!changed) return 'UNCHANGED';

  var uid = old ? String(old.id) : Utilities.getUuid();
  if (old) {
    firebaseAdminUpdate_(uid, {email:employeeEmail_(item.employee_code),displayName:item.full_name,emailVerified:true,disableUser:false,customAttributes:claims_(item.employee_code, item.role)});
  } else {
    var password = requiredProp_('STAFF_DEFAULT_PASSWORD');
    firebaseAdminCreate_(uid, employeeEmail_(item.employee_code), password, item.full_name, false);
    try {
      firebaseAdminUpdate_(uid, {emailVerified:true,customAttributes:claims_(item.employee_code, item.role)});
    } catch (error) {
      try { firebaseAdminDelete_(uid); } catch (ignore) {}
      throw error;
    }
  }

  try {
    neonRpc_('worker_profile_upsert_rpc', {p_id:uid,p_employee_code:item.employee_code,p_full_name:item.full_name,p_contractor:item.contractor,p_role:item.role,p_active:true,p_source_kind:'GSHEET',p_source_position:item.source_position,p_protected_account:false}, token);
  } catch (error) {
    if (!old) try { firebaseAdminDelete_(uid); } catch (ignore2) {}
    throw error;
  }
  return old ? 'UPDATED' : 'CREATED';
}

function staffReadSourceV33_() {
  var ss = SpreadsheetApp.openById(BH_STAFF_V33_SOURCE_ID);
  if (ss.getId() !== BH_STAFF_V33_SOURCE_ID) throw new Error('STAFF_V33_SOURCE_ID_MISMATCH');
  if (String(ss.getName() || '').trim() !== BH_STAFF_V33_SOURCE_TITLE) throw new Error('STAFF_V33_SOURCE_TITLE_MISMATCH:' + ss.getName());
  var sheet = ss.getSheetByName(BH_STAFF_V33_SOURCE_TAB);
  if (!sheet) throw new Error('STAFF_V33_SOURCE_TAB_NOT_FOUND');

  var expected = ['Mã nhân viên','Họ và tên','Số điện thoại','Vị trí chính','Nhà cung cấp','Bộ phận','Site','Kho'];
  var headers = sheet.getRange(1,1,1,8).getDisplayValues()[0];
  for (var h=0; h<expected.length; h++) if (String(headers[h] || '').trim() !== expected[h]) throw new Error('STAFF_V33_HEADER_MISMATCH_COL_' + (h+1));

  var count = Math.max(0, sheet.getLastRow() - 1);
  if (count < BH_STAFF_V33_MIN_ROWS || count > BH_STAFF_V33_MAX_ROWS) throw new Error('STAFF_V33_ROW_COUNT_SUSPICIOUS:' + count);
  var rows = sheet.getRange(2,1,count,6).getValues();
  var items = [];
  var seen = {};
  rows.forEach(function(row) {
    var item = staffRowV33_(row);
    if (!item) return;
    if (seen[item.employee_code]) throw new Error('STAFF_V33_DUPLICATE_CODE:' + item.employee_code);
    seen[item.employee_code] = true;
    items.push(item);
  });
  if (items.length < BH_STAFF_V33_MIN_ROWS || items.length > BH_STAFF_V33_MAX_ROWS) throw new Error('STAFF_V33_VALID_COUNT_SUSPICIOUS:' + items.length);
  return {sheet:sheet,items:items};
}

function staffRowV33_(row) {
  var code = String(row[0] || '').trim();
  var name = String(row[1] || '').trim();
  if (!code && !name) return null;
  if (!code || !name) return null;
  var position = String(row[3] || '').trim();
  var contractor = String(row[4] || '').trim();
  var department = String(row[5] || '').trim();
  return {employee_code:code,full_name:name,source_position:position,contractor:contractor,department:department,role:staffRoleV33_(position, department, code)};
}

function staffRoleV33_(position, department, code) {
  if (String(code) === BH_STAFF_V33_PROTECTED_ADMIN) return 'ADMIN';
  var p = staffNormV33_(position);
  var d = staffNormV33_(department);
  if (p.indexOf('DIEU PHOI') >= 0) return 'ADMIN_INVENT';
  if (p.indexOf('INVENT') >= 0 || d.indexOf('INVENT') >= 0) return 'INVENT';
  return 'PICKER';
}

function staffNormV33_(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[Đđ]/g, 'D').toUpperCase().trim();
}

function staffTouchesRelevantV33_(range) {
  var first = range.getColumn();
  var last = range.getLastColumn();
  return BH_STAFF_V33_RELEVANT_COLUMNS.some(function(c){ return c >= first && c <= last; });
}

function staffItemHashV33_(item) {
  var canonical = [item.employee_code,item.full_name,item.source_position,item.contractor,item.department,item.role].join('|');
  return sha256Hex_(canonical).slice(0,12);
}

function staffSaveSnapshotV33_(items) {
  var map = {};
  items.forEach(function(item){ map[item.employee_code] = staffItemHashV33_(item); });
  staffSaveSnapshotMapV33_(map);
}

function staffSaveSnapshotMapV33_(map) {
  var lines = Object.keys(map).sort().map(function(code){ return code + '|' + map[code]; });
  var text = lines.join('\n');
  if (text.length > 8500) throw new Error('STAFF_V33_SNAPSHOT_TOO_LARGE:' + text.length);
  PropertiesService.getScriptProperties().setProperty(BH_STAFF_V33_SNAPSHOT_KEY, text);
}

function staffLoadSnapshotV33_() {
  var text = PropertiesService.getScriptProperties().getProperty(BH_STAFF_V33_SNAPSHOT_KEY) || '';
  var map = {};
  if (!text) return map;
  text.split('\n').forEach(function(line) {
    var i = line.indexOf('|');
    if (i <= 0) return;
    map[line.slice(0,i)] = line.slice(i+1);
  });
  return map;
}

function staffProofV33_(reason, created, updated, deactivated, status) {
  return {version:'3.3_RELIABLE_DELTA',status:status,reason:reason,created:Number(created || 0),updated:Number(updated || 0),deactivated:Number(deactivated || 0),changed:Number(created || 0) + Number(updated || 0) + Number(deactivated || 0),at:new Date().toISOString()};
}

function staffSaveProofV33_(proof) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty(BH_STAFF_V33_LAST_KEY, JSON.stringify(proof));
  props.deleteProperty(BH_STAFF_V33_ERROR_KEY);
}

function staffRecordErrorV33_(kind, error) {
  PropertiesService.getScriptProperties().setProperty(BH_STAFF_V33_ERROR_KEY, JSON.stringify({version:'3.3_RELIABLE_DELTA',kind:kind,error:safeError_(error),at:new Date().toISOString()}));
}

function staffHandleFailureV33_(kind, error) {
  staffRecordErrorV33_(kind, error);
  PropertiesService.getScriptProperties().setProperty(BH_STAFF_V33_PENDING_KEY, JSON.stringify({kind:kind,error:safeError_(error),at:new Date().toISOString()}));
  staffDiagV33_('EVENT_ERROR', {kind:kind,error:safeError_(error),at:new Date().toISOString()});
  staffEnsureRetryTriggerV33_();
}

function staffEnsureRetryTriggerV33_() {
  var has = ScriptApp.getProjectTriggers().some(function(t) { return t.getHandlerFunction() === 'staffRetryPendingV3'; });
  if (!has) ScriptApp.newTrigger('staffRetryPendingV3').timeBased().after(60000).create();
}

function staffClearPendingV33_() {
  PropertiesService.getScriptProperties().deleteProperty(BH_STAFF_V33_PENDING_KEY);
  staffDeleteRetryTriggersV33_();
}

function staffDeleteRetryTriggersV33_() {
  ScriptApp.getProjectTriggers().forEach(function(t) { if (t.getHandlerFunction() === 'staffRetryPendingV3') ScriptApp.deleteTrigger(t); });
}

function staffDeleteTriggersV33_() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    var h = t.getHandlerFunction();
    if (h === 'staffSourceEditV2' || h === 'staffSourceChangeV2' || h === 'staffSourceEditV3' || h === 'staffSourceChangeV3' || h === 'staffRetryPendingV3') ScriptApp.deleteTrigger(t);
  });
}

function staffKickRealtimeV33_(reason) {
  try { workerTick_('STAFF_EVENT_V33_' + reason); }
  catch (error) {
    PropertiesService.getScriptProperties().setProperty('LAST_STAFF_EVENT_SYNC_V33_REALTIME_ERROR', JSON.stringify({reason:reason,error:safeError_(error),at:new Date().toISOString()}));
  }
}

function staffDiagV33_(stage, payload) {
  try {
    var ss = reportSpreadsheet_();
    var sheet = ss.getSheetByName('THONG_TIN');
    if (!sheet) sheet = getOrCreateSheet_('THONG_TIN', ['Mục','Giá trị']);
    var last = Math.max(1, sheet.getLastRow());
    var values = last > 1 ? sheet.getRange(2,1,last-1,1).getDisplayValues() : [];
    var row = 0;
    for (var i=0; i<values.length; i++) {
      if (String(values[i][0] || '').trim() === BH_STAFF_V33_DIAG_LABEL) { row = i + 2; break; }
    }
    if (!row) row = last + 1;
    sheet.getRange(row,1,1,2).setValues([[BH_STAFF_V33_DIAG_LABEL,JSON.stringify({stage:stage,payload:payload || {},at:new Date().toISOString()})]]);
  } catch (ignore) {}
}
