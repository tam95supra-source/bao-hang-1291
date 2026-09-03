const DB_NAME = 'bao-hang-1291-web-diagnostics';
const STORE = 'events';
const MAX_EVENTS = 300;
const MAX_AUTO_BATCH = 160;
const MAX_MANUAL_EVENTS = 220;
const MAX_SESSION_HISTORY = 240;
const AUTO_FLUSH_INTERVAL_MS = 60 * 60 * 1000;
const AUTO_FILE_MIN_INTERVAL_MS = 30 * 60 * 1000;
const ERROR_FLUSH_DEBOUNCE_MS = 10 * 1000;
const DEDUPE_WINDOW_MS = 2 * 60 * 1000;
const SLOW_REQUEST_MS = 8000;
const WORKER_URL = (globalThis.__BAO_HANG_WORKER_URL__ || '').trim();
const SESSION_ID_KEY = 'bao-hang-1291-web-log-session-id';

let dbPromise;
let flushTimer;
let urgentFlushTimer;
let flushInFlight;
let lastSuccessfulAutoFlushAt = 0;
let installed = false;
let baseFetch;
let fallbackQueue = [];
const sessionHistory = [];
const recentSignatures = new Map();

let sessionId = sessionStorage.getItem(SESSION_ID_KEY);
if (!sessionId) {
  sessionId = crypto.randomUUID();
  sessionStorage.setItem(SESSION_ID_KEY, sessionId);
}

function redact(value) {
  if (value == null) return value;
  if (typeof value === 'string') {
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
      .replace(/"?(access_token|refresh_token|id_token|password|private_key|client_secret)"?\s*[:=]\s*"[^"]*"/gi, '"$1":"[REDACTED]"')
      .slice(0, 1800);
  }
  if (Array.isArray(value)) return value.slice(0, 30).map(redact);
  if (typeof value === 'object') {
    const out = {};
    for (const [k,v] of Object.entries(value).slice(0, 60)) {
      out[k] = /token|password|secret|private.?key|authorization/i.test(k) ? '[REDACTED]' : redact(v);
    }
    return out;
  }
  return value;
}

function pageContext() {
  const s = globalThis.__BH_AUTH__?.getSession?.();
  return {
    session_id: sessionId,
    route: location.hash || '#/',
    path: location.pathname,
    online: navigator.onLine,
    visibility: document.visibilityState,
    user_agent: navigator.userAgent.slice(0, 400),
    viewport: { width: innerWidth, height: innerHeight },
    language: document.documentElement.lang || 'vi',
    employee_code: s?.profile?.employee_code || '',
    role: s?.profile?.role || '',
  };
}

function eventSignature(item) {
  const d = item.detail || {};
  return [item.level,item.type,item.message,d.host || '',d.path || '',d.status || ''].join('|').slice(0,700);
}

function rememberHistory(item) {
  sessionHistory.push(item);
  if (sessionHistory.length > MAX_SESSION_HISTORY) sessionHistory.splice(0, sessionHistory.length - MAX_SESSION_HISTORY);
}

function duplicateRecently(item) {
  const now = Date.now();
  const sig = eventSignature(item);
  const last = recentSignatures.get(sig) || 0;
  recentSignatures.set(sig, now);
  if (recentSignatures.size > 250) {
    for (const [key,ts] of recentSignatures) if (now - ts > DEDUPE_WINDOW_MS * 3) recentSignatures.delete(key);
  }
  return now - last < DEDUPE_WINDOW_MS;
}

function openDb() {
  if (!('indexedDB' in globalThis)) return Promise.resolve(null);
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath:'id', autoIncrement:true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch(() => null);
  return dbPromise;
}

async function addEvent(event, options = {}) {
  const item = {
    ts: new Date().toISOString(),
    level: event.level || 'info',
    type: event.type || 'event',
    message: redact(event.message || ''),
    detail: redact(event.detail || {}),
    ...pageContext(),
  };
  rememberHistory(item);
  if (!options.allowDuplicate && duplicateRecently(item)) return;

  const db = await openDb();
  if (!db) {
    fallbackQueue.push(item);
    if (fallbackQueue.length > MAX_EVENTS) fallbackQueue = fallbackQueue.slice(-MAX_EVENTS);
  } else {
    await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).add(item);
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
    void trimDb();
  }
  if (item.level === 'error') scheduleUrgentFlush();
}

async function trimDb() {
  const db = await openDb();
  if (!db) return;
  const rows = await readBatch(MAX_EVENTS + 80);
  if (rows.length <= MAX_EVENTS) return;
  await deleteIds(rows.slice(0, rows.length - MAX_EVENTS).map(x => x.id));
}

