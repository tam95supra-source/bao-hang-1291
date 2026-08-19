// BÁO HÀNG 1291 — event-driven staff synchronization.
// Loaded into the same Apps Script project as DEPLOY_NEON.gs.
// No secrets are stored here; Firebase/default-password credentials remain in Script Properties.

var BH_STAFF_EVENT_RELEVANT_COLUMNS_V2 = [1, 2, 4, 5, 6]; // A MNV, B tên, D vị trí, E NCC, F bộ phận
var BH_STAFF_EVENT_MAX_ROWS_V2 = 500;

/**
 * One-time installer. Requires owner authorization because installable triggers
 * run under the account that creates them and can use the worker's authorized services.
 */
function setupStaffEventSyncV2() {
  assertScope_();
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    var handler = trigger.getHandlerFunction();
    if (handler === 'staffSourceEditV2' || handler === 'staffSourceChangeV2') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger('staffSourceEditV2')
    .forSpreadsheet(BH_STAFF_SHEET_ID)
    .onEdit()
    .create();
  ScriptApp.newTrigger('staffSourceChangeV2')
    .forSpreadsheet(BH_STAFF_SHEET_ID)
    .onChange()
    .create();
  PropertiesService.getScriptProperties().setProperty('STAFF_EVENT_SYNC_V2_ENABLED', '1');
  return {ok:true, source_sheet_id:BH_STAFF_SHEET_ID, source_tab:BH_STAFF_SHEET_NAME, mode:'EVENT_DRIVEN_V2'};
}

function removeStaffEventSyncV2() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    var handler = trigger.getHandlerFunction();
    if (handler === 'staffSourceEditV2' || handler === 'staffSourceChangeV2') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  PropertiesService.getScriptProperties().deleteProperty('STAFF_EVENT_SYNC_V2_ENABLED');
  return {ok:true};
}

/** Normal content edits. Multi-cell paste is handled as one event/range. */
function staffSourceEditV2(e) {
  try {
    if (!e || !e.range) return;
    var sheet = e.range.getSheet();
    if (!sheet || sheet.getParent().getId() !== BH_STAFF_SHEET_ID || sheet.getName() !== BH_STAFF_SHEET_NAME) return;
    if (!staffRangeTouchesRelevantColumnsV2_(e.range)) return;
    if (e.range.getRow() <= 1) return;

    // Changing employee code can leave an old account behind, so reconcile the whole 400-row source.
    if (e.range.getColumn() <= 1 && e.range.getLastColumn() >= 1) {
      staffFullReconcileV2_('EDIT_EMPLOYEE_CODE');
      return;
    }
    staffDeltaSyncRangeV2_(e.range, 'EDIT_ROWS');
  } catch (error) {
    staffRecordEventErrorV2_('EDIT', error);
    throw error;
  }
}

/** Row/column insertion/deletion and other structural source changes. EDIT is handled above. */
function staffSourceChangeV2(e) {
  try {
    var changeType = String(e && e.changeType || '').toUpperCase();
    if (changeType === 'EDIT') return;
    staffFullReconcileV2_('CHANGE_' + (changeType || 'OTHER'));
  } catch (error) {
    staffRecordEventErrorV2_('CHANGE', error);
    throw error;
  }
}

function staffRangeTouchesRelevantColumnsV2_(range) {
  var first = range.getColumn();
  var last = range.getLastColumn();
  return BH_STAFF_EVENT_RELEVANT_COLUMNS_V2.some(function(column) { return column >= first && column <= last; });
}

