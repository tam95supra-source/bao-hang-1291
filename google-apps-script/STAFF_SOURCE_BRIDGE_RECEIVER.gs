/*
 * BÁO HÀNG 1291 — source-driven staff bridge receiver.
 * DỮ LIỆU THEO NGÀY emits only signed change metadata. Shared HMAC material lives only
 * in Apps Script Properties; receiver re-reads the trusted Sheet before mutating Firebase/Neon.
 */

const BH_STAFF_BRIDGE = Object.freeze({
  SOURCE_ID: '1E7ZWz-4eMcBliQxDYBVoogIoeSYyiaXGwj0I6mbMm78',
  SOURCE_TAB: 'DANH SÁCH NHÂN SỰ',
  SENDER_EMAIL: 'tam95.supra@gmail.com',
  HMAC_PROP: 'STAFF_BRIDGE_HMAC_SECRET',
  HMAC_MAX_SKEW_MS: 300000,
  MAX_DELTA_ROWS: 50,
  MIN_FULL_SOURCE_ROWS: 300,
  MAX_FULL_SOURCE_ROWS: 2000,
  MAX_DEACTIVATE_PER_EVENT: 100,
  MAX_DEACTIVATE_RATIO: 0.25,
  REPLAY_TTL_SECONDS: 21600
});

function staffSourceBridgeReceive_(body) {
  assertScope_();
  const action = String(body && body.action || '').trim();
  if (action !== 'staff-source-ping' && action !== 'staff-source-structure-ping') {
    throw new Error('STAFF_BRIDGE_ACTION_INVALID');
  }
  const configuredSource = staffSourceConfig_();
  if (String(body.source_id || '') !== configuredSource.sheetId || String(body.source_tab || '') !== configuredSource.sheetName) {
    throw new Error('STAFF_BRIDGE_SOURCE_MISMATCH');
  }

  const eventId = String(body.event_id || '').trim();
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(eventId)) throw new Error('STAFF_BRIDGE_EVENT_ID_INVALID');
  staffSourceBridgeVerifySender_(body);

  const cache = CacheService.getScriptCache();
  const replayKey = 'BH_STAFF_BRIDGE_' + sha256Hex_(eventId).slice(0, 40);
  if (cache.get(replayKey)) return {ok:true,replayed:true,event_id:eventId};

  // The source-driven bridge supersedes V2/V3 watchers installed in this project.
  staffSourceBridgeRemoveLegacyWatchers_();

  let result;
  if (action === 'staff-source-ping') result = staffSourceBridgeApplyRows_(body);
  else result = staffSourceBridgeReconcileStructure_(String(body.change_type || 'STRUCTURE'));

  cache.put(replayKey, '1', BH_STAFF_BRIDGE.REPLAY_TTL_SECONDS);
  const props = PropertiesService.getScriptProperties();
  props.setProperty('LAST_STAFF_SOURCE_BRIDGE_OK', JSON.stringify({
    event_id:eventId,
    action:action,
    changed:Number(result.changed || 0),
    at:new Date().toISOString()
  }));
  props.deleteProperty('LAST_STAFF_SOURCE_BRIDGE_ERROR');
  return Object.assign({ok:true,event_id:eventId,mode:'SOURCE_DRIVEN_DELTA_V1'}, result);
}

function staffSourceBridgeVerifySender_(body) {
  const signature = String(body && body.hmac_sha256 || '').trim().toLowerCase();
  const secret = String(PropertiesService.getScriptProperties().getProperty(BH_STAFF_BRIDGE.HMAC_PROP) || '');
  if (signature && secret.length >= 32) {
    const sentAt = Date.parse(String(body.sent_at || ''));
    if (!Number.isFinite(sentAt) || Math.abs(Date.now() - sentAt) > BH_STAFF_BRIDGE.HMAC_MAX_SKEW_MS) {
      throw new Error('STAFF_BRIDGE_HMAC_STALE');
    }
    const expected = staffSourceBridgeHmacHex_(body, secret);
    if (!staffSourceBridgeSecureEq_(signature, expected)) throw new Error('STAFF_BRIDGE_HMAC_INVALID');
    return 'HMAC';
  }
  staffSourceBridgeVerifyGoogleSender_(String(body && body.oauth_token || ''));
  return 'OAUTH';
}

