const DB_NAME = 'bao-hang-1291-web-diagnostics';
const STORE = 'events';
const MAX_EVENTS = 500;
const MAX_BATCH = 120;
const FLUSH_INTERVAL_MS = 15 * 60 * 1000;
const ERROR_FLUSH_DEBOUNCE_MS = 30 * 1000;
const HIDDEN_FLUSH_MIN_INTERVAL_MS = 5 * 60 * 1000;
const SLOW_REQUEST_MS = 3000;
const WORKER_URL = (globalThis.__BAO_HANG_WORKER_URL__ || '').trim();
const SESSION_ID_KEY = 'bao-hang-1291-web-log-session-id';

let dbPromise;
let flushTimer;
let urgentFlushTimer;
let flushInFlight;
let lastSuccessfulFlushAt = 0;
let installed = false;
let baseFetch;
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
      .slice(0, 2000);
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

async function addEvent(event) {
  const item = {
    ts: new Date().toISOString(),
    level: event.level || 'info',
    type: event.type || 'event',
    message: redact(event.message || ''),
    detail: redact(event.detail || {}),
    ...pageContext(),
  };
  const db = await openDb();
  if (!db) {
    const key = 'bao-hang-1291-web-log-fallback';
    const rows = JSON.parse(localStorage.getItem(key) || '[]');
    rows.push(item);
    localStorage.setItem(key, JSON.stringify(rows.slice(-100)));
    return;
  }
  await new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add(item);
    tx.oncomplete = resolve;
    tx.onerror = resolve;
  });
  void trimDb();
  if (event.level === 'error') scheduleUrgentFlush();
}

async function trimDb() {
  const db = await openDb();
  if (!db) return;
  const rows = await readBatch(MAX_EVENTS + 100);
  if (rows.length <= MAX_EVENTS) return;
  await deleteIds(rows.slice(0, rows.length - MAX_EVENTS).map(x => x.id));
}

async function readBatch(limit = MAX_BATCH) {
  const db = await openDb();
  if (!db) return [];
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
  if (!db) return;
  await new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    ids.forEach(id => store.delete(id));
    tx.oncomplete = resolve;
    tx.onerror = resolve;
  });
}

function scheduleUrgentFlush(delay = ERROR_FLUSH_DEBOUNCE_MS) {
  if (urgentFlushTimer) return;
  urgentFlushTimer = setTimeout(() => {
    urgentFlushTimer = null;
    void flush();
  }, Math.max(0, delay));
}

async function flushOnce() {
  if (!WORKER_URL || !navigator.onLine) return;
  const auth = globalThis.__BH_AUTH__?.getSession?.();
  if (!auth?.access_token) return;
  const rows = await readBatch(MAX_BATCH);
  if (!rows.length) return;
  const events = rows.map(({id, ...event}) => event);
  try {
    const response = await baseFetch(WORKER_URL, {
      method:'POST',
      headers:{'content-type':'text/plain;charset=UTF-8'},
      body:JSON.stringify({
        action:'upload-web-log',
        id_token:auth.access_token,
        session_id:sessionId,
        events,
      }),
      keepalive: document.visibilityState === 'hidden',
    });
    const text = await response.text();
    let result = {};
    try { result = text ? JSON.parse(text) : {}; } catch {}
    if (!response.ok || result.ok !== true) throw new Error(result.error || 'WEB_LOG_UPLOAD_FAILED');
    await deleteIds(rows.map(x => x.id));
    lastSuccessfulFlushAt = Date.now();
  } catch {}
}

async function flush() {
  if (flushInFlight) return flushInFlight;
  flushInFlight = flushOnce().finally(() => { flushInFlight = null; });
  return flushInFlight;
}

function safeTarget(target) {
  if (!(target instanceof Element)) return {};
  const el = target.closest('button,a,[data-tab],[data-fast-action],[data-update],[data-restore],select') || target;
  return {
    tag: el.tagName,
    id: el.id || '',
    action: el.getAttribute('data-fast-action') || el.getAttribute('data-update') || el.getAttribute('data-tab') || '',
    label: String(el.textContent || el.getAttribute('aria-label') || '').trim().replace(/\s+/g,' ').slice(0,160),
  };
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
      if (!response.ok || elapsed >= SLOW_REQUEST_MS) {
        void addEvent({
          level: response.ok ? 'warn' : 'error',
          type: response.ok ? 'slow_request' : 'http_error',
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

export async function flushWebLogs() { await flush(); }

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

  window.addEventListener('hashchange', () => void addEvent({ type:'route_change', message:location.hash || '#/' }));
  window.addEventListener('online', () => { void addEvent({ type:'network_online', message:'Browser online' }); scheduleUrgentFlush(5000); });
  window.addEventListener('offline', () => void addEvent({ level:'warn', type:'network_offline', message:'Browser offline' }));
  document.addEventListener('visibilitychange', () => {
    void addEvent({ type:'visibility_change', message:document.visibilityState });
    if (document.visibilityState === 'hidden' && Date.now() - lastSuccessfulFlushAt >= HIDDEN_FLUSH_MIN_INTERVAL_MS) scheduleUrgentFlush(0);
  });
  document.addEventListener('click', (event) => {
    const target = safeTarget(event.target);
    if (target.tag === 'BUTTON' || target.tag === 'A') {
      void addEvent({ type:'ui_action', message:target.label || target.action || target.id || target.tag, detail:target });
    }
  }, true);

  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);
  console.warn = (...args) => {
    void addEvent({ level:'warn', type:'console_warn', message:args.map(x => typeof x === 'string' ? x : JSON.stringify(redact(x))).join(' ') });
    originalWarn(...args);
  };
  console.error = (...args) => {
    void addEvent({ level:'error', type:'console_error', message:args.map(x => typeof x === 'string' ? x : JSON.stringify(redact(x))).join(' ') });
    originalError(...args);
  };

  void addEvent({ type:'page_start', message:'Web diagnostics started' });
  clearInterval(flushTimer);
  flushTimer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
  setTimeout(() => void flush(), 3000);
}
