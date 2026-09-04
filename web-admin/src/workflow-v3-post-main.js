import { getLocale, t } from './i18n.js';

const BACKEND = 'https://backend.bao-hang-1291.invalid';
const SESSION_KEY = 'bao-hang-1291-web-session';
const REMOVED_ACTIONS = new Set(['claim-issue', 'reassign-issue']);
const PAGE_SIZES = new Set([25, 50, 100]);
const SECTION_CONFIG = {
  web: { root:'#webLogs', action:'list-web-logs' },
  device: { root:'#logs', action:'list-logs' },
  audit: { root:'#audit', rpc:'api_audit_history_page_rpc' },
};

const $ = (selector, root = document) => root.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;',
}[char]));
const tr = (vi, en) => t(vi, en);

function parseJsonBody(init) {
  if (!init?.body || typeof init.body !== 'string') return {};
  try { return JSON.parse(init.body) || {}; } catch { return {}; }
}
function pageSize(value) {
  const n = Number(value || 25);
  return PAGE_SIZES.has(n) ? n : 25;
}
function virtualAction(url) {
  if (url.hostname !== 'backend.bao-hang-1291.invalid') return '';
  const match = url.pathname.match(/^\/api\/(?:web-api|api|issue-withdraw|admin-ops)\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : '';
}
function removedResponse(action) {
  return new Response(JSON.stringify({ ok:false, error:'RECEIVE_FLOW_REMOVED', action }), {
    status:410,
    headers:{ 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store' },
  });
}

// backend-runtime installs its virtual fetch adapter while main.js evaluates.
// This module is loaded after main.js, so the wrapper below is the final UI boundary.
const backendFetch = globalThis.fetch.bind(globalThis);
async function workflowV3Fetch(input, init = {}) {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  const action = virtualAction(url);
  if (REMOVED_ACTIONS.has(action)) return removedResponse(action);

  if (action === 'list-logs' || action === 'list-web-logs') {
    const body = parseJsonBody(init);
    const size = pageSize(body.page_size || body.limit || 25);
    const page = Math.max(1, Number(body.page || 1));
    return backendFetch(input, {
      ...init,
      body:JSON.stringify({ ...body, page, page_size:size, limit:size }),
    });
  }

  // Keep the legacy main.js logs route from fetching a 150-row audit payload.
  // The dedicated pager below uses the page RPC directly; this compatibility
  // mapping makes the first paint page-sized as well.
  if (action === 'audit-history') {
    const body = parseJsonBody(init);
    const size = pageSize(body.page_size || body.limit || 25);
    const page = Math.max(1, Number(body.page || 1));
    const headers = new Headers(init.headers || {});
    const roleHeader = String(headers.get('x-admin-test-role') || headers.get('x-test-role') || '').trim().toUpperCase();
    const response = await backendFetch(`${BACKEND}/data/rpc/api_audit_history_page_rpc`, {
      method:'POST',
      headers,
      body:JSON.stringify({
        p_limit:size,
        p_offset:(page - 1) * size,
        p_test_role:['ADMIN_INVENT','INVENT','PICKER'].includes(roleHeader) ? roleHeader : null,
      }),
    });
    const text = await response.text();
    if (!response.ok) return new Response(text, { status:response.status, headers:response.headers });
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
    return new Response(JSON.stringify({
      audit:Array.isArray(data.items) ? data.items : [],
      total:Number(data.total || 0),
      limit:Number(data.limit || size),
      offset:Number(data.offset || 0),
      page,
      page_size:size,
      total_pages:Math.max(1, Math.ceil(Number(data.total || 0) / size)),
    }), { status:200, headers:{ 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store' } });
  }
  return backendFetch(input, init);
}
Object.defineProperty(workflowV3Fetch, '__BH_WORKFLOW_V3_HARDENED__', { value:true });
globalThis.fetch = workflowV3Fetch;

globalThis.__BH_WORKFLOW_V3_REMOVED_ACTIONS__ = Object.freeze(['claim-issue','reassign-issue']);

function session() {
  try {
    const value = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    return value?.access_token ? value : null;
  } catch { return null; }
}
function testRole() {
  const value = String(document.body?.dataset?.testRole || '').trim().toUpperCase();
  return ['ADMIN_INVENT','INVENT','PICKER'].includes(value) ? value : null;
}
async function parseResponse(response) {
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error:text }; }
  if (!response.ok || data?.ok === false) throw new Error(data?.error || data?.message || `${tr('Lỗi máy chủ','Server error')} ${response.status}`);
  return data;
}
async function authFetch(url, init) {
  if (typeof globalThis.__BH_AUTH_FETCH__ === 'function') return globalThis.__BH_AUTH_FETCH__(url, init);
  const current = session();
  if (!current) throw new Error(tr('Phiên đăng nhập không tồn tại.','No active login session.'));
  const headers = new Headers(init?.headers || {});
  headers.set('authorization', `Bearer ${current.access_token}`);
  return fetch(url, { ...init, headers });
}
async function api(action, payload = {}) {
  return parseResponse(await authFetch(`${BACKEND}/api/web-api/${encodeURIComponent(action)}`, {
    method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify(payload),
  }));
}
async function rpc(name, payload = {}) {
  return parseResponse(await authFetch(`${BACKEND}/data/rpc/${encodeURIComponent(name)}`, {
    method:'POST', headers:{ 'content-type':'application/json' },
    body:JSON.stringify({ ...payload, p_test_role:testRole() }),
  }));
}
function routeActive() {
  if (typeof globalThis.__BH_ROUTE_ACTIVE__ === 'function') return globalThis.__BH_ROUTE_ACTIVE__('logs');
  return Boolean($('.tabs [data-tab="logs"].active'));
}
function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(getLocale(), { hour12:false });
}
function statusLabel(status) {
  return ({
    OPEN:tr('Đang xử lý','In progress'), CLAIMED:tr('Đang xử lý','In progress'),
    SEARCHING:tr('Đang xử lý','In progress'), REPLENISHING:tr('Đang xử lý','In progress'),
    AVAILABLE:tr('Đã có hàng','Available'), SKIP_ALLOWED:tr('Đã bỏ qua','Skipped'),
    WITHDRAWN:tr('Picker thu hồi','Picker withdrawal'), CLOSED:tr('Đã đóng','Closed'),
  })[String(status || '').toUpperCase()] || String(status || '—');
}

const pagerState = {
  web:{page:0,size:25,total:0,items:[],loading:false,loaded:false},
  device:{page:0,size:25,total:0,items:[],loading:false,loaded:false},
  audit:{page:0,size:25,total:0,items:[],loading:false,loaded:false},
};
let installQueued = false;

function pagerHtml(kind, state) {
  const pages = Math.max(1, Math.ceil(Number(state.total || 0) / state.size));
  const page = Math.min(Math.max(0, state.page), pages - 1);
  return `<div class="wv3-pagination wv3-server-log-pager" data-log-pager="${kind}">
    <span>${esc(tr('Tổng','Total'))}: <b>${Number(state.total || 0)}</b> · ${esc(tr('Trang','Page'))} ${page + 1}/${pages}</span>
    <div><select data-log-size aria-label="${esc(tr('Số dòng mỗi trang','Rows per page'))}">${[25,50,100].map((n)=>`<option value="${n}" ${state.size===n?'selected':''}>${n}</option>`).join('')}</select>
    <button class="secondary" data-log-first ${page<=0?'disabled':''}>«</button><button class="secondary" data-log-prev ${page<=0?'disabled':''}>‹</button><button class="secondary" data-log-next ${page>=pages-1?'disabled':''}>›</button><button class="secondary" data-log-last ${page>=pages-1?'disabled':''}>»</button></div>
  </div>`;
}
function webRows(items, retention) {
  if (!items.length) return `<div class="card muted">${esc(tr('Chưa có file log Web.','No Web log files yet.'))}</div>`;
  return items.map((row) => {
    const mode = row.mode === 'manual' ? tr('Tạo thủ công','Manual') : tr('Tự động · khi có lỗi','Automatic · on errors');
    return `<article class="card log"><div><strong>${esc(row.file_name || '—')}</strong><span>${esc(formatDateTime(row.created_at))}</span><small>${esc(mode)} · ${Number(row.compressed_bytes || 0).toLocaleString(getLocale())} bytes · Google Drive · ${esc(tr('tự dọn sau','auto-clean after'))} ${Number(retention || 14)} ${esc(tr('ngày','days'))}</small></div><button class="secondary" data-v3-download="web" data-id="${esc(row.id)}">${esc(tr('TẢI','DOWNLOAD'))}</button></article>`;
  }).join('');
}
function deviceRows(items) {
  if (!items.length) return `<div class="card muted">${esc(tr('Chưa có file log thiết bị.','No device log files yet.'))}</div>`;
  return items.map((row) => `<article class="card log"><div><strong>${esc(row.employee_code || '—')} · ${esc(row.device_name || tr('Thiết bị','Device'))}</strong><span>${esc(row.app_version || tr('Không rõ phiên bản','Unknown version'))} · ${esc(formatDateTime(row.created_at))}</span><small>${Number(row.compressed_bytes || 0).toLocaleString(getLocale())} bytes · Google Drive${row.sha256 ? ` · SHA ${esc(String(row.sha256).slice(0,12))}` : ''}</small></div><button class="secondary" data-v3-download="device" data-id="${esc(row.id)}">${esc(tr('TẢI','DOWNLOAD'))}</button></article>`).join('');
}
function auditRows(items) {
  if (!items.length) return `<div class="card muted">${esc(tr('Chưa có lịch sử thao tác.','No audit history yet.'))}</div>`;
  return items.map((row) => `<article class="card"><strong>${esc(row.action || '—')}</strong><p>${esc(statusLabel(row.from_status))} → ${esc(statusLabel(row.to_status))}</p><small>${esc(formatDateTime(row.created_at))} · ${esc(tr('người thao tác','actor'))}: ${esc(row.actor_name || '—')} · ${esc(tr('yêu cầu','issue'))} ${esc(String(row.issue_id || '').slice(0,8))}</small></article>`).join('');
}
function renderSection(kind, extra = {}) {
  const cfg = SECTION_CONFIG[kind];
  const root = $(cfg.root);
  if (!root || !routeActive()) return;
  const state = pagerState[kind];
  root.dataset.wv3ServerPaged = '1';
  const rows = kind === 'web' ? webRows(state.items, extra.retention_days)
    : kind === 'device' ? deviceRows(state.items)
    : auditRows(state.items);
  root.innerHTML = `<div class="wv3-server-page" data-server-page-kind="${kind}">${rows}${pagerHtml(kind, state)}</div>`;
  bindSection(kind);
}
async function loadSection(kind) {
  if (!routeActive()) return;
  const state = pagerState[kind];
  if (state.loading) return;
  state.loading = true;
  const root = $(SECTION_CONFIG[kind].root);
  if (root) root.innerHTML = `<div class="wv3-server-page"><div class="card muted">${esc(tr('Đang tải…','Loading…'))}</div></div>`;
  const slowTimer = kind === 'audit' ? null : setTimeout(() => {
    if (root && routeActive() && state.loading) root.innerHTML = `<div class="wv3-server-page"><div class="card muted"><b>${esc(tr('Google Drive đang phản hồi chậm','Google Drive is responding slowly'))}</b><p>${esc(tr('Trang vẫn dùng được. Có thể tiếp tục chờ hoặc bấm Làm mới để thử lại.','The page remains usable. Keep waiting or press Refresh to retry.'))}</p></div></div>`;
  }, 5000);
  try {
    let data;
    if (kind === 'audit') {
      data = await rpc('api_audit_history_page_rpc', { p_limit:state.size, p_offset:state.page * state.size });
      state.items = Array.isArray(data.items) ? data.items : [];
    } else {
      data = await api(SECTION_CONFIG[kind].action, { page:state.page + 1, page_size:state.size, limit:state.size });
      state.items = Array.isArray(data.logs) ? data.logs : [];
    }
    state.total = Number(data.total ?? state.items.length);
    const pages = Math.max(1, Math.ceil(state.total / state.size));
    if (state.page > pages - 1) {
      state.page = pages - 1;
      state.loading = false;
      return loadSection(kind);
    }
    state.loaded = true;
    renderSection(kind, data);
  } catch (error) {
    if (root && routeActive()) root.innerHTML = `<div class="wv3-server-page"><div class="message" data-type="error">${esc(error?.message || String(error))}</div></div>`;
  } finally {
    if (slowTimer) clearTimeout(slowTimer);
    state.loading = false;
  }
}
function bindSection(kind) {
  const root = $(SECTION_CONFIG[kind].root);
  if (!root) return;
  const state = pagerState[kind];
  const pages = Math.max(1, Math.ceil(state.total / state.size));
  const size = $('[data-log-size]', root);
  if (size) size.onchange = (event) => { state.size = pageSize(event.target.value); state.page = 0; void loadSection(kind); };
  $('[data-log-first]', root)?.addEventListener('click', () => { state.page = 0; void loadSection(kind); });
  $('[data-log-prev]', root)?.addEventListener('click', () => { state.page = Math.max(0, state.page - 1); void loadSection(kind); });
  $('[data-log-next]', root)?.addEventListener('click', () => { state.page = Math.min(pages - 1, state.page + 1); void loadSection(kind); });
  $('[data-log-last]', root)?.addEventListener('click', () => { state.page = pages - 1; void loadSection(kind); });
  root.querySelectorAll('[data-v3-download]').forEach((button) => button.addEventListener('click', () => void downloadLog(button.dataset.v3Download, button.dataset.id)));
}
async function downloadLog(kind, id) {
  const data = await api(kind === 'web' ? 'download-web-log' : 'download-log', { id });
  if (!data.gzip_base64) throw new Error(tr('Google Drive không trả dữ liệu log.','Google Drive returned no log data.'));
  const raw = atob(data.gzip_base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type:'application/gzip' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = data.file_name || `bao-hang-1291-${kind}-log-${id}.jsonl.gz`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function scheduleInstall() {
  if (installQueued) return;
  installQueued = true;
  queueMicrotask(() => {
    installQueued = false;
    if (!routeActive()) return;
    for (const [kind, cfg] of Object.entries(SECTION_CONFIG)) {
      const root = $(cfg.root);
      if (!root) continue;
      const ours = root.firstElementChild?.classList?.contains('wv3-server-page');
      if (!ours && pagerState[kind].loaded) { renderSection(kind); continue; }
      if (!pagerState[kind].loaded) void loadSection(kind);
    }
  });
}
const logObserver = new MutationObserver((mutations) => {
  if (!routeActive()) return;
  const relevant = mutations.some((mutation) => {
    const target = mutation.target instanceof Element ? mutation.target : null;
    if (target?.closest?.('.wv3-server-page')) return false;
    if (target && ['webLogs','logs','audit'].includes(target.id)) return true;
    return [...mutation.addedNodes].some((node) => node instanceof Element && (['webLogs','logs','audit'].includes(node.id) || Boolean(node.querySelector?.('#webLogs,#logs,#audit'))));
  });
  if (relevant) scheduleInstall();
});
function startObserver() {
  logObserver.observe(document.documentElement, { childList:true, subtree:true });
  scheduleInstall();
}
window.addEventListener('bh:languagechange', () => {
  if (!routeActive()) return;
  for (const kind of Object.keys(SECTION_CONFIG)) if (pagerState[kind].loaded) renderSection(kind);
});
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startObserver, { once:true });
else startObserver();

globalThis.__BH_WORKFLOW_V3_LOG_PAGER__ = Object.freeze({
  mode:'server',
  pageSizes:[25,50,100],
  refresh:() => Promise.all(Object.keys(SECTION_CONFIG).map((kind) => loadSection(kind))),
});