function staffSourceBridgeCanonical_(payload) {
  const oldCodes = payload.old_codes && typeof payload.old_codes === 'object' && !Array.isArray(payload.old_codes) ? payload.old_codes : {};
  const oldPart = Object.keys(oldCodes).sort(function(a,b){
    const na=Number(a), nb=Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na-nb;
    return String(a).localeCompare(String(b));
  }).map(function(k){ return String(k) + '=' + String(oldCodes[k] || ''); }).join('&');
  return [String(payload.action || ''),String(payload.event_id || ''),String(payload.source_id || ''),String(payload.source_tab || ''),String(payload.change_type || ''),String(payload.row_start || ''),String(payload.row_end || ''),String(payload.col_start || ''),String(payload.col_end || ''),String(payload.at || ''),String(payload.sent_at || ''),oldPart].join('\n');
}

function staffSourceBridgeHmacHex_(payload, secret) {
  const bytes = Utilities.computeHmacSha256Signature(staffSourceBridgeCanonical_(payload), secret, Utilities.Charset.UTF_8);
  return bytes.map(function(b){ return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

function staffSourceBridgeSecureEq_(a, b) {
  a=String(a || ''); b=String(b || '');
  if (a.length !== b.length) return false;
  let diff=0;
  for (let i=0;i<a.length;i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function staffSourceBridgeVerifyGoogleSender_(oauthToken) {
  if (!oauthToken) throw new Error('STAFF_BRIDGE_OAUTH_REQUIRED');
  const res = UrlFetchApp.fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    method:'get',
    headers:{Authorization:'Bearer ' + oauthToken},
    muteHttpExceptions:true
  });
  let payload = {};
  try { payload = JSON.parse(res.getContentText() || '{}'); } catch (_) {}
  const email = String(payload.email || '').trim().toLowerCase();
  if (res.getResponseCode() !== 200 || email !== BH_STAFF_BRIDGE.SENDER_EMAIL) {
    throw new Error('STAFF_BRIDGE_SENDER_FORBIDDEN');
  }
  return email;
}

function staffSourceBridgeApplyRows_(body) {
  const rowStart = Math.max(2, Number(body.row_start || 0));
  const rowEnd = Math.max(rowStart, Number(body.row_end || rowStart));
  if (!Number.isFinite(rowStart) || !Number.isFinite(rowEnd) || rowEnd - rowStart + 1 > BH_STAFF_BRIDGE.MAX_DELTA_ROWS) {
    throw new Error('STAFF_BRIDGE_RANGE_INVALID');
  }

  const sheet = staffSourceBridgeSheet_();
  const values = sheet.getRange(rowStart, 1, rowEnd - rowStart + 1, 8).getDisplayValues();
  const oldCodes = body.old_codes && typeof body.old_codes === 'object' && !Array.isArray(body.old_codes) ? body.old_codes : {};
  const items = [];
  const candidateCodes = {};

  values.forEach(function(row, i) {
    const item = staffSourceBridgeParseRow_(row);
    if (item) {
      items.push(item);
      candidateCodes[item.employee_code.toLowerCase()] = true;
    }
    const oldCode = String(oldCodes[String(rowStart + i)] || '').trim();
    if (oldCode) candidateCodes[oldCode.toLowerCase()] = true;
  });

  const codes = Object.keys(candidateCodes);
  const token = workerAdminIdToken_();
  const profiles = codes.length ? (neonRpc_('worker_profiles_by_codes_rpc', {p_codes:codes}, token) || []) : [];
  const existing = {};
  profiles.forEach(function(p){ existing[String(p.employee_code || '').toLowerCase()] = p; });

  const activeNewCodes = {};
  items.forEach(function(item){ activeNewCodes[item.employee_code.toLowerCase()] = true; });

  let created = 0, updated = 0, deactivated = 0, unchanged = 0;
  items.forEach(function(item) {
    const outcome = staffSourceBridgeApplyItem_(item, existing[item.employee_code.toLowerCase()], token);
    if (outcome === 'CREATED') created++;
    else if (outcome === 'UPDATED') updated++;
    else unchanged++;
  });

  Object.keys(oldCodes).forEach(function(rowKey) {
    const oldCode = String(oldCodes[rowKey] || '').trim();
    if (!oldCode || activeNewCodes[oldCode.toLowerCase()]) return;
    const old = existing[oldCode.toLowerCase()];
    if (staffSourceBridgeDeactivateProfile_(old, token, 'STAFF_SOURCE_ROW_REPLACED')) deactivated++;
  });

  const changed = created + updated + deactivated;
  if (changed) staffSourceBridgeFlush_(token);
  return {changed:changed,created:created,updated:updated,deactivated:deactivated,unchanged:unchanged,rows:values.length};
}

function staffSourceBridgeReconcileStructure_(reason) {
  const source = staffSourceBridgeReadFullSource_();
  const token = workerAdminIdToken_();
  const profiles = neonRpc_('worker_profiles_snapshot_rpc', {}, token) || [];
  const existing = {};
  profiles.forEach(function(p){ existing[String(p.employee_code || '').toLowerCase()] = p; });

  let created = 0, updated = 0, deactivated = 0, unchanged = 0;
  const seen = {};
  source.forEach(function(item) {
    const key = item.employee_code.toLowerCase();
    seen[key] = true;
    const outcome = staffSourceBridgeApplyItem_(item, existing[key], token);
    if (outcome === 'CREATED') created++;
    else if (outcome === 'UPDATED') updated++;
    else unchanged++;
  });

  const activeSourceProfiles = profiles.filter(function(p) {
    return p && p.active === true && String(p.source_kind || '') === 'GSHEET' && !p.protected_account && String(p.role || '') !== 'ADMIN';
  });
  const missing = activeSourceProfiles.filter(function(p) {
    const code = String(p.employee_code || '').trim();
    return code && !seen[code.toLowerCase()];
  });
  const ratioLimit = Math.max(20, Math.ceil(activeSourceProfiles.length * BH_STAFF_BRIDGE.MAX_DEACTIVATE_RATIO));
  const deactivateLimit = Math.min(BH_STAFF_BRIDGE.MAX_DEACTIVATE_PER_EVENT, ratioLimit);
  if (missing.length > deactivateLimit) {
    throw new Error('STAFF_BRIDGE_MASS_DEACTIVATE_GUARD:' + missing.length + ':limit=' + deactivateLimit);
  }
  missing.forEach(function(p) {
    if (staffSourceBridgeDeactivateProfile_(p, token, 'STAFF_SOURCE_MISSING_' + String(reason || 'STRUCTURE').slice(0,40))) deactivated++;
  });

  const changed = created + updated + deactivated;
  if (changed) staffSourceBridgeFlush_(token);
  return {changed:changed,created:created,updated:updated,deactivated:deactivated,unchanged:unchanged,source_rows:source.length,reason:String(reason || '')};
}

function staffSourceBridgeApplyItem_(item, old, token) {
  if (item.employee_code === BH_PROTECTED_ADMIN_CODE) return 'UNCHANGED';
  if (old && (old.protected_account || String(old.role || '') === 'ADMIN')) throw new Error('STAFF_BRIDGE_PROTECTED_COLLISION:' + item.employee_code);

  const changed = !old ||
    String(old.full_name || '') !== item.full_name ||
    String(old.contractor || '') !== item.contractor ||
    String(old.role || '') !== item.role ||
    old.active !== true ||
    String(old.source_kind || '') !== 'GSHEET' ||
    String(old.source_position || '') !== item.source_position;
  if (!changed) return 'UNCHANGED';

  const uid = old ? String(old.id) : Utilities.getUuid();
  if (!old) {
    const password = requiredProp_('STAFF_DEFAULT_PASSWORD');
    firebaseAdminCreate_(uid, employeeEmail_(item.employee_code), password, item.full_name, false);
  }

  try {
    firebaseAdminUpdate_(uid, {
      email:employeeEmail_(item.employee_code),
      displayName:item.full_name,
      emailVerified:true,
      disableUser:false,
      customAttributes:claims_(item.employee_code, item.role)
    });
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
    if (!old) try { firebaseAdminDelete_(uid); } catch (_) {}
    throw error;
  }
  return old ? 'UPDATED' : 'CREATED';
}

function staffSourceBridgeDeactivateProfile_(profile, token, reason) {
  if (!profile || profile.active !== true || profile.protected_account || String(profile.role || '') === 'ADMIN' || String(profile.source_kind || '') !== 'GSHEET') return false;
  const uid = String(profile.id || '');
  if (!uid) return false;
  firebaseAdminUpdate_(uid, {disableUser:true});
  neonRpc_('worker_profile_deactivate_rpc', {p_id:uid,p_reason:String(reason || 'STAFF_SOURCE_MISSING').slice(0,80)}, token);
  return true;
}

function staffSourceBridgeParseRow_(row) {
  if (String(row[6] || '').trim() !== '1291' || String(row[7] || '').trim().toUpperCase() !== 'HY1') return null;
  const code = String(row[0] || '').trim();
  const name = String(row[1] || '').trim();
  if (!code || !name) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(code)) throw new Error('STAFF_BRIDGE_CODE_INVALID:' + code);
  const position = String(row[3] || '').trim();
  const contractor = String(row[4] || '').trim();
  const department = String(row[5] || '').trim();
  return {
    employee_code:code,
    full_name:name,
    source_position:position,
    contractor:contractor,
    department:department,
    role:staffSourceBridgeRole_(position, department, code)
  };
}

function staffSourceBridgeRole_(position, department, code) {
  if (String(code) === BH_PROTECTED_ADMIN_CODE) return 'ADMIN';
  return 'PICKER';
}

function staffSourceBridgeSheet_() {
  const source=staffSourceConfig_();
  const ss = SpreadsheetApp.openById(source.sheetId);
  if (ss.getId() !== source.sheetId) throw new Error('STAFF_BRIDGE_SHEET_ID_MISMATCH');
  const sheet = ss.getSheetByName(source.sheetName);
  if (!sheet) throw new Error('STAFF_BRIDGE_SHEET_MISSING');
  return sheet;
}

function staffSourceBridgeReadFullSource_() {
  const source=staffSourceConfig_();
  return readStaffSource_(source.sheetId, source.sheetName).staff;
}

function staffSourceBridgeFlush_(token) {
  // Only flush queues generated by the actual delta; do not run a full worker cycle.
  const sheetResult = drainSheet_(token);
  const realtimeResult = drainRealtime_(token);
  return {sheet:sheetResult,realtime:realtimeResult};
}

function staffSourceBridgeRemoveLegacyWatchers_() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    const h = String(t.getHandlerFunction() || '');
    if (h === 'staffSourceEditV2' || h === 'staffSourceChangeV2' || h === 'staffSourceEditV3' || h === 'staffSourceChangeV3' || h === 'staffEventRetryV33') {
      ScriptApp.deleteTrigger(t);
    }
  });
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('STAFF_EVENT_SYNC_V2_ENABLED');
  props.deleteProperty('STAFF_EVENT_SYNC_V3_ENABLED');
}

function getStaffSourceBridgeReceiverStatus() {
  const props = PropertiesService.getScriptProperties();
  const source=staffSourceConfig_();
  return {
    ok:true,
    mode:'SOURCE_DRIVEN_DELTA_V1',
    source_id:source.sheetId,
    source_tab:source.sheetName,
    last_ok:props.getProperty('LAST_STAFF_SOURCE_BRIDGE_OK') || '',
    last_error:props.getProperty('LAST_STAFF_SOURCE_BRIDGE_ERROR') || ''
  };
}
