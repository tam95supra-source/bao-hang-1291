/**
 * BÁO HÀNG 1291 — Apps Script authority/fallback contract (Target Final 2026-08-14).
 *
 * Required Script Properties (values MUST NOT be committed):
 * - WEBHOOK_SECRET                 server-to-server exporter/importer secret
 * - FALLBACK_TOKEN_SIGNING_SECRET  HMAC-SHA256 key used to verify 7-day fallback tokens
 * - TARGET_SPREADSHEET_ID          current private monthly workbook
 * - CURRENT_FOLDER_ID              BAO_HANG_1291/CURRENT
 * - ARCHIVE_FOLDER_ID              BAO_HANG_1291/ARCHIVE
 * - INDEX_SPREADSHEET_ID           private monthly index workbook (optional until cutover)
 *
 * The deployed Web App URL stays stable. Monthly rotation only changes TARGET_SPREADSHEET_ID.
 * No password, bearer token, service_role key or Firebase private key is stored in cells.
 */

const SCHEMA_VERSION = 'target-final-v1';
const MAX_EXPORT_BATCH = 500;
const MAX_PULL_BATCH = 500;
const REQUEST_CLOCK_SKEW_MS = 5 * 60 * 1000;
const REPLAY_RETENTION_MS = 15 * 60 * 1000;
const ACTIVE_STATUSES = new Set(['OPEN', 'CLAIMED']);
const OPS_ROLES = new Set(['INVENT', 'ADMIN_INVENT', 'ADMIN']);
const REASSIGN_ROLES = new Set(['ADMIN_INVENT', 'ADMIN']);

const HEADERS = {
  SU_KIEN: ['event_id','source_mode','event_type','occurred_at_device','accepted_at_authority','actor_account_id','actor_role','device_id','issue_id','sku','issue_version','payload_json','payload_sha256','service_ack_at','sheet_ack_at','reconciliation_status'],
  TRANG_THAI_SKU: ['issue_id','sku','product_name','status','report_count','first_reported_at','claimed_by_account_id','claimed_by_name','issue_version','updated_at','resolved_at','authority_mode'],
  NHAN_SU: ['account_id','employee_code','full_name','contractor','role','active','source_kind','source_position','protected_account','updated_at'],
  SKU_CATALOG: ['sku','product_name','active','catalog_revision','updated_at','source'],
  FALLBACK_EVENTS: ['sheet_sequence','event_id','source_mode','event_type','occurred_at_device','accepted_at_authority','actor_account_id','actor_role','device_id','issue_id','sku','issue_version','payload_json','payload_sha256','service_ack_at','sheet_ack_at','reconciliation_status'],
  FALLBACK_STATE: ['sku','issue_id','status','report_count','issue_version','claimed_by_account_id','updated_at','sheet_sequence','payload_sha256'],
  FALLBACK_ACK: ['event_id','sheet_sequence','accepted_at_sheet','service_ack_at','reconciliation_status','service_issue_id','error_code','error_detail'],
  BACKUP_ACCOUNTS_PRIVATE: ['account_id','username','display_name','role','device_scope','verifier_scheme','salt_b64','verifier_b64','status','expires_at','revoked_at','created_at','created_by_account_id','updated_at'],
  SYNC_CONTROL: ['key','value','updated_at','description'],
  THONG_TIN: ['key','value','description'],
  REPLAY_GUARD_PRIVATE: ['nonce_hash','account_id','device_id','accepted_at','expires_at'],
};

function setupBaoHang1291() {
  const book = workbook_();
  setupWorkbook_(book);
  seedInfo_(book);
  return `Báo hàng 1291 ${SCHEMA_VERSION} ready: ${book.getId()}`;
}

