// BÁO HÀNG 1291 — event-driven staff synchronization V3.1
// Paste into the SAME Apps Script project as the Báo hàng worker (DEPLOY_NEON/Mã.gs).
// Source of truth is pinned here and does NOT depend on any legacy BH_STAFF_SHEET_ID constant.

var BH_STAFF_EVENT_SOURCE_ID_V31 = '1E7ZWz-4eMcBliQxDYBVoogIoeSYyiaXGwj0I6mbMm78';
var BH_STAFF_EVENT_SOURCE_TITLE_V31 = 'DỮ LIỆU THEO NGÀY';
var BH_STAFF_EVENT_SOURCE_TAB_V31 = 'DANH SÁCH NHÂN SỰ';
var BH_STAFF_EVENT_PROTECTED_ADMIN_V31 = '6281280';
var BH_STAFF_EVENT_RELEVANT_COLUMNS_V31 = [1, 2, 4, 5, 6]; // A MNV, B tên, D vị trí, E NCC, F bộ phận
var BH_STAFF_EVENT_MAX_ROWS_V31 = 500;
var BH_STAFF_EVENT_INSTALL_MIN_ROWS_V31 = 300;

/**
 * One-time installer.
 * Creates installable onEdit + onChange triggers on DỮ LIỆU THEO NGÀY by exact spreadsheet ID.
 * Requires owner authorization once because installable triggers run as the creator.
 */
function setupStaffEventSyncV3() {
  assertScope_();
  var source = staffValidateSourceV31_();

  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    var handler = trigger.getHandlerFunction();
    if (
      handler === 'staffSourceEditV2' ||
      handler === 'staffSourceChangeV2' ||
      handler === 'staffSourceEditV3' ||
      handler === 'staffSourceChangeV3'
    ) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger('staffSourceEditV3')
    .forSpreadsheet(BH_STAFF_EVENT_SOURCE_ID_V31)
    .onEdit()
    .create();

  ScriptApp.newTrigger('staffSourceChangeV3')
    .forSpreadsheet(BH_STAFF_EVENT_SOURCE_ID_V31)
    .onChange()
    .create();

  var props = PropertiesService.getScriptProperties();
  props.deleteProperty('STAFF_EVENT_SYNC_V2_ENABLED');
  props.setProperty('STAFF_EVENT_SYNC_V3_ENABLED', '1');
  props.setProperty('STAFF_EVENT_SYNC_V3_SOURCE_ID', BH_STAFF_EVENT_SOURCE_ID_V31);
  props.setProperty('STAFF_EVENT_SYNC_V3_SOURCE_TAB', BH_STAFF_EVENT_SOURCE_TAB_V31);

  // Prove the full path immediately, but guarded against suspicious mass deletion.
  var proof = staffFullReconcileV31_('INSTALL');
  props.setProperty(
    'STAFF_EVENT_SYNC_V3_BASELINE_COUNT',
    String(proof.source_rows || source.rowCount)
  );

  return {
    ok: true,
    mode: 'EVENT_DRIVEN_V3_1',
    source_title: source.title,
    source_sheet_id: BH_STAFF_EVENT_SOURCE_ID_V31,
    source_tab: BH_STAFF_EVENT_SOURCE_TAB_V31,
    edit_trigger: 'staffSourceEditV3',
    change_trigger: 'staffSourceChangeV3',
    initial_reconcile: proof
  };
}

function removeStaffEventSyncV3() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    var handler = trigger.getHandlerFunction();
    if (handler === 'staffSourceEditV3' || handler === 'staffSourceChangeV3') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  var props = PropertiesService.getScriptProperties();
  props.deleteProperty('STAFF_EVENT_SYNC_V3_ENABLED');
  props.deleteProperty('STAFF_EVENT_SYNC_V3_SOURCE_ID');
  props.deleteProperty('STAFF_EVENT_SYNC_V3_SOURCE_TAB');

  return {ok: true};
}