function staffDeltaSyncRangeV2_(range, reason) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var sheet = range.getSheet();
    var startRow = Math.max(2, range.getRow());
    var endRow = Math.max(startRow, range.getLastRow());
    var rows = sheet.getRange(startRow, 1, endRow - startRow + 1, 6).getValues();
    var items = [];
    var invalid = false;
    rows.forEach(function(row) {
      var item = staffRowV2_(row);
      if (!item) { invalid = true; return; }
      items.push(item);
    });
    // Clearing a code/name can mean a removal. Full reconcile is the safe path and is rare.
    if (invalid) return staffFullReconcileUnlockedV2_(reason + '_INVALID_ROW');
    if (!items.length) return {status:'NO_CHANGE', changed:0};

    var token = workerAdminIdToken_();
    var codes = items.map(function(item){ return item.employee_code; });
    var profiles = neonRpc_('worker_profiles_by_codes_rpc', {p_codes:codes}, token) || [];
    var existing = {};
    profiles.forEach(function(profile){ existing[String(profile.employee_code || '').toLowerCase()] = profile; });

    var created = 0, updated = 0, unchanged = 0;
    var errors = [];
    items.forEach(function(item) {
      try {
        var result = staffApplyItemV2_(item, existing[item.employee_code.toLowerCase()], token);
        if (result === 'CREATED') created++;
        else if (result === 'UPDATED') updated++;
        else unchanged++;
      } catch (error) {
        errors.push(item.employee_code + ': ' + safeError_(error));
      }
    });
    if (errors.length) throw new Error('STAFF_EVENT_PARTIAL: ' + errors.slice(0,10).join('; '));
    if (created || updated) workerTick_('STAFF_EVENT_DELTA');
    var proof = {status:'SUCCEEDED', mode:'DELTA', reason:reason, rows:items.length, created:created, updated:updated, unchanged:unchanged, at:new Date().toISOString()};
    PropertiesService.getScriptProperties().setProperty('LAST_STAFF_EVENT_SYNC_V2', JSON.stringify(proof));
    return proof;
  } finally {
    lock.releaseLock();
  }
}

function staffFullReconcileV2_(reason) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { return staffFullReconcileUnlockedV2_(reason); }
  finally { lock.releaseLock(); }
}

function staffFullReconcileUnlockedV2_(reason) {
  var source = staffReadFullSourceV2_();
  var token = workerAdminIdToken_();
  var profiles = neonRpc_('worker_profiles_snapshot_rpc', {}, token) || [];
  var existing = {};
  profiles.forEach(function(profile){ existing[String(profile.employee_code || '').toLowerCase()] = profile; });
  var seen = {};
  var created = 0, updated = 0, unchanged = 0, deactivated = 0;
  var errors = [];

  source.staff.forEach(function(item) {
    var key = item.employee_code.toLowerCase();
    seen[key] = true;
    try {
      var result = staffApplyItemV2_(item, existing[key], token);
      if (result === 'CREATED') created++;
      else if (result === 'UPDATED') updated++;
      else unchanged++;
    } catch (error) {
      errors.push(item.employee_code + ': ' + safeError_(error));
    }
  });

  if (!errors.length) {
    profiles.forEach(function(old) {
      var code = String(old.employee_code || '');
      if (old.source_kind !== 'GSHEET' || old.protected_account || old.role === 'ADMIN' || !old.active || seen[code.toLowerCase()]) return;
      try {
        firebaseAdminUpdate_(String(old.id), {disableUser:true});
        neonRpc_('worker_profile_deactivate_rpc', {p_id:String(old.id), p_reason:'STAFF_SOURCE_MISSING'}, token);
        deactivated++;
      } catch (error) {
        errors.push(code + ': DEACTIVATE: ' + safeError_(error));
      }
    });
  }
  if (errors.length) throw new Error('STAFF_EVENT_FULL_PARTIAL: ' + errors.slice(0,10).join('; '));
  if (created || updated || deactivated) workerTick_('STAFF_EVENT_FULL');

  var proof = {
    status:'SUCCEEDED', mode:'FULL', reason:reason,
    source_rows:source.staff.length, source_hash:source.sourceHash,
    created:created, updated:updated, unchanged:unchanged, deactivated:deactivated,
    at:new Date().toISOString()
  };
  PropertiesService.getScriptProperties().setProperty('LAST_STAFF_EVENT_SYNC_V2', JSON.stringify(proof));
  return proof;
}