function doGet(e) {
  const mode = String((e && e.parameter && e.parameter.mode) || 'health').toLowerCase();
  if (mode !== 'health') return json_({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  try {
    const book = workbook_();
    return json_({ ok: true, project: 'BAO_HANG_1291', schema: SCHEMA_VERSION, sheet_id: book.getId(), sheet_mode: controlValue_(book, 'sheet_mode', 'UNKNOWN') });
  } catch (error) {
    return json_({ ok: false, error: 'SHEET_UNAVAILABLE' });
  }
}

function doPost(e) {
  try {
    const body = parseBody_(e);
    const mode = String(body.mode || 'export').trim().toLowerCase();
    if (mode === 'health') return doGet({ parameter: { mode: 'health' } });
    if (mode === 'export') return json_(handleExport_(body));
    if (mode === 'fallback_commit') return json_(handleFallbackCommit_(body));
    if (mode === 'fallback_query') return json_(handleFallbackQuery_(body));
    if (mode === 'fallback_pull') return json_(handleFallbackPull_(body));
    if (mode === 'fallback_ack') return json_(handleFallbackAck_(body));
    return json_({ ok: false, error: 'UNKNOWN_MODE' });
  } catch (error) {
    console.error(String(error).slice(0, 500));
    return json_({ ok: false, error: safeError_(error) });
  }
}

function handleExport_(body) {
  requireIntegrationSecret_(body);
  const events = Array.isArray(body.events) ? body.events.slice(0, MAX_EXPORT_BATCH) : [];
  if (!events.length) return { ok: true, processed: 0, ack_event_ids: [] };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new Error('LOCK_TIMEOUT');
  try {
    const book = workbook_();
    rotateMonthlyIfNeeded_(book);
    const current = workbook_();
    setupWorkbook_(current);
    const eventSheet = current.getSheetByName('SU_KIEN');
    const known = existingIdSet_(eventSheet, 1);
    const newRows = [];
    const ackIds = [];
    const normalized = [];
    events.forEach((raw) => {
      const event = normalizeServiceEvent_(raw);
      if (!event.event_id) return;
      ackIds.push(event.event_id);
      if (known.has(event.event_id)) return;
      known.add(event.event_id);
      newRows.push(serviceEventRow_(event));
      normalized.push(event);
    });
    if (newRows.length) appendRows_(eventSheet, newRows);
    applyServiceProjectionsBatch_(current, normalized);
    return { ok: true, processed: newRows.length, ack_event_ids: ackIds, schema: SCHEMA_VERSION };
  } finally {
    lock.releaseLock();
  }
}

function handleFallbackCommit_(body) {
  const auth = verifyFallbackRequest_(body);
  const event = normalizeFallbackEvent_(body.event || {}, auth);
  authorizeEvent_(event.event_type, auth.role);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('LOCK_TIMEOUT');
  try {
    const book = workbook_();
    setupWorkbook_(book);
    purgeReplayGuard_(book);
    acceptReplayGuard_(book, body.nonce, auth);
    const eventSheet = book.getSheetByName('FALLBACK_EVENTS');
    const existing = findRowByExact_(eventSheet, 2, event.event_id);
    if (existing > 0) {
      const row = eventSheet.getRange(existing, 1, 1, HEADERS.FALLBACK_EVENTS.length).getValues()[0];
      return { ok: true, idempotent: true, event_id: event.event_id, sheet_sequence: Number(row[0]), state: fallbackStateForSku_(book, String(row[10] || event.sku), auth) };
    }

    const sequence = nextSequence_(book);
    const acceptedAt = new Date().toISOString();
    const result = applyFallbackStateMachine_(book, event, auth, sequence, acceptedAt);
    const committed = Object.assign({}, event, {
      issue_id: result.issue_id,
      sku: result.sku,
      issue_version: result.issue_version,
      accepted_at_authority: acceptedAt,
      payload_json: canonicalJson_(Object.assign({}, event.payload_json, result.payload_patch || {})),
    });
    committed.payload_sha256 = sha256Hex_(committed.payload_json);
    appendRows_(eventSheet, [[
      sequence, committed.event_id, 'SHEET_FALLBACK', committed.event_type,
      committed.occurred_at_device, acceptedAt, auth.account_id, auth.role, auth.device_id,
      committed.issue_id, committed.sku, committed.issue_version, committed.payload_json,
      committed.payload_sha256, '', acceptedAt, 'SHEET_ACKED'
    ]]);
    return { ok: true, idempotent: false, authority: 'SHEET_FALLBACK', event_id: committed.event_id, sheet_sequence: sequence, state: result.public_state };
  } finally {
    lock.releaseLock();
  }
}

function handleFallbackQuery_(body) {
  const auth = verifyFallbackRequest_(body);
  const book = workbook_();
  const action = String(body.query || 'sku').toLowerCase();
  if (action === 'board') {
    if (!OPS_ROLES.has(auth.role)) throw new Error('FORBIDDEN');
    const rows = tableObjects_(book.getSheetByName('FALLBACK_STATE'));
    return { ok: true, authority: 'SHEET_FALLBACK', states: rows.filter((row) => ACTIVE_STATUSES.has(String(row.status))) };
  }
  if (action === 'my') {
    const events = tableObjects_(book.getSheetByName('FALLBACK_EVENTS'));
    const skuSet = new Set(events.filter((row) => String(row.event_type) === 'REPORT_SHORTAGE' && String(row.actor_account_id) === auth.account_id).map((row) => String(row.sku)));
    return { ok: true, authority: 'SHEET_FALLBACK', states: Array.from(skuSet).map((sku) => fallbackStateForSku_(book, sku, auth)).filter(Boolean) };
  }
  const sku = normalizeSku_(body.sku);
  return { ok: true, authority: 'SHEET_FALLBACK', state: fallbackStateForSku_(book, sku, auth) };
}

function handleFallbackPull_(body) {
  requireIntegrationSecret_(body);
  const after = Math.max(0, Number(body.after_sequence || 0));
  const limit = Math.max(1, Math.min(MAX_PULL_BATCH, Number(body.limit || MAX_PULL_BATCH)));
  const rows = tableObjects_(workbook_().getSheetByName('FALLBACK_EVENTS'))
    .filter((row) => Number(row.sheet_sequence || 0) > after)
    .sort((a, b) => Number(a.sheet_sequence) - Number(b.sheet_sequence))
    .slice(0, limit);
  return { ok: true, schema: SCHEMA_VERSION, events: rows, next_sequence: rows.length ? Number(rows[rows.length - 1].sheet_sequence) : after };
}

function handleFallbackAck_(body) {
  requireIntegrationSecret_(body);
  const acks = Array.isArray(body.acks) ? body.acks.slice(0, MAX_PULL_BATCH) : [];
  if (!acks.length) return { ok: true, acknowledged: 0 };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('LOCK_TIMEOUT');
  try {
    const sheet = workbook_().getSheetByName('FALLBACK_ACK');
    const known = existingIdSet_(sheet, 1);
    const rows = [];
    acks.forEach((ack) => {
      const eventId = String(ack.event_id || '').trim();
      if (!eventId || known.has(eventId)) return;
      known.add(eventId);
      rows.push([
        eventId, Number(ack.sheet_sequence || 0), String(ack.accepted_at_sheet || ''),
        String(ack.service_ack_at || new Date().toISOString()), String(ack.reconciliation_status || 'SERVICE_ACKED'),
        String(ack.service_issue_id || ''), String(ack.error_code || ''), String(ack.error_detail || '').slice(0, 1000)
      ]);
    });
    appendRows_(sheet, rows);
    return { ok: true, acknowledged: rows.length };
  } finally {
    lock.releaseLock();
  }
}

function applyFallbackStateMachine_(book, event, auth, sequence, acceptedAt) {
  const sheet = book.getSheetByName('FALLBACK_STATE');
  const sku = normalizeSku_(event.sku || event.payload_json.sku);
  if (!sku) throw new Error('SKU_REQUIRED');
  const catalog = catalogItem_(book, sku);
  if (event.event_type === 'REPORT_SHORTAGE' && !catalog) throw new Error('SKU_NOT_FOUND');
  const foundRow = findRowByExact_(sheet, 1, sku);
  const current = foundRow > 0 ? stateFromRow_(sheet.getRange(foundRow, 1, 1, HEADERS.FALLBACK_STATE.length).getValues()[0]) : null;
  let next = current ? Object.assign({}, current) : null;

  if (event.event_type === 'REPORT_SHORTAGE') {
    if (next && ACTIVE_STATUSES.has(next.status)) {
      next.report_count += 1;
    } else {
      next = { sku, issue_id: String(event.issue_id || event.payload_json.issue_id || Utilities.getUuid()), status: 'OPEN', report_count: 1, issue_version: 1, claimed_by_account_id: '', updated_at: acceptedAt, sheet_sequence: sequence, payload_sha256: '' };
    }
  } else {
    if (!next || !ACTIVE_STATUSES.has(next.status)) throw new Error('NO_ACTIVE_ISSUE');
    if (event.issue_id && String(event.issue_id) !== next.issue_id) throw new Error('ISSUE_CONFLICT');
    if (event.event_type === 'CLAIM') {
      if (next.status === 'CLAIMED' && next.claimed_by_account_id && next.claimed_by_account_id !== auth.account_id) throw new Error(`CLAIM_CONFLICT:${next.claimed_by_account_id}`);
      if (next.status === 'OPEN') {
        next.status = 'CLAIMED';
        next.claimed_by_account_id = auth.account_id;
        next.issue_version += 1;
      }
    } else if (event.event_type === 'AVAILABLE' || event.event_type === 'SKIP_ALLOWED') {
      next.status = event.event_type;
      next.issue_version += 1;
    } else if (event.event_type === 'REASSIGN') {
      const newAssignee = String(event.payload_json.new_assignee_account_id || '').trim();
      const reason = String(event.payload_json.reason || '').trim();
      if (!newAssignee || !reason) throw new Error('REASSIGN_REQUIRES_ASSIGNEE_AND_REASON');
      next.status = 'CLAIMED';
      next.claimed_by_account_id = newAssignee;
      next.issue_version += 1;
    } else {
      throw new Error('UNSUPPORTED_FALLBACK_EVENT');
    }
  }

  next.updated_at = acceptedAt;
  next.sheet_sequence = sequence;
  next.payload_sha256 = sha256Hex_(canonicalJson_({ sku: next.sku, issue_id: next.issue_id, status: next.status, report_count: next.report_count, issue_version: next.issue_version, claimed_by_account_id: next.claimed_by_account_id, updated_at: next.updated_at, sheet_sequence: next.sheet_sequence }));
  writeState_(sheet, foundRow, next);
  const publicState = sanitizeState_(next, auth.role);
  return { issue_id: next.issue_id, sku: next.sku, issue_version: next.issue_version, public_state: publicState, payload_patch: { resulting_status: next.status } };
}

function authorizeEvent_(type, role) {
  const eventType = String(type || '').toUpperCase();
  if (eventType === 'REPORT_SHORTAGE') {
    if (!['PICKER','ADMIN'].includes(role)) throw new Error('FORBIDDEN');
    return;
  }
  if (['CLAIM','AVAILABLE','SKIP_ALLOWED'].includes(eventType)) {
    if (!OPS_ROLES.has(role)) throw new Error('FORBIDDEN');
    return;
  }
  if (eventType === 'REASSIGN') {
    if (!REASSIGN_ROLES.has(role)) throw new Error('FORBIDDEN');
    return;
  }
  throw new Error('UNSUPPORTED_FALLBACK_EVENT');
}

function verifyFallbackRequest_(body) {
  const token = String(body.fallback_token || '').trim();
  const timestamp = Number(body.timestamp_ms || 0);
  const nonce = String(body.nonce || '').trim();
  const deviceId = String(body.device_id || '').trim();
  if (!token || !timestamp || !nonce || !deviceId) throw new Error('AUTH_REQUIRED');
  if (Math.abs(Date.now() - timestamp) > REQUEST_CLOCK_SKEW_MS) throw new Error('REQUEST_EXPIRED');
  if (nonce.length < 16 || nonce.length > 200) throw new Error('INVALID_NONCE');

  const parts = token.split('.');
  if (parts.length !== 2) throw new Error('INVALID_TOKEN');
  const signingSecret = String(PropertiesService.getScriptProperties().getProperty('FALLBACK_TOKEN_SIGNING_SECRET') || '');
  if (signingSecret.length < 32) throw new Error('FALLBACK_AUTH_NOT_CONFIGURED');
  const expected = base64UrlBytes_(Utilities.computeHmacSha256Signature(parts[0], signingSecret));
  if (!constantEqual_(expected, parts[1])) throw new Error('INVALID_TOKEN');
  const payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString('UTF-8'));
  const accountId = String(payload.account_id || '').trim();
  const role = String(payload.role || '').trim().toUpperCase();
  const tokenDevice = String(payload.device_id || '').trim();
  const exp = Number(payload.exp || 0);
  if (!accountId || !['PICKER','INVENT','ADMIN_INVENT','ADMIN'].includes(role) || tokenDevice !== deviceId || exp * 1000 <= Date.now()) throw new Error('TOKEN_EXPIRED_OR_INVALID');
  if (isAccountRevoked_(workbook_(), accountId, Number(payload.iat || 0))) throw new Error('ACCOUNT_REVOKED');
  if (String(payload.kind || 'SERVICE_FALLBACK') === 'BACKUP') validateBackupAccount_(workbook_(), accountId, deviceId, role);
  return { account_id: accountId, role, device_id: deviceId, token_id: String(payload.jti || '') };
}

function normalizeFallbackEvent_(raw, auth) {
  const type = String(raw.event_type || '').trim().toUpperCase();
  const eventId = String(raw.event_id || raw.client_request_id || '').trim();
  if (!eventId || eventId.length > 100) throw new Error('EVENT_ID_REQUIRED');
  const payload = typeof raw.payload_json === 'object' && raw.payload_json !== null ? raw.payload_json : {};
  return {
    event_id: eventId,
    source_mode: 'SHEET_FALLBACK',
    event_type: type,
    occurred_at_device: String(raw.occurred_at_device || new Date().toISOString()),
    actor_account_id: auth.account_id,
    actor_role: auth.role,
    device_id: auth.device_id,
    issue_id: String(raw.issue_id || payload.issue_id || '').trim(),
    sku: normalizeSku_(raw.sku || payload.sku),
    issue_version: Number(raw.issue_version || payload.issue_version || 0),
    payload_json: payload,
  };
}

function normalizeServiceEvent_(raw) {
  const payload = raw && typeof raw.payload === 'object' && raw.payload !== null ? raw.payload : {};
  const payloadJson = canonicalJson_(payload);
  return {
    event_id: String(raw.event_id || raw.id || '').trim(),
    source_mode: String(raw.source_mode || 'SERVICE'),
    event_type: String(raw.event_type || ''),
    occurred_at_device: String(raw.occurred_at_device || raw.created_at || ''),
    accepted_at_authority: String(raw.accepted_at_authority || raw.created_at || ''),
    actor_account_id: String(raw.actor_account_id || payload.actor_id || payload.reporter_id || ''),
    actor_role: String(raw.actor_role || ''),
    device_id: String(raw.device_id || ''),
    issue_id: String(raw.issue_id || payload.id || ''),
    sku: normalizeSku_(raw.sku || payload.sku),
    issue_version: Number(raw.issue_version || payload.issue_version || 0),
    payload_json: payloadJson,
    payload_sha256: String(raw.payload_sha256 || sha256Hex_(payloadJson)),
    service_ack_at: String(raw.service_ack_at || raw.created_at || ''),
    sheet_ack_at: new Date().toISOString(),
    reconciliation_status: 'SHEET_ACKED',
    payload,
  };
}

function serviceEventRow_(e) {
  return [e.event_id,e.source_mode,e.event_type,e.occurred_at_device,e.accepted_at_authority,e.actor_account_id,e.actor_role,e.device_id,e.issue_id,e.sku,e.issue_version,e.payload_json,e.payload_sha256,e.service_ack_at,e.sheet_ack_at,e.reconciliation_status];
}

function applyServiceProjectionsBatch_(book, events) {
  if (!events.length) return;
  const issues = loadTable_(book.getSheetByName('TRANG_THAI_SKU'));
  const users = loadTable_(book.getSheetByName('NHAN_SU'));
  const catalog = loadTable_(book.getSheetByName('SKU_CATALOG'));
  let issueDirty = false, userDirty = false, catalogDirty = false;
  events.forEach((event) => {
    const p = event.payload || {};
    if (event.event_type === 'USER_UPSERT' && p.employee_code) {
      upsertObject_(users, 'account_id', String(p.id || event.actor_account_id || p.employee_code), {
        account_id: String(p.id || ''), employee_code: String(p.employee_code || ''), full_name: String(p.full_name || ''), contractor: String(p.contractor || ''),
        role: String(p.role || ''), active: Boolean(p.active), source_kind: String(p.source_kind || ''), source_position: String(p.source_position || ''), protected_account: Boolean(p.protected_account), updated_at: String(p.updated_at || event.accepted_at_authority)
      }); userDirty = true; return;
    }
    if ((event.event_type === 'SKU_UPSERT' || event.event_type === 'CATALOG_UPSERT') && (p.sku || event.sku)) {
      const sku = normalizeSku_(p.sku || event.sku);
      upsertObject_(catalog, 'sku', sku, { sku, product_name: String(p.product_name || ''), active: p.active !== false, catalog_revision: Number(p.catalog_revision || 0), updated_at: String(p.updated_at || event.accepted_at_authority), source: 'SERVICE' });
      catalogDirty = true; return;
    }
    if (event.issue_id && event.sku) {
      upsertObject_(issues, 'issue_id', event.issue_id, {
        issue_id: event.issue_id, sku: event.sku, product_name: String(p.product_name || ''), status: String(p.status || ''), report_count: Number(p.report_count || 1),
        first_reported_at: String(p.reported_at || p.first_reported_at || event.accepted_at_authority), claimed_by_account_id: String(p.assigned_id || p.claimed_by || ''), claimed_by_name: String(p.assigned_name || ''),
        issue_version: Number(p.issue_version || event.issue_version || 1), updated_at: String(p.updated_at || event.accepted_at_authority), resolved_at: String(p.resolved_at || ''), authority_mode: 'SERVICE'
      }); issueDirty = true;
    }
  });
  if (issueDirty) writeTable_(book.getSheetByName('TRANG_THAI_SKU'), issues);
  if (userDirty) writeTable_(book.getSheetByName('NHAN_SU'), users);
  if (catalogDirty) writeTable_(book.getSheetByName('SKU_CATALOG'), catalog);
}

function fallbackStateForSku_(book, sku, auth) {
  const row = findRowByExact_(book.getSheetByName('FALLBACK_STATE'), 1, normalizeSku_(sku));
  if (row < 1) return null;
  const state = stateFromRow_(book.getSheetByName('FALLBACK_STATE').getRange(row,1,1,HEADERS.FALLBACK_STATE.length).getValues()[0]);
  return sanitizeState_(state, auth.role);
}

function sanitizeState_(state, role) {
  if (role === 'PICKER') return { sku: state.sku, issue_id: state.issue_id, status: state.status, issue_version: state.issue_version, updated_at: state.updated_at };
  return state;
}

function stateFromRow_(row) {
  return { sku:String(row[0]||''), issue_id:String(row[1]||''), status:String(row[2]||''), report_count:Number(row[3]||0), issue_version:Number(row[4]||1), claimed_by_account_id:String(row[5]||''), updated_at:String(row[6]||''), sheet_sequence:Number(row[7]||0), payload_sha256:String(row[8]||'') };
}

function writeState_(sheet, rowNumber, state) {
  const row = [[state.sku,state.issue_id,state.status,state.report_count,state.issue_version,state.claimed_by_account_id,state.updated_at,state.sheet_sequence,state.payload_sha256]];
  if (rowNumber > 0) sheet.getRange(rowNumber,1,1,row[0].length).setValues(row);
  else appendRows_(sheet,row);
}

function catalogItem_(book, sku) {
  const sheet = book.getSheetByName('SKU_CATALOG');
  const row = findRowByExact_(sheet,1,sku);
  if (row < 1) return null;
  const values = sheet.getRange(row,1,1,HEADERS.SKU_CATALOG.length).getValues()[0];
  return values[2] === false ? null : { sku:String(values[0]), product_name:String(values[1]||'') };
}

function setupWorkbook_(book) {
  Object.keys(HEADERS).forEach((name) => {
    const hidden = name === 'BACKUP_ACCOUNTS_PRIVATE' || name === 'REPLAY_GUARD_PRIVATE';
    const sheet = ensureSheet_(book,name,HEADERS[name]);
    if (hidden) sheet.hideSheet();
  });
}

function ensureSheet_(book, name, headers) {
  let sheet = book.getSheetByName(name);
  if (!sheet) sheet = book.insertSheet(name);
  if (sheet.getMaxColumns() < headers.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  const current = sheet.getRange(1,1,1,headers.length).getValues()[0];
  if (current.join('|') !== headers.join('|')) sheet.getRange(1,1,1,headers.length).setValues([headers]);
  sheet.getRange(1,1,1,headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  return sheet;
}

function seedInfo_(book) {
  upsertControl_(book,'schema_version',SCHEMA_VERSION,'Contract version');
  upsertControl_(book,'sheet_mode',controlValue_(book,'sheet_mode','STANDBY_PRE_CUTOVER'),'Switch to ACTIVE only after fallback endpoint verification');
  upsertControl_(book,'fallback_sequence',controlValue_(book,'fallback_sequence','0'),'Monotonic Sheet sequence');
  const info = book.getSheetByName('THONG_TIN');
  const rows = [
    ['PROJECT','BÁO HÀNG 1291','Dedicated project only'],['TARGET','2026-08-14','Target Final'],['TIMEZONE','Asia/Bangkok','UTC+7'],
    ['NORMAL_AUTHORITY','SUPABASE','Postgres transaction/RPC'],['FALLBACK_AUTHORITY','GOOGLE_SHEET','Apps Script journal + projection'],['EMERGENCY_AUTHORITY','FIREBASE_FIRESTORE','Only when Supabase + Sheet fail'],
    ['NO_CLOUD_RULE','BLOCK_MUTATION','Never queue a new shortage mutation without authority confirmation'],['SERVICE_RETENTION_DAYS','45','Terminal + safely ACKed only'],['PICKER_VISIBILITY','OWN_REPORTS_ONLY','Never expose report_count']
  ];
  const objects = rows.map((r) => ({ key:r[0], value:r[1], description:r[2] }));
  writeTable_(info, objects);
}

function workbook_() {
  const id = String(PropertiesService.getScriptProperties().getProperty('TARGET_SPREADSHEET_ID') || '').trim();
  if (id) return SpreadsheetApp.openById(id);
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) throw new Error('TARGET_SPREADSHEET_ID_NOT_CONFIGURED');
  return active;
}

function rotateMonthlyIfNeeded_(book) {
  const tz = 'Asia/Bangkok';
  const month = Utilities.formatDate(new Date(),tz,'yyyy-MM');
  const configured = controlValue_(book,'active_month','');
  if (!configured || configured === month) { if (!configured) upsertControl_(book,'active_month',month,'Current monthly file'); return false; }
  const props = PropertiesService.getScriptProperties();
  const currentFolderId = String(props.getProperty('CURRENT_FOLDER_ID') || '');
  const archiveFolderId = String(props.getProperty('ARCHIVE_FOLDER_ID') || '');
  if (!currentFolderId || !archiveFolderId) throw new Error('ROTATION_FOLDERS_NOT_CONFIGURED');

  const newBook = SpreadsheetApp.create(`Báo hàng 1291 - CURRENT ${month}`);
  setupWorkbook_(newBook); seedInfo_(newBook); upsertControl_(newBook,'active_month',month,'Current monthly file'); upsertControl_(newBook,'sheet_mode','ACTIVE','Monthly rotation activated');
  DriveApp.getFileById(newBook.getId()).moveTo(DriveApp.getFolderById(currentFolderId));
  const year = configured.slice(0,4);
  const yearFolder = childFolder_(DriveApp.getFolderById(archiveFolderId),year);
  const monthFolder = childFolder_(yearFolder,configured);
  DriveApp.getFileById(book.getId()).moveTo(monthFolder);
  updateIndex_(book,configured,'ARCHIVED');
  props.setProperty('TARGET_SPREADSHEET_ID',newBook.getId());
  updateIndex_(newBook,month,'CURRENT');
  return true;
}

function updateIndex_(book, month, status) {
  const id = String(PropertiesService.getScriptProperties().getProperty('INDEX_SPREADSHEET_ID') || '');
  if (!id) return;
  const indexBook = SpreadsheetApp.openById(id);
  const headers = ['file_id','month','min_event_sequence','max_event_sequence','row_count','checksum','status','updated_at'];
  const sheet = ensureSheet_(indexBook,'INDEX',headers);
  const fallback = book.getSheetByName('FALLBACK_EVENTS');
  const rows = Math.max(0,fallback.getLastRow()-1);
  let minSeq = '', maxSeq = '';
  if (rows) { const seqs = fallback.getRange(2,1,rows,1).getValues().flat().map(Number).filter(Number.isFinite); if (seqs.length) { minSeq=Math.min.apply(null,seqs); maxSeq=Math.max.apply(null,seqs); } }
  const checksum = sha256Hex_(canonicalJson_({ file_id:book.getId(),month,rows,minSeq,maxSeq }));
  const row = findRowByExact_(sheet,1,book.getId());
  const values = [[book.getId(),month,minSeq,maxSeq,rows,checksum,status,new Date().toISOString()]];
  if (row > 0) sheet.getRange(row,1,1,headers.length).setValues(values); else appendRows_(sheet,values);
}

function childFolder_(parent,name) { const iter=parent.getFoldersByName(name); return iter.hasNext()?iter.next():parent.createFolder(name); }

function nextSequence_(book) {
  const current = Number(controlValue_(book,'fallback_sequence','0')) || 0;
  const next = current + 1;
  upsertControl_(book,'fallback_sequence',String(next),'Monotonic Sheet authority sequence');
  return next;
}

function upsertControl_(book,key,value,description) {
  const sheet=book.getSheetByName('SYNC_CONTROL'); const row=findRowByExact_(sheet,1,key); const values=[[key,String(value),new Date().toISOString(),description||'']];
  if(row>0)sheet.getRange(row,1,1,4).setValues(values);else appendRows_(sheet,values);
}
function controlValue_(book,key,fallback) { const sheet=book.getSheetByName('SYNC_CONTROL'); if(!sheet)return fallback; const row=findRowByExact_(sheet,1,key); return row>0?String(sheet.getRange(row,2).getValue()||fallback):fallback; }

function acceptReplayGuard_(book, nonce, auth) {
  const nonceHash=sha256Hex_(String(nonce)); const sheet=book.getSheetByName('REPLAY_GUARD_PRIVATE'); if(findRowByExact_(sheet,1,nonceHash)>0)throw new Error('REPLAY_DETECTED');
  appendRows_(sheet,[[nonceHash,auth.account_id,auth.device_id,new Date().toISOString(),new Date(Date.now()+REPLAY_RETENTION_MS).toISOString()]]);
}
function purgeReplayGuard_(book) { const sheet=book.getSheetByName('REPLAY_GUARD_PRIVATE'); const objects=tableObjects_(sheet).filter((row)=>new Date(String(row.expires_at||0)).getTime()>Date.now()); writeTable_(sheet,objects); }

function isAccountRevoked_(book, accountId, tokenIat) {
  const key=`revoked:${accountId}`; const value=controlValue_(book,key,''); if(!value)return false; const revokedAt=Math.floor(new Date(value).getTime()/1000); return !tokenIat || tokenIat<=revokedAt;
}
function validateBackupAccount_(book,accountId,deviceId,role) {
  const sheet=book.getSheetByName('BACKUP_ACCOUNTS_PRIVATE'); const row=findRowByExact_(sheet,1,accountId); if(row<1)throw new Error('BACKUP_ACCOUNT_NOT_PROVISIONED');
  const values=sheet.getRange(row,1,1,HEADERS.BACKUP_ACCOUNTS_PRIVATE.length).getValues()[0]; const status=String(values[8]||'').toUpperCase(); const expires=values[9]?new Date(values[9]).getTime():Infinity;
  if(status!=='ACTIVE'||expires<=Date.now()||String(values[3]||'').toUpperCase()!==role)throw new Error('BACKUP_ACCOUNT_INACTIVE');
  const scope=String(values[4]||'').trim(); if(scope&&scope!=='*'&&scope!==deviceId)throw new Error('DEVICE_NOT_ALLOWED');
}

function requireIntegrationSecret_(body) { const expected=String(PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET')||''); if(!expected||!constantEqual_(String(body.secret||''),expected))throw new Error('UNAUTHORIZED'); }
function parseBody_(e) { if(!e||!e.postData)return {}; const raw=String(e.postData.contents||''); if(raw.length>2_000_000)throw new Error('REQUEST_TOO_LARGE'); return raw?JSON.parse(raw):{}; }
function normalizeSku_(value) { return String(value||'').trim().toUpperCase(); }
function safeError_(error) { const text=String(error instanceof Error?error.message:error||'ERROR'); return text.replace(/Bearer\s+[A-Za-z0-9._-]+/gi,'Bearer [REDACTED]').slice(0,300); }
function canonicalJson_(value) { return JSON.stringify(sortObject_(value)); }
function sortObject_(value) { if(Array.isArray(value))return value.map(sortObject_); if(value&&typeof value==='object'){const out={};Object.keys(value).sort().forEach((key)=>{out[key]=sortObject_(value[key]);});return out;} return value; }
function sha256Hex_(value) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(value),Utilities.Charset.UTF_8).map((b)=>(b<0?b+256:b).toString(16).padStart(2,'0')).join(''); }
function base64UrlBytes_(bytes) { return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/,''); }
function constantEqual_(a,b) { a=String(a);b=String(b);let diff=a.length^b.length;const len=Math.max(a.length,b.length);for(let i=0;i<len;i++)diff|=(a.charCodeAt(i%Math.max(1,a.length))||0)^(b.charCodeAt(i%Math.max(1,b.length))||0);return diff===0; }

function existingIdSet_(sheet,column) { const last=sheet.getLastRow(); if(last<2)return new Set(); return new Set(sheet.getRange(2,column,last-1,1).getDisplayValues().flat().filter(Boolean)); }
function findRowByExact_(sheet,column,key) { if(!sheet||!key||sheet.getLastRow()<2)return -1; const match=sheet.getRange(2,column,sheet.getLastRow()-1,1).createTextFinder(String(key)).matchEntireCell(true).findNext(); return match?match.getRow():-1; }
function appendRows_(sheet,rows) { if(!rows||!rows.length)return; sheet.getRange(sheet.getLastRow()+1,1,rows.length,rows[0].length).setValues(rows); }
function tableObjects_(sheet) { if(!sheet||sheet.getLastRow()<2)return []; const headers=sheet.getRange(1,1,1,sheet.getLastColumn()).getDisplayValues()[0]; return sheet.getRange(2,1,sheet.getLastRow()-1,headers.length).getValues().map((row)=>{const o={};headers.forEach((h,i)=>o[h]=row[i]);return o;}); }
function loadTable_(sheet) { return tableObjects_(sheet); }
function writeTable_(sheet,objects) { const headers=sheet.getRange(1,1,1,sheet.getLastColumn()).getDisplayValues()[0]; if(sheet.getLastRow()>1)sheet.getRange(2,1,sheet.getLastRow()-1,headers.length).clearContent(); if(!objects||!objects.length)return; sheet.getRange(2,1,objects.length,headers.length).setValues(objects.map((o)=>headers.map((h)=>o[h]===undefined?'':o[h]))); }
function upsertObject_(objects,keyName,key,value) { const index=objects.findIndex((o)=>String(o[keyName])===String(key)); if(index>=0)objects[index]=Object.assign({},objects[index],value); else objects.push(value); }
function json_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