function getStaffEventSyncV3Status() {
  var props = PropertiesService.getScriptProperties();
  var handlers = ScriptApp.getProjectTriggers().map(function(trigger) {
    return trigger.getHandlerFunction();
  });

  return {
    enabled: props.getProperty('STAFF_EVENT_SYNC_V3_ENABLED') === '1',
    source_id: props.getProperty('STAFF_EVENT_SYNC_V3_SOURCE_ID') || '',
    source_tab: props.getProperty('STAFF_EVENT_SYNC_V3_SOURCE_TAB') || '',
    expected_source_id: BH_STAFF_EVENT_SOURCE_ID_V31,
    expected_source_tab: BH_STAFF_EVENT_SOURCE_TAB_V31,
    has_edit_trigger: handlers.indexOf('staffSourceEditV3') >= 0,
    has_change_trigger: handlers.indexOf('staffSourceChangeV3') >= 0,
    last_sync: props.getProperty('LAST_STAFF_EVENT_SYNC_V3') || '',
    last_error: props.getProperty('LAST_STAFF_EVENT_SYNC_V3_ERROR') || '',
    last_realtime_error: props.getProperty('LAST_STAFF_EVENT_SYNC_V3_REALTIME_ERROR') || ''
  };
}

/**
 * Normal edits / paste / clearing cells.
 * Only columns used by Báo hàng identity/role are relevant:
 * A MNV, B Họ tên, D Vị trí, E Nhà cung cấp, F Bộ phận.
 */
function staffSourceEditV3(e) {
  try {
    if (!e || !e.range) return;

    var sheet = e.range.getSheet();
    if (
      !sheet ||
      sheet.getParent().getId() !== BH_STAFF_EVENT_SOURCE_ID_V31 ||
      sheet.getName() !== BH_STAFF_EVENT_SOURCE_TAB_V31
    ) return;

    if (e.range.getLastRow() <= 1) return;
    if (!staffRangeTouchesRelevantColumnsV31_(e.range)) return;

    // Editing MNV may orphan the old identity, so full reconcile is safest.
    if (e.range.getColumn() <= 1 && e.range.getLastColumn() >= 1) {
      staffFullReconcileV31_('EDIT_EMPLOYEE_CODE');
      return;
    }

    staffDeltaSyncRangeV31_(e.range, 'EDIT_ROWS');
  } catch (error) {
    staffRecordEventErrorV31_('EDIT', error);
    throw error;
  }
}

/**
 * Structural changes: insert/delete row, remove grid, etc.
 * EDIT is already handled by onEdit.
 */
function staffSourceChangeV3(e) {
  try {
    var changeType = String(e && e.changeType || '').toUpperCase();
    if (changeType === 'EDIT') return;
    staffFullReconcileV31_('CHANGE_' + (changeType || 'OTHER'));
  } catch (error) {
    staffRecordEventErrorV31_('CHANGE', error);
    throw error;
  }
}

function staffRangeTouchesRelevantColumnsV31_(range) {
  var first = range.getColumn();
  var last = range.getLastColumn();

  return BH_STAFF_EVENT_RELEVANT_COLUMNS_V31.some(function(column) {
    return column >= first && column <= last;
  });
}