async function readBatch(limit = MAX_AUTO_BATCH) {
  const db = await openDb();
  if (!db) return fallbackQueue.slice(0, limit).map((event,index) => ({ id:'fallback:'+index, ...event }));
  return new Promise((resolve) => {
    const out = [];
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur || out.length >= limit) return resolve(out);
      out.push({ id:cur.key, ...cur.value });
      cur.continue();
    };
    req.onerror = () => resolve(out);
  });
}

async function deleteIds(ids) {
  if (!ids.length) return;
  const db = await openDb();
  if (!db) {
    const count = ids.filter(id => String(id).startsWith('fallback:')).length;
    if (count) fallbackQueue.splice(0, count);
    return;
  }
  await new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    ids.forEach(id => store.delete(id));
    tx.oncomplete = resolve;
    tx.onerror = resolve;
  });
}

async function sendEvents(events, mode = 'auto') {
  if (!WORKER_URL) throw new Error('Chưa cấu hình nơi lưu log Google Drive.');
  if (!navigator.onLine) throw new Error('Đang mất mạng nên chưa thể tạo file log.');
  const auth = globalThis.__BH_AUTH__?.getSession?.();
  if (!auth?.access_token) throw new Error('Cần đăng nhập trước khi tạo file log.');
  const fetcher = baseFetch || globalThis.fetch.bind(globalThis);
  const response = await fetcher(WORKER_URL, {
    method:'POST',
    headers:{'content-type':'text/plain;charset=UTF-8'},
    body:JSON.stringify({
      action:'upload-web-log',
      id_token:auth.access_token,
      session_id:sessionId,
      mode,
      events,
    }),
    keepalive:false,
  });
  const text = await response.text();
  let result = null;
  try { result = text ? JSON.parse(text) : {}; } catch {
    throw new Error('Dịch vụ Google trả phản hồi không đúng định dạng. Không lưu nội dung lỗi HTML vào log.');
  }
  if (!response.ok || result?.ok !== true) {
    throw new Error(String(result?.message || result?.error || 'Không thể lưu file log lên Google Drive.').slice(0,300));
  }
  return result;
}

function scheduleUrgentFlush() {
  if (urgentFlushTimer) return;
  const elapsed = Date.now() - lastSuccessfulAutoFlushAt;
  const wait = lastSuccessfulAutoFlushAt ? Math.max(ERROR_FLUSH_DEBOUNCE_MS, AUTO_FILE_MIN_INTERVAL_MS - elapsed) : ERROR_FLUSH_DEBOUNCE_MS;
  urgentFlushTimer = setTimeout(() => {
    urgentFlushTimer = null;
    void flushWebLogs();
  }, wait);
}

async function flushOnce() {
  if (!navigator.onLine) return null;
  const elapsed = Date.now() - lastSuccessfulAutoFlushAt;
  if (lastSuccessfulAutoFlushAt && elapsed < AUTO_FILE_MIN_INTERVAL_MS) return null;
  const rows = await readBatch(MAX_AUTO_BATCH);
  if (!rows.length) return null;
  const events = rows.map(({id, ...event}) => event);
  const result = await sendEvents(events, 'auto');
  await deleteIds(rows.map(x => x.id));
  lastSuccessfulAutoFlushAt = Date.now();
  return result;
}

export async function flushWebLogs() {
  if (flushInFlight) return flushInFlight;
  flushInFlight = flushOnce().catch(() => null).finally(() => { flushInFlight = null; });
  return flushInFlight;
}

async function deployedSha() {
  try {
    const fetcher = baseFetch || globalThis.fetch.bind(globalThis);
    const r = await fetcher('/__deployed_sha.txt?diagnostic=' + Date.now(), { headers:{'cache-control':'no-cache'} });
    return r.ok ? (await r.text()).trim().slice(0,80) : '';
  } catch { return ''; }
}