function staffApplyItemV2_(item, old, token) {
  if (item.employee_code === BH_PROTECTED_ADMIN_CODE) return 'UNCHANGED';
  if (old && (old.protected_account || old.role === 'ADMIN')) throw new Error('PROTECTED_PROFILE_COLLISION');
  var changed = !old || old.full_name !== item.full_name || old.contractor !== item.contractor || old.role !== item.role || old.active !== true || old.source_kind !== 'GSHEET' || String(old.source_position || '') !== item.source_position;
  if (!changed) return 'UNCHANGED';

  var uid = old ? String(old.id) : Utilities.getUuid();
  if (old) {
    firebaseAdminUpdate_(uid, {
      email:employeeEmail_(item.employee_code),
      displayName:item.full_name,
      emailVerified:true,
      disableUser:false,
      customAttributes:claims_(item.employee_code,item.role)
    });
  } else {
    var password = requiredProp_('STAFF_DEFAULT_PASSWORD');
    firebaseAdminCreate_(uid, employeeEmail_(item.employee_code), password, item.full_name, false);
    try {
      firebaseAdminUpdate_(uid, {emailVerified:true, customAttributes:claims_(item.employee_code,item.role)});
    } catch (error) {
      try { firebaseAdminDelete_(uid); } catch (ignore) {}
      throw error;
    }
  }
  try {
    neonRpc_('worker_profile_upsert_rpc', {
      p_id:uid,
      p_employee_code:item.employee_code,
      p_full_name:item.full_name,
      p_contractor:item.contractor,
      p_role:item.role,
      p_active:true,
      p_source_kind:'GSHEET',
      p_source_position:item.source_position,
      p_protected_account:false
    }, token);
  } catch (error) {
    if (!old) try { firebaseAdminDelete_(uid); } catch (ignore) {}
    throw error;
  }
  return old ? 'UPDATED' : 'CREATED';
}

function staffReadFullSourceV2_() {
  var spreadsheet = SpreadsheetApp.openById(BH_STAFF_SHEET_ID);
  var sheet = spreadsheet.getSheetByName(BH_STAFF_SHEET_NAME);
  if (!sheet) throw new Error('STAFF_SOURCE_TAB_NOT_FOUND');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2 || lastRow - 1 > BH_STAFF_EVENT_MAX_ROWS_V2) throw new Error('STAFF_SOURCE_COUNT_INVALID');
  var values = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
  var byCode = {};
  values.forEach(function(row) {
    var item = staffRowV2_(row);
    if (!item) return;
    var key = item.employee_code.toLowerCase();
    if (byCode[key]) throw new Error('DUPLICATE_EMPLOYEE_CODE:' + item.employee_code);
    byCode[key] = item;
  });
  var keys = Object.keys(byCode).sort();
  var staff = keys.map(function(key){ return byCode[key]; });
  if (staff.length < 350 || staff.length > BH_STAFF_EVENT_MAX_ROWS_V2) throw new Error('STAFF_SOURCE_COUNT_SUSPICIOUS:' + staff.length);
  var canonical = staff.map(function(item){ return [item.employee_code,item.full_name,item.contractor,item.source_position,item.role].join('|'); }).join('\n');
  return {staff:staff, sourceHash:sha256Hex_(canonical)};
}

function staffRowV2_(row) {
  var code = String(row[0] || '').trim();
  var name = String(row[1] || '').trim();
  if (!code && !name) return null;
  if (!code || !name) return null;
  var position = String(row[3] || '').trim();
  var contractor = String(row[4] || '').trim();
  var department = String(row[5] || '').trim();
  return {
    employee_code:code,
    full_name:name,
    source_position:position,
    contractor:contractor,
    department:department,
    role:staffRole_(position, department, code)
  };
}

function staffRecordEventErrorV2_(kind, error) {
  PropertiesService.getScriptProperties().setProperty('LAST_STAFF_EVENT_SYNC_V2_ERROR', JSON.stringify({kind:kind,error:safeError_(error),at:new Date().toISOString()}));
}