function staffDeltaSyncRangeV31_(range, reason) {
  var lock = LockService.getScriptLock();
  var proof = null;
  var needsFull = false;
  var changed = false;

  lock.waitLock(25000);
  try {
    var sheet = range.getSheet();
    var startRow = Math.max(2, range.getRow());
    var endRow = Math.max(startRow, range.getLastRow());
    var rows = sheet.getRange(startRow, 1, endRow - startRow + 1, 6).getValues();
    var items = [];

    rows.forEach(function(row) {
      var item = staffRowV31_(row);
      if (!item) {
        // Clearing code/name can mean deletion -> reconcile full source.
        needsFull = true;
        return;
      }
      items.push(item);
    });

    if (!needsFull && items.length) {
      var token = workerAdminIdToken_();
      var codes = items.map(function(item) { return item.employee_code; });
      var profiles = neonRpc_('worker_profiles_by_codes_rpc', {p_codes: codes}, token) || [];
      var existing = {};

      profiles.forEach(function(profile) {
        existing[String(profile.employee_code || '').toLowerCase()] = profile;
      });

      var created = 0;
      var updated = 0;
      var unchanged = 0;
      var errors = [];

      items.forEach(function(item) {
        try {
          var result = staffApplyItemV31_(
            item,
            existing[item.employee_code.toLowerCase()],
            token
          );
          if (result === 'CREATED') created++;
          else if (result === 'UPDATED') updated++;
          else unchanged++;
        } catch (error) {
          errors.push(item.employee_code + ': ' + safeError_(error));
        }
      });

      if (errors.length) {
        throw new Error('STAFF_EVENT_PARTIAL: ' + errors.slice(0, 10).join('; '));
      }

      changed = !!(created || updated);
      proof = {
        status: 'SUCCEEDED',
        mode: 'DELTA',
        reason: reason,
        rows: items.length,
        created: created,
        updated: updated,
        unchanged: unchanged,
        at: new Date().toISOString()
      };

      var props = PropertiesService.getScriptProperties();
      props.setProperty('LAST_STAFF_EVENT_SYNC_V3', JSON.stringify(proof));
      props.deleteProperty('LAST_STAFF_EVENT_SYNC_V3_ERROR');
    } else if (!needsFull) {
      proof = {
        status: 'NO_CHANGE',
        mode: 'DELTA',
        reason: reason,
        rows: 0,
        at: new Date().toISOString()
      };
    }
  } finally {
    lock.releaseLock();
  }

  if (needsFull) {
    return staffFullReconcileV31_(reason + '_INVALID_OR_CLEARED_ROW');
  }

  // workerTick_ uses the same script lock: always call AFTER releasing our lock.
  if (changed) staffKickRealtimeV31_('STAFF_EVENT_DELTA_V31');

  return proof || {status: 'NO_CHANGE', mode: 'DELTA', reason: reason};
}

function staffFullReconcileV31_(reason) {
  var lock = LockService.getScriptLock();
  var proof;
  var changed = false;

  lock.waitLock(25000);
  try {
    var source = staffReadFullSourceV31_();
    var token = workerAdminIdToken_();
    var profiles = neonRpc_('worker_profiles_snapshot_rpc', {}, token) || [];
    var existing = {};

    profiles.forEach(function(profile) {
      existing[String(profile.employee_code || '').toLowerCase()] = profile;
    });

    var seen = {};
    var created = 0;
    var updated = 0;
    var unchanged = 0;
    var deactivated = 0;
    var errors = [];

    source.staff.forEach(function(item) {
      var key = item.employee_code.toLowerCase();
      seen[key] = true;

      try {
        var result = staffApplyItemV31_(item, existing[key], token);
        if (result === 'CREATED') created++;
        else if (result === 'UPDATED') updated++;
        else unchanged++;
      } catch (error) {
        errors.push(item.employee_code + ': ' + safeError_(error));
      }
    });

    // Deactivate only accounts owned by the GSheet source.
    // Protected/Admin identities are never touched.
    if (!errors.length) {
      profiles.forEach(function(old) {
        var code = String(old.employee_code || '');

        if (
          old.source_kind !== 'GSHEET' ||
          old.protected_account ||
          old.role === 'ADMIN' ||
          !old.active ||
          seen[code.toLowerCase()]
        ) return;

        try {
          firebaseAdminUpdate_(String(old.id), {disableUser: true});
          neonRpc_(
            'worker_profile_deactivate_rpc',
            {p_id: String(old.id), p_reason: 'STAFF_SOURCE_MISSING'},
            token
          );
          deactivated++;
        } catch (error) {
          errors.push(code + ': DEACTIVATE: ' + safeError_(error));
        }
      });
    }

    if (errors.length) {
      throw new Error('STAFF_EVENT_FULL_PARTIAL: ' + errors.slice(0, 10).join('; '));
    }

    changed = !!(created || updated || deactivated);
    proof = {
      status: 'SUCCEEDED',
      mode: 'FULL',
      reason: reason,
      source_rows: source.staff.length,
      source_hash: source.sourceHash,
      created: created,
      updated: updated,
      unchanged: unchanged,
      deactivated: deactivated,
      at: new Date().toISOString()
    };

    var props = PropertiesService.getScriptProperties();
    props.setProperty('LAST_STAFF_EVENT_SYNC_V3', JSON.stringify(proof));
    props.deleteProperty('LAST_STAFF_EVENT_SYNC_V3_ERROR');
  } finally {
    lock.releaseLock();
  }

  if (changed) staffKickRealtimeV31_('STAFF_EVENT_FULL_V31');
  return proof;
}