async function buildManualSnapshot() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const nav = performance.getEntriesByType?.('navigation')?.[0];
  const memory = performance.memory;
  const missing = globalThis.__BH_I18N__?.getMissingTranslations?.() || [];
  return {
    created_at:new Date().toISOString(),
    deployed_sha:await deployedSha(),
    page:pageContext(),
    browser:{
      platform:navigator.platform || '',
      hardware_concurrency:Number(navigator.hardwareConcurrency || 0),
      device_memory_gb:Number(navigator.deviceMemory || 0),
      connection:connection ? {
        effective_type:String(connection.effectiveType || ''),
        downlink_mbps:Number(connection.downlink || 0),
        rtt_ms:Number(connection.rtt || 0),
        save_data:Boolean(connection.saveData),
      } : null,
    },
    performance:nav ? {
      type:String(nav.type || ''),
      dom_content_loaded_ms:Math.round(nav.domContentLoadedEventEnd || 0),
      load_event_ms:Math.round(nav.loadEventEnd || 0),
      transfer_size:Number(nav.transferSize || 0),
      encoded_body_size:Number(nav.encodedBodySize || 0),
    } : null,
    js_heap:memory ? {
      used_bytes:Number(memory.usedJSHeapSize || 0),
      total_bytes:Number(memory.totalJSHeapSize || 0),
      limit_bytes:Number(memory.jsHeapSizeLimit || 0),
    } : null,
    i18n_missing:missing.slice(0,80),
  };
}

export async function createWebDiagnosticLog() {
  const persisted = (await readBatch(MAX_MANUAL_EVENTS)).map(({id, ...event}) => event);
  const combined = [...persisted, ...sessionHistory];
  const unique = [];
  const seen = new Set();
  for (const event of combined) {
    const key = [event.ts,event.level,event.type,event.message].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(event);
  }
  const snapshot = {
    ts:new Date().toISOString(),
    level:'info',
    type:'manual_diagnostic_snapshot',
    message:'Manual full diagnostic snapshot',
    detail:await buildManualSnapshot(),
    ...pageContext(),
  };
  const events = [snapshot, ...unique.slice(-(MAX_MANUAL_EVENTS - 1))];
  return sendEvents(events, 'manual');
}

function installFetchLogging() {
  const currentFetch = globalThis.fetch.bind(globalThis);
  baseFetch = currentFetch;
  globalThis.fetch = async (input, init = {}) => {
    const started = performance.now();
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    const method = String(init.method || (typeof input !== 'string' && input.method) || 'GET').toUpperCase();
    try {
      const response = await currentFetch(input, init);
      const elapsed = Math.round(performance.now() - started);
      const diagnosticStatus = response.status >= 500 || response.status === 401 || response.status === 403;
      if (diagnosticStatus || elapsed >= SLOW_REQUEST_MS) {
        void addEvent({
          level: diagnosticStatus ? 'error' : 'warn',
          type: diagnosticStatus ? 'http_error' : 'slow_request',
          message: `${method} ${url.pathname} -> ${response.status} (${elapsed} ms)`,
          detail:{ method, host:url.host, path:url.pathname, status:response.status, elapsed_ms:elapsed },
        });
      }
      return response;
    } catch (error) {
      const elapsed = Math.round(performance.now() - started);
      void addEvent({
        level:'error',
        type:'network_error',
        message:`${method} ${url.pathname}: ${error?.message || error}`,
        detail:{ method, host:url.host, path:url.pathname, elapsed_ms:elapsed, error:String(error?.stack || error) },
      });
      throw error;
    }
  };
}

export function logWebEvent(type, message, detail = {}, level = 'info') {
  return addEvent({ type, message, detail, level });
}

export function installWebLogger() {
  if (installed) return;
  installed = true;
  installFetchLogging();

  window.addEventListener('error', (event) => {
    void addEvent({
      level:'error',
      type:'window_error',
      message:event.message || 'Unhandled window error',
      detail:{ filename:event.filename || '', lineno:event.lineno || 0, colno:event.colno || 0, stack:event.error?.stack || '' },
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    void addEvent({
      level:'error',
      type:'unhandled_rejection',
      message:String(reason?.message || reason || 'Unhandled promise rejection'),
      detail:{ stack:reason?.stack || '' },
    });
  });

  window.addEventListener('offline', () => void addEvent({ level:'warn', type:'network_offline', message:'Browser offline' }));
  window.addEventListener('online', () => {
    void addEvent({ type:'network_online', message:'Browser online' });
    if (!lastSuccessfulAutoFlushAt || Date.now() - lastSuccessfulAutoFlushAt >= AUTO_FILE_MIN_INTERVAL_MS) scheduleUrgentFlush();
  });

  const originalError = console.error.bind(console);
  console.error = (...args) => {
    void addEvent({ level:'error', type:'console_error', message:args.map(x => typeof x === 'string' ? x : JSON.stringify(redact(x))).join(' ') });
    originalError(...args);
  };

  clearInterval(flushTimer);
  flushTimer = setInterval(() => void flushWebLogs(), AUTO_FLUSH_INTERVAL_MS);
}