function staffApplyItemV31_(item, old, token) {
  if (item.employee_code === BH_STAFF_EVENT_PROTECTED_ADMIN_V31) {
    return 'UNCHANGED';
  }

  if (old && (old.protected_account || old.role === 'ADMIN')) {
    throw new Error('PROTECTED_PROFILE_COLLISION');
  }

  var changed =
    !old ||
    old.full_name !== item.full_name ||
    old.contractor !== item.contractor ||
    old.role !== item.role ||
    old.active !== true ||
    old.source_kind !== 'GSHEET' ||
    String(old.source_position || '') !== item.source_position;

  if (!changed) return 'UNCHANGED';

  var uid = old ? String(old.id) : Utilities.getUuid();

  if (old) {
    firebaseAdminUpdate_(uid, {
      email: employeeEmail_(item.employee_code),
      displayName: item.full_name,
      emailVerified: true,
      disableUser: false,
      customAttributes: claims_(item.employee_code, item.role)
    });
  } else {
    var password = requiredProp_('STAFF_DEFAULT_PASSWORD');
    firebaseAdminCreate_(
      uid,
      employeeEmail_(item.employee_code),
      password,
      item.full_name,
      false
    );

    try {
      firebaseAdminUpdate_(uid, {
        emailVerified: true,
        customAttributes: claims_(item.employee_code, item.role)
      });
    } catch (error) {
      try { firebaseAdminDelete_(uid); } catch (ignore) {}
      throw error;
    }
  }

  try {
    neonRpc_(
      'worker_profile_upsert_rpc',
      {
        p_id: uid,
        p_employee_code: item.employee_code,
        p_full_name: item.full_name,
        p_contractor: item.contractor,
        p_role: item.role,
        p_active: true,
        p_source_kind: 'GSHEET',
        p_source_position: item.source_position,
        p_protected_account: false
      },
      token
    );
  } catch (error) {
    if (!old) {
      try { firebaseAdminDelete_(uid); } catch (ignore) {}
    }
    throw error;
  }

  return old ? 'UPDATED' : 'CREATED';
}

function staffValidateSourceV31_() {
  var spreadsheet = SpreadsheetApp.openById(BH_STAFF_EVENT_SOURCE_ID_V31);

  if (spreadsheet.getId() !== BH_STAFF_EVENT_SOURCE_ID_V31) {
    throw new Error('STAFF_SOURCE_ID_MISMATCH');
  }

  if (String(spreadsheet.getName() || '').trim() !== BH_STAFF_EVENT_SOURCE_TITLE_V31) {
    throw new Error('STAFF_SOURCE_TITLE_MISMATCH:' + spreadsheet.getName());
  }

  var sheet = spreadsheet.getSheetByName(BH_STAFF_EVENT_SOURCE_TAB_V31);
  if (!sheet) throw new Error('STAFF_SOURCE_TAB_NOT_FOUND');

  var expected = [
    'Mã nhân viên',
    'Họ và tên',
    'Số điện thoại',
    'Vị trí chính',
    'Nhà cung cấp',
    'Bộ phận',
    'Site',
    'Kho'
  ];

  var headers = sheet.getRange(1, 1, 1, 8).getDisplayValues()[0];

  for (var i = 0; i < expected.length; i++) {
    if (String(headers[i] || '').trim() !== expected[i]) {
      throw new Error('STAFF_SOURCE_HEADER_MISMATCH_COL_' + (i + 1));
    }
  }

  return {
    title: spreadsheet.getName(),
    sheet: sheet,
    rowCount: Math.max(0, sheet.getLastRow() - 1)
  };
}

function staffReadFullSourceV31_() {
  var validated = staffValidateSourceV31_();
  var sheet = validated.sheet;
  var lastRow = sheet.getLastRow();

  if (lastRow < 2 || lastRow - 1 > BH_STAFF_EVENT_MAX_ROWS_V31) {
    throw new Error('STAFF_SOURCE_COUNT_INVALID:' + Math.max(0, lastRow - 1));
  }

  var values = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
  var byCode = {};

  values.forEach(function(row) {
    var item = staffRowV31_(row);
    if (!item) return;

    var key = item.employee_code.toLowerCase();
    if (byCode[key]) {
      throw new Error('DUPLICATE_EMPLOYEE_CODE:' + item.employee_code);
    }
    byCode[key] = item;
  });

  var keys = Object.keys(byCode).sort();
  var staff = keys.map(function(key) { return byCode[key]; });
  var props = PropertiesService.getScriptProperties();
  var baseline = Number(
    props.getProperty('STAFF_EVENT_SYNC_V3_BASELINE_COUNT') || 0
  );

  var safetyFloor = baseline > 0
    ? Math.max(50, Math.floor(baseline * 0.70))
    : BH_STAFF_EVENT_INSTALL_MIN_ROWS_V31;

  if (staff.length < safetyFloor || staff.length > BH_STAFF_EVENT_MAX_ROWS_V31) {
    throw new Error(
      'STAFF_SOURCE_COUNT_SUSPICIOUS:' +
      staff.length +
      ':FLOOR=' +
      safetyFloor
    );
  }

  var canonical = staff.map(function(item) {
    return [
      item.employee_code,
      item.full_name,
      item.contractor,
      item.source_position,
      item.role
    ].join('|');
  }).join('\n');

  return {
    staff: staff,
    sourceHash: sha256Hex_(canonical)
  };
}

function staffRowV31_(row) {
  var code = String(row[0] || '').trim();
  var name = String(row[1] || '').trim();

  if (!code && !name) return null;
  if (!code || !name) return null;

  var position = String(row[3] || '').trim();
  var contractor = String(row[4] || '').trim();
  var department = String(row[5] || '').trim();

  return {
    employee_code: code,
    full_name: name,
    source_position: position,
    contractor: contractor,
    department: department,
    role: staffRole_(position, department, code)
  };
}

function staffKickRealtimeV31_(source) {
  try {
    workerTick_(source);
    PropertiesService.getScriptProperties()
      .deleteProperty('LAST_STAFF_EVENT_SYNC_V3_REALTIME_ERROR');
  } catch (error) {
    // Staff data is already committed to Firebase/Neon.
    // Record realtime drain failure for retry/diagnostics instead of corrupting sync state.
    PropertiesService.getScriptProperties().setProperty(
      'LAST_STAFF_EVENT_SYNC_V3_REALTIME_ERROR',
      JSON.stringify({
        source: source,
        error: safeError_(error),
        at: new Date().toISOString()
      })
    );
  }
}

function staffRecordEventErrorV31_(kind, error) {
  PropertiesService.getScriptProperties().setProperty(
    'LAST_STAFF_EVENT_SYNC_V3_ERROR',
    JSON.stringify({
      kind: kind,
      error: safeError_(error),
      at: new Date().toISOString()
    })
  );
}
