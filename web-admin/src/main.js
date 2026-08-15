import './style.css';
import { createClient } from '@supabase/supabase-js';

let excelModulePromise;
async function getExcelJS() {
  excelModulePromise ||= import('exceljs').then((module) => module.default ?? module);
  return excelModulePromise;
}

const SUPABASE_URL = 'https://oedasgcdjppjwidhlqdr.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_LGgDehtHMSyeJ1XyJDvQiQ_cdlqIKq7';
const API_BASE = `${SUPABASE_URL}/functions/v1/web-api`;
const SESSION_KEY = 'bao-hang-1291-web-session';
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ROLES = {
  ADMIN: 'Admin hệ thống',
  ADMIN_INVENT: 'Admin Invent',
  INVENT: 'Người báo hàng',
  PICKER: 'Picker / Người lấy hàng',
};
const realtimeClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  realtime: { params: { eventsPerSecond: 10 } },
});
const state = {
  session: null,
  testRole: null,
  selectedSku: null,
  activeTab: null,
  managedUsers: [],
  issueChannel: null,
  catalogChannel: null,
  staffChannel: null,
  realtimeStatus: 'OFFLINE',
  fallbackTimer: null,
  refreshTimers: new Map(),
  liveRefresh: { issue: null, staff: null, catalog: null },
  overviewCache: { admin: null, reports: null, service: null },
};
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

function normalize(value) {
  return String(value ?? '').trim().normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replaceAll('đ', 'd').replace(/\s+/g, ' ');
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c]));
}
function employeeEmail(code) {
  const raw = String(code ?? '').trim().toLowerCase();
  if (!raw || !/^[a-z0-9._-]+$/.test(raw)) throw new Error('Mã nhân viên không hợp lệ.');
  return `${raw}@bao-hang-1291.local`;
}
function role() { return state.testRole || state.session?.profile?.role || 'PICKER'; }
function actualRole() { return state.session?.profile?.role || 'PICKER'; }
function elevated() { return ['ADMIN', 'ADMIN_INVENT'].includes(role()); }
function formatTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? escapeHtml(value) : d.toLocaleString('vi-VN', { hour12: false });
}
function uuid() { return crypto.randomUUID(); }
function readSession() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    return parsed?.access_token && parsed?.refresh_token && parsed?.profile ? parsed : null;
  } catch { return null; }
}
function saveSession(session) {
  state.session = session;
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}
async function stopRealtime() {
  clearInterval(state.fallbackTimer);
  state.fallbackTimer = null;
  for (const timer of state.refreshTimers.values()) clearTimeout(timer);
  state.refreshTimers.clear();
  const channels = [state.issueChannel, state.catalogChannel, state.staffChannel].filter(Boolean);
  state.issueChannel = null;
  state.catalogChannel = null;
  state.staffChannel = null;
  for (const channel of channels) await realtimeClient.removeChannel(channel).catch(() => {});
  state.realtimeStatus = 'OFFLINE';
}
function clearSession() {
  stopRealtime();
  state.session = null;
  state.testRole = null;
  state.activeTab = null;
  state.selectedSku = null;
  sessionStorage.removeItem(SESSION_KEY);
}
async function parseResponse(response) {
  const text = await response.text();
  let data = {};
  if (text) {
    try { data = JSON.parse(text); } catch { data = { error: text }; }
  }
  if (!response.ok) {
    const error = new Error(data.error || data.message || `Lỗi máy chủ ${response.status}`);
    error.code = data.code;
    error.status = response.status;
    throw error;
  }
  return data;
}
async function authToken(payload, grantType = 'password') {
  return parseResponse(await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=${grantType}`, {
    method: 'POST', headers: { 'content-type': 'application/json', apikey: SUPABASE_ANON_KEY }, body: JSON.stringify(payload),
  }));
}
async function fetchProfile(accessToken, userId) {
  const q = new URLSearchParams({ id: `eq.${userId}`, select: 'id,employee_code,full_name,contractor,role,active' });
  const rows = await parseResponse(await fetch(`${SUPABASE_URL}/rest/v1/profiles?${q}`, {
    headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${accessToken}` },
  }));
  if (!Array.isArray(rows) || !rows.length) throw new Error('Tài khoản chưa có hồ sơ nhân sự.');
  return rows[0];
}
async function refreshSessionIfNeeded() {
  if (!state.session) throw new Error('Phiên đăng nhập không tồn tại.');
  const now = Math.floor(Date.now() / 1000);
  if ((state.session.expires_at || 0) > now + 120) return;
  const token = await authToken({ refresh_token: state.session.refresh_token }, 'refresh_token');
  saveSession({ ...state.session, access_token: token.access_token, refresh_token: token.refresh_token || state.session.refresh_token, expires_at: now + Number(token.expires_in || 3600) });
  realtimeClient.realtime.setAuth(state.session.access_token);
}
async function api(action, payload = {}) {
  await refreshSessionIfNeeded();
  const headers = { 'content-type': 'application/json', apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${state.session.access_token}` };
  if (state.testRole) headers['x-admin-test-role'] = state.testRole;
  const response = await fetch(`${API_BASE}/${encodeURIComponent(action)}`, { method: 'POST', headers, body: JSON.stringify(payload) });
  if (response.status === 401) {
    clearSession();
    renderLogin('Phiên đăng nhập đã hết hạn.');
    throw new Error('Phiên đăng nhập đã hết hạn.');
  }
  return parseResponse(response);
}
function setBusy(busy, text = 'Đang xử lý…') {
  const el = $('#busy');
  if (!el) return;
  el.hidden = !busy;
  $('#busyText').textContent = text;
}
function message(target, text, type = 'info') {
  const el = typeof target === 'string' ? $(target) : target;
  if (!el) return;
  el.textContent = text;
  el.dataset.type = type;
  el.hidden = !text;
}
function safeMessage(error) { return error instanceof Error ? error.message : String(error); }
function setLiveHtml(element, html) {
  if (!element || element.__liveHtml === html) return;
  element.innerHTML = html;
  element.__liveHtml = html;
}

function renderLogin(msg = '') {
  stopRealtime();
  document.body.innerHTML = `<main class="login-shell"><section class="login-card">
    <div class="brand">1291</div><p class="eyebrow">BÁO HÀNG 1291</p><h1>Web nghiệp vụ</h1>
    <p class="muted">Đăng nhập bằng tài khoản Báo hàng 1291.</p>
    <form id="loginForm"><label>Mã nhân viên<input id="employeeCode" required autocomplete="username"></label>
    <label>Mật khẩu<input id="password" type="password" required autocomplete="current-password"></label>
    <button class="primary wide">ĐĂNG NHẬP</button></form><div id="loginMessage" class="message" hidden></div>
    <p class="security">Quyền được kiểm tra tại server. Web không chứa service-role key, thông tin xác thực máy chủ hoặc private key.</p>
  </section></main>`;
  if (msg) message('#loginMessage', msg, 'error');
  $('#loginForm').addEventListener('submit', handleLogin);
  $('#employeeCode').focus();
}
async function handleLogin(event) {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  message('#loginMessage', 'Đang xác thực…');
  try {
    const token = await authToken({ email: employeeEmail($('#employeeCode').value), password: $('#password').value });
    const profile = await fetchProfile(token.access_token, token.user.id);
    if (!profile.active) throw new Error('Tài khoản đã ngừng hoạt động.');
    saveSession({ access_token: token.access_token, refresh_token: token.refresh_token, expires_at: Math.floor(Date.now() / 1000) + Number(token.expires_in || 3600), profile });
    state.testRole = null;
    renderApp();
  } catch (error) { message('#loginMessage', safeMessage(error), 'error'); }
  finally { button.disabled = false; }
}

function tabsForRole(currentRole) {
  if(currentRole==='ADMIN')return [['overview','Tổng quan'],['events','Sự kiện'],['sku','Danh mục SKU'],['reports','Báo cáo'],['users','Nhân sự & quyền'],['backup','Tài khoản dự phòng'],['devices','Thiết bị'],['services','Hệ thống & dung lượng'],['logs','Log & audit'],['config','Cấu hình'],['versions','Phiên bản']];
  if(currentRole==='ADMIN_INVENT')return [['overview','Tổng quan'],['events','Sự kiện'],['sku','Danh mục SKU'],['reports','Báo cáo'],['users','Nhân sự'],['logs','Log'],['sla','Mốc thời gian']];
  if(currentRole==='INVENT')return [['events','Sự kiện'],['sku','Danh mục SKU']];return [['picker','Picker']];
}
function tabFromHash(tabs) {
  const id = location.hash.replace(/^#\/?/, '').split('/')[0];
  return tabs.some(([key]) => key === id) ? id : null;
}
function setHash(id) {
  if (location.hash !== `#/${id}`) history.replaceState(null, '', `#/${id}`);
}
function healthChip(label, value, kind = '') { return `<span class="health-chip ${kind}" data-health="${label}"><b>${label}</b><em>${escapeHtml(value)}</em></span>`; }
function renderApp() {
  const profile = state.session.profile;
  const currentRole = role();
  const tabs = tabsForRole(currentRole);
  state.activeTab = tabFromHash(tabs) || (tabs.some(([id]) => id === state.activeTab) ? state.activeTab : tabs[0][0]);
  setHash(state.activeTab);
  document.body.innerHTML = `<div class="app-shell">
    <header class="topbar"><div><p class="eyebrow">BÁO HÀNG 1291</p><h1>Web nghiệp vụ</h1><div class="health-row" id="healthRow">
      ${healthChip('SERVICE','ONLINE','good')}${healthChip('REALTIME','ĐANG NỐI')}${healthChip('SHEET','—')}${healthChip('FREE TIER','GIÁM SÁT')}
    </div></div><div class="user"><strong>${escapeHtml(profile.full_name)}</strong><span>${escapeHtml(profile.employee_code)} · ${escapeHtml(ROLES[currentRole] || currentRole)}</span><button id="logout" class="ghost">Đăng xuất</button></div></header>
    ${state.testRole ? `<div class="test-banner">ĐANG KIỂM THỬ QUYỀN: <strong>${escapeHtml(ROLES[state.testRole])}</strong> · API cũng bị hạ quyền tương ứng. <button id="exitTest">Thoát kiểm thử</button></div>` : ''}
    ${actualRole() === 'ADMIN' && !state.testRole ? `<div class="test-tools"><span>Kiểm thử giao diện + quyền server:</span><button data-test="ADMIN_INVENT">Admin Invent</button><button data-test="INVENT">Người báo hàng</button><button data-test="PICKER">Picker</button></div>` : ''}
    <nav class="tabs">${tabs.map(([id,label]) => `<button data-tab="${id}" class="${id === state.activeTab ? 'active' : ''}">${label}</button>`).join('')}</nav>
    <main id="content" class="content"></main></div>
    <div id="busy" class="busy" hidden><div><span class="spinner"></span><strong id="busyText">Đang xử lý…</strong></div></div>`;
  $('#logout').onclick = () => { clearSession(); renderLogin(); };
  $('#exitTest')?.addEventListener('click', () => { state.testRole = null; state.activeTab = null; renderApp(); });
  $$('[data-test]').forEach((button) => button.onclick = () => { state.testRole = button.dataset.test; state.activeTab = null; renderApp(); });
  $$('[data-tab]').forEach((button) => button.onclick = () => { state.activeTab = button.dataset.tab; setHash(state.activeTab); renderTab(); });
  renderTab();
  startRealtime();
}
function renderTab() {
  state.liveRefresh = { issue: null, staff: null, catalog: null };
  $$('[data-tab]').forEach((button) => button.classList.toggle('active', button.dataset.tab === state.activeTab));
  const handlers = {
    overview: renderOverview, events: renderEvents, picker: renderPicker, reports: renderReports,
    sku: renderSku, users: renderUsers, backup: renderBackupAccounts, devices: renderDevices, services: renderIntegrations, logs: renderLogs,
    sla: renderSla, config: renderConfig, versions: renderVersions,
  };
  handlers[state.activeTab]?.();
}
function runLiveRefresh(kind) {
  if (document.hidden) return;
  const refresh = state.liveRefresh?.[kind];
  if (typeof refresh !== 'function') return;
  Promise.resolve(refresh()).catch(() => {});
}
function scheduleLiveRefresh(kind) {
  if (document.hidden) return;
  const previous = state.refreshTimers.get(kind);
  if (previous) clearTimeout(previous);
  state.refreshTimers.set(kind, setTimeout(() => {
    state.refreshTimers.delete(kind);
    runLiveRefresh(kind);
  }, 350));
}
function setRealtimeHealth(value, kind = '') {
  state.realtimeStatus = value;
  const el = $('[data-health="REALTIME"]');
  if (!el) return;
  el.className = `health-chip ${kind}`;
  $('em', el).textContent = value;
}
async function startRealtime() {
  await stopRealtime();
  if (!state.session || document.hidden) return;
  await refreshSessionIfNeeded().catch(() => {});
  realtimeClient.realtime.setAuth(state.session.access_token);
  const subscribeStatus = (status) => {
    if (status === 'SUBSCRIBED') {
      setRealtimeHealth('ONLINE', 'good');
      clearInterval(state.fallbackTimer); state.fallbackTimer = null;
    } else if (['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)) {
      setRealtimeHealth('FALLBACK', 'warn');
      ensureFallbackPolling();
    }
  };
  if (role() === 'PICKER') {
    state.issueChannel = realtimeClient.channel(`user:1291:${state.session.profile.id}`, { config: { private: true } })
      .on('broadcast', { event: 'picker_status_changed' }, () => scheduleLiveRefresh('issue'))
      .subscribe(subscribeStatus);
  } else {
    state.issueChannel = realtimeClient.channel('site:1291:issues', { config: { private: true } })
      .on('broadcast', { event: 'issue_changed' }, () => scheduleLiveRefresh('issue'))
      .subscribe(subscribeStatus);
    if (['ADMIN','ADMIN_INVENT'].includes(role())) {
      state.staffChannel = realtimeClient.channel('site:1291:staff', { config: { private: true } })
        .on('broadcast', { event: 'staff_changed' }, () => scheduleLiveRefresh('staff')).subscribe(subscribeStatus);
    }
  }
  state.catalogChannel = realtimeClient.channel('site:1291:catalog', { config: { private: true } })
    .on('broadcast', { event: 'catalog_changed' }, () => scheduleLiveRefresh('catalog')).subscribe(subscribeStatus);
  setTimeout(() => { if (state.realtimeStatus !== 'ONLINE') ensureFallbackPolling(); }, 6000);
}
function ensureFallbackPolling() {
  if (state.fallbackTimer || document.hidden || !state.session) return;
  state.fallbackTimer = setInterval(() => {
    if (document.hidden) return;
    for (const kind of ['issue', 'staff', 'catalog']) runLiveRefresh(kind);
  }, 30_000);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopRealtime(); else if (state.session) startRealtime();
});
window.addEventListener('hashchange', () => {
  if (!state.session) return;
  const tabs = tabsForRole(role());
  const tab = tabFromHash(tabs);
  if (tab && tab !== state.activeTab) { state.activeTab = tab; renderTab(); }
});

function paintOverview() {
  const d = state.overviewCache.admin;
  const r = state.overviewCache.reports;
  const svc = state.overviewCache.service;
  if (!d || !r || !svc) return;

  const metricsHtml = [
    ['Chờ nhận', d.open_issue_count],
    ['Đang xử lý', d.claimed_issue_count],
    ['SKU đang dùng', d.sku_count],
    ['Nhân sự hoạt động', d.active_user_count],
    ['Báo 24 giờ', r.last_24h?.reports],
    ['Quá mốc phản hồi', r.overdue_now],
  ].map(([label, value]) => `<article class="metric"><span>${label}</span><strong>${Number(value || 0).toLocaleString('vi-VN')}</strong></article>`).join('');
  setLiveHtml($('#metrics'), metricsHtml);

  const db = Number(svc.usage?.database_bytes || 0);
  const lim = Number(svc.free_limits?.database_bytes || 1);
  const pct = Math.min(100, db / lim * 100);
  const statusHtml = `<div class="panel-grid"><article class="card"><h3>Hiệu suất 24 giờ</h3><p>Ticket phát sinh: <b>${Number(r.last_24h?.issues || 0)}</b> · Đã xử lý: <b>${Number(r.last_24h?.resolved || 0)}</b></p><p>Có hàng/châm bù: <b>${Number(r.last_24h?.available || 0)}</b> · Cho SKIP: <b>${Number(r.last_24h?.skipped || 0)}</b></p><p>Trung vị nhận: <b>${r.median_claim_minutes ?? '—'} phút</b> · Trung vị hoàn tất: <b>${r.median_resolution_minutes ?? '—'} phút</b></p></article><article class="card"><h3>Nhân sự nguồn</h3><p>${d.staff_sync ? `${escapeHtml(d.staff_sync.status)} · ${formatTime(d.staff_sync.finished_at)} · ${Number(d.staff_sync.eligible_rows || 0)} nhân sự` : 'Chưa đồng bộ.'}</p></article><article class="card"><h3>Kiểm soát free tier</h3><p>Database: <b>${(db / 1048576).toFixed(1)} MB / ${(lim / 1048576).toFixed(0)} MB (${pct.toFixed(1)}%)</b></p><p>Thiết bị FCM: ${Number(svc.usage?.active_device_tokens || 0)} · Log: ${(Number(svc.usage?.diagnostic_log_bytes || 0) / 1048576).toFixed(2)} MB · Sheet chờ: ${Number(svc.usage?.sheet_pending || 0)}</p><p class="muted">Không tự bật Billing hoặc dịch vụ trả phí.</p></article></div>`;
  setLiveHtml($('#overviewStatus'), statusHtml);

  const sheet = $('[data-health="SHEET"]');
  if (sheet) {
    $('em', sheet).textContent = d.pending_sheet_count ? `${d.pending_sheet_count} CHỜ` : 'OK';
    sheet.className = `health-chip ${d.pending_sheet_count ? 'warn' : 'good'}`;
  }
  const free = $('[data-health="FREE TIER"]');
  if (free) {
    $('em', free).textContent = `DB ${pct.toFixed(1)}%`;
    free.className = `health-chip ${pct >= 80 ? 'warn' : 'good'}`;
  }
}
async function refreshOverviewLive(kind = 'all') {
  try {
    const jobs = [];
    if (kind === 'all' || ['issue', 'staff', 'catalog'].includes(kind)) {
      jobs.push(api('admin-summary').then((value) => { state.overviewCache.admin = value; }));
    }
    if (kind === 'all' || kind === 'issue') {
      jobs.push(api('reports-summary').then((value) => { state.overviewCache.reports = value; }));
    }
    if (kind === 'all') {
      jobs.push(api('service-metrics').then((value) => { state.overviewCache.service = value; }));
    }
    await Promise.all(jobs);
    paintOverview();
  } catch (error) {
    const target = $('#metrics');
    if (target && !state.overviewCache.admin) setLiveHtml(target, `<div class="message" data-type="error">${escapeHtml(safeMessage(error))}</div>`);
  }
}
async function renderOverview() {
  $('#content').innerHTML = `<div class="heading"><div><p class="eyebrow">LIVE</p><h2>Tổng quan vận hành kho</h2></div></div><div id="metrics" class="metrics"></div><div id="overviewStatus"></div>`;
  state.overviewCache = { admin: null, reports: null, service: null };
  state.liveRefresh.issue = () => refreshOverviewLive('issue');
  state.liveRefresh.staff = () => refreshOverviewLive('staff');
  state.liveRefresh.catalog = () => refreshOverviewLive('catalog');
  await refreshOverviewLive('all');
}
function formatAge(value) {
  if (!value) return 'CHƯA CÓ';
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  return minutes < 1 ? '<1 PHÚT' : `${minutes} PHÚT`;
}

async function renderEvents() {
  $('#content').innerHTML = `<div class="heading"><div><p class="eyebrow">EVENT</p><h2>Xử lý báo hàng</h2></div><button id="refreshBoard" class="secondary">Làm mới</button></div>
    <div class="subtabs"><button data-bucket="open" class="active">CHỜ NHẬN</button><button data-bucket="claimed">ĐANG XỬ LÝ${role()==='INVENT'?' CỦA TÔI':''}</button><button data-bucket="recent">ĐÃ XỬ LÝ GẦN ĐÂY</button></div><div id="board"></div>`;
  let board = null;
  let bucket = 'open';
  const renderedSnapshots = new Map();
  const draw = () => {
    const target = $('#board');
    if (!target) return;
    const rows = board?.[bucket] || [];
    if (!rows.length) {
      renderedSnapshots.clear();
      setLiveHtml(target, `<div class="card muted" data-empty-board>Không có SKU ở nhóm này.</div>`);
    } else {
      target.__liveHtml = null;
      target.querySelector('[data-empty-board]')?.remove();
      const desiredIds = new Set(rows.map((issue) => String(issue.id)));
      $$('[data-issue-card]', target).forEach((node) => {
        if (!desiredIds.has(node.dataset.issueCard)) {
          renderedSnapshots.delete(node.dataset.issueCard);
          node.remove();
        }
      });
      rows.forEach((issue, index) => {
        const id = String(issue.id);
        const snapshot = `${bucket}:${JSON.stringify(issue)}`;
        let node = $$('[data-issue-card]', target).find((item) => item.dataset.issueCard === id);
        if (!node || renderedSnapshots.get(id) !== snapshot) {
          const template = document.createElement('template');
          template.innerHTML = issueCard(issue, bucket).trim();
          const next = template.content.firstElementChild;
          if (node) node.replaceWith(next); else target.append(next);
          node = next;
          renderedSnapshots.set(id, snapshot);
        }
        const currentAtIndex = target.children[index];
        if (currentAtIndex !== node) target.insertBefore(node, currentAtIndex || null);
      });
    }
    $$('[data-claim]', target).forEach((b) => b.onclick = () => claimIssue(b.dataset.claim, load));
    $$('[data-action]', target).forEach((b) => b.onclick = () => issueAction(b.dataset.issue, b.dataset.action, b.dataset.sku, load));
    $$('[data-reassign]', target).forEach((b) => b.onclick = () => openReassign(b.dataset.reassign, b.dataset.sku, load));
  };
  const load = async () => {
    try { board = await api('issue-board'); draw(); }
    catch (error) { $('#board').innerHTML = `<div class="message" data-type="error">${escapeHtml(safeMessage(error))}</div>`; }
  };
  $('#refreshBoard').onclick = load;
  $$('[data-bucket]').forEach((b) => b.onclick = () => { bucket = b.dataset.bucket; $$('[data-bucket]').forEach((x) => x.classList.toggle('active', x === b)); draw(); });
  state.liveRefresh.issue = load;
  load();
}
function issueCard(issue, bucket) {
  const recurrence = issue.recurrence_30m ? '<span class="badge warn">TÁI PHÁT ≤30 PHÚT</span>' : '';
  const assignment = issue.assigned_name ? ` · Xử lý: ${escapeHtml(issue.assigned_name)}` : '';
  const header = `<article class="card issue" data-issue-card="${escapeHtml(issue.id)}"><div class="issue-top"><div><strong>SKU ${escapeHtml(issue.sku)}</strong><span>${Number(issue.report_count || 1)} lượt · v${Number(issue.issue_version || 1)}</span></div><time>${formatTime(issue.reported_at)}</time></div><p>${escapeHtml(issue.product_name)}</p><small>${escapeHtml(statusLabel(issue.status))}${assignment}</small>${recurrence}`;
  if (bucket === 'open') {
    return `${header}<div class="actions"><button class="secondary" data-claim="${issue.id}">NHẬN XỬ LÝ</button>${elevated() ? `<button class="danger" data-action="NOT_FOUND" data-issue="${issue.id}" data-sku="${escapeHtml(issue.sku)}">CHO SKIP</button><button class="primary" data-action="AVAILABLE" data-issue="${issue.id}" data-sku="${escapeHtml(issue.sku)}">ĐÃ CÓ HÀNG</button>` : ''}</div></article>`;
  }
  if (bucket === 'claimed') {
    return `${header}<div class="actions"><button class="danger" data-action="NOT_FOUND" data-issue="${issue.id}" data-sku="${escapeHtml(issue.sku)}">KHÔNG THẤY — CHO SKIP</button><button class="primary" data-action="AVAILABLE" data-issue="${issue.id}" data-sku="${escapeHtml(issue.sku)}">ĐÃ CÓ HÀNG / CHÂM BÙ</button>${elevated() ? `<button class="secondary" data-reassign="${issue.id}" data-sku="${escapeHtml(issue.sku)}">ĐIỀU PHỐI LẠI</button>` : ''}</div></article>`;
  }
  return `${header}</article>`;
}
function statusLabel(status) {
  return ({ OPEN:'Chờ nhận', CLAIMED:'Đang xử lý', SEARCHING:'Đang xử lý', REPLENISHING:'Đang xử lý', AVAILABLE:'Đã có hàng/châm bù', SKIP_ALLOWED:'Được phép skip', CLOSED:'Đã đóng' })[status] || status;
}
async function claimIssue(id, done) {
  try { setBusy(true,'Đang nhận xử lý…'); await api('claim-issue',{ issue_id:id }); await done(); }
  catch (error) { alert(safeMessage(error)); }
  finally { setBusy(false); }
}
async function issueAction(id, action, sku, done) {
  const skip = action === 'NOT_FOUND';
  const label = skip ? `Xác nhận không tìm thấy SKU ${sku} và CHO PHÉP SKIP?\n\nHành động này sẽ gửi cảnh báo bắt buộc xác nhận cho Picker.` : `Xác nhận SKU ${sku} đã có hàng/châm bù?`;
  if (!confirm(label)) return;
  if (skip && !confirm(`XÁC NHẬN LẦN 2\nCho phép SKIP SKU ${sku}?`)) return;
  try { setBusy(true,'Đang cập nhật trạng thái…'); await api('update-issue',{ issue_id:id, action }); await done(); }
  catch (error) { alert(safeMessage(error)); }
  finally { setBusy(false); }
}
async function openReassign(issueId, sku, done) {
  try {
    const users = (await api('list-users')).users.filter((u) => ['INVENT','ADMIN_INVENT'].includes(u.role) && u.active);
    if (!users.length) throw new Error('Không có Người báo hàng đang hoạt động để điều phối.');
    const options = users.map((u, index) => `${index + 1}. ${u.employee_code} — ${u.full_name} (${ROLES[u.role]})`).join('\n');
    const selected = prompt(`Điều phối SKU ${sku}\n\n${options}\n\nNhập số thứ tự người nhận:`);
    if (!selected) return;
    const target = users[Number(selected) - 1];
    if (!target) throw new Error('Lựa chọn người nhận không hợp lệ.');
    const reason = prompt('Lý do điều phối lại (bắt buộc):');
    if (!reason?.trim()) return;
    setBusy(true,'Đang điều phối lại…');
    await api('reassign-issue',{ issue_id:issueId, new_assignee_id:target.id, reason:reason.trim() });
    await done();
  } catch (error) { alert(safeMessage(error)); }
  finally { setBusy(false); }
}

function renderPicker() {
  $('#content').innerHTML = `<div class="heading"><div><p class="eyebrow">PICKER</p><h2>Picker / Người lấy hàng</h2></div></div>
    <div class="card"><label>Quét hoặc tìm SKU / tên hàng<input id="skuSearch" placeholder="Quét mã hoặc nhập một phần tên"></label><div id="skuResults" class="search-results"></div>
    <div id="selectedSku" class="selected muted">Chưa chọn SKU</div><button id="reportShortage" class="danger wide" disabled>BÁO THIẾU</button><div id="pickerMsg" class="message" hidden></div></div>
    <div class="heading compact"><h3>Báo gần đây của tôi</h3><button id="refreshMine" class="secondary">Làm mới</button></div><div id="myIssues"></div><div id="pendingAlert"></div>`;
  let timer;
  state.selectedSku = null;
  $('#skuSearch').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(searchSku, 120); });
  $('#reportShortage').onclick = reportShortage;
  $('#refreshMine').onclick = loadMyIssues;
  state.liveRefresh.issue = async () => { await Promise.all([loadMyIssues(), loadPendingAlerts()]); };
  state.liveRefresh.catalog = async () => { if ($('#skuSearch')?.value.trim()) await searchSku(); };
  loadMyIssues();
  loadPendingAlerts();
  $('#skuSearch').focus();
}
async function searchSku() {
  const input = $('#skuSearch');
  const query = input?.value.trim();
  if (!query) { $('#skuResults').innerHTML = ''; return; }
  try {
    const data = await api('search-skus',{ query, limit:20 });
    $('#skuResults').innerHTML = data.items.map((item, index) => `<button data-result="${index}"><strong>${escapeHtml(item.sku)}</strong><span>${escapeHtml(item.product_name)}</span></button>`).join('');
    $$('[data-result]').forEach((button) => button.onclick = () => selectSku(data.items[Number(button.dataset.result)]));
  } catch (error) { message('#pickerMsg', safeMessage(error), 'error'); }
}
async function selectSku(item){state.selectedSku=item;$('#selectedSku').classList.remove('muted');$('#selectedSku').innerHTML=`<strong>SKU ${escapeHtml(item.sku)}</strong><span>${escapeHtml(item.product_name)}</span>`;$('#reportShortage').disabled=false;$('#skuResults').innerHTML='';}
async function reportShortage() {
  const item = state.selectedSku;
  if (!item || !confirm(`Báo thiếu SKU ${item.sku}?\n${item.product_name}`)) return;
  const button = $('#reportShortage');
  button.disabled = true;
  try {
    const result = await api('report-shortage',{ sku:item.sku, client_request_id:uuid() });
    message('#pickerMsg', result.already_reported ? 'SKU này đã có báo trước. Hệ thống đã ghi nhận báo của bạn.' : 'Đã được server xác nhận báo thiếu.', 'good');
    state.selectedSku = null;
    $('#skuSearch').value = '';
    $('#selectedSku').textContent = 'Chưa chọn SKU';
    $('#selectedSku').classList.add('muted');
    await loadMyIssues();
    $('#skuSearch').focus();
  } catch (error) { message('#pickerMsg', safeMessage(error), 'error'); }
  finally { button.disabled = !state.selectedSku; }
}
async function loadMyIssues() {
  const target = $('#myIssues'); if (!target) return;
  try {
    const data = await api('my-issues');
    target.innerHTML = data.issues.length ? data.issues.slice(0,50).map((issue) => `<article class="card"><strong>${escapeHtml(statusLabel(issue.status))} · SKU ${escapeHtml(issue.sku)}</strong><p>${escapeHtml(issue.product_name)}</p><small>${formatTime(issue.reported_at)}</small></article>`).join('') : '<div class="card muted">Chưa có báo thiếu.</div>';
  } catch (error) { target.innerHTML = `<div class="message" data-type="error">${escapeHtml(safeMessage(error))}</div>`; }
}
async function loadPendingAlerts() {
  const target = $('#pendingAlert'); if (!target) return;
  try {
    const data = await api('pending-alerts');
    const event = data.events?.[0];
    if (!event) { target.innerHTML = ''; return; }
    await api('mark-alert-received',{ event_id:event.id }).catch(() => {});
    target.innerHTML = `<div class="alert-modal"><div><p class="eyebrow">CẢNH BÁO BẮT BUỘC XÁC NHẬN</p><h2>${escapeHtml(event.title)}</h2><p>${escapeHtml(event.message)}</p><p class="muted">Trạng thái server v${Number(event.issue_version || 1)}</p><button id="ackAlert" class="primary wide">ĐÃ HIỂU</button></div></div>`;
    await api('mark-alert-displayed',{ event_id:event.id }).catch(() => {});
    $('#ackAlert').onclick = async () => { try { setBusy(true,'Đang xác nhận…'); await api('ack-alert',{ event_id:event.id }); target.innerHTML=''; await loadMyIssues(); } catch (error) { alert(safeMessage(error)); } finally { setBusy(false); } };
  } catch (error) { target.innerHTML = `<div class="message" data-type="error">${escapeHtml(safeMessage(error))}</div>`; }
}

async function renderInventory(){return renderSku();}
async function renderReports(){
 $('#content').innerHTML=`<div class="heading"><div><p class="eyebrow">REPORT</p><h2>Báo cáo vận hành kho</h2></div></div><div id="reportBody"></div>`;try{const r=await api('reports-summary');$('#reportBody').innerHTML=`<div class="metrics"><article class="metric"><span>Lượt báo 30 ngày</span><strong>${Number(r.reports||0).toLocaleString('vi-VN')}</strong></article><article class="metric"><span>Ticket 30 ngày</span><strong>${Number(r.issues||0).toLocaleString('vi-VN')}</strong></article><article class="metric"><span>Đang mở</span><strong>${Number(r.active_now||0)}</strong></article><article class="metric"><span>Quá mốc phản hồi</span><strong>${Number(r.overdue_now||0)}</strong></article><article class="metric"><span>Trung vị nhận</span><strong>${r.median_claim_minutes??'—'} phút</strong></article><article class="metric"><span>P95 hoàn tất</span><strong>${r.p95_resolution_minutes??'—'} phút</strong></article></div><div class="panel-grid"><article class="card"><h3>24 giờ gần nhất</h3><p>Lượt báo: <b>${Number(r.last_24h?.reports||0)}</b> · Ticket: <b>${Number(r.last_24h?.issues||0)}</b> · Hoàn tất: <b>${Number(r.last_24h?.resolved||0)}</b></p><p>Có hàng/châm bù: <b>${Number(r.last_24h?.available||0)}</b> · Cho SKIP: <b>${Number(r.last_24h?.skipped||0)}</b></p></article><article class="card"><h3>Chất lượng xử lý</h3><p>Trung vị hoàn tất: <b>${r.median_resolution_minutes??'—'} phút</b> · P95: <b>${r.p95_resolution_minutes??'—'} phút</b></p><p>Tái phát: <b>${Number(r.recurrent_episodes||0)}</b> · Auto SKIP 30 ngày: <b>${Number(r.auto_skip_count_30d||0)}</b></p></article></div><article class="card"><h3>SKU phát sinh nhiều nhất</h3><div class="table-wrap"><table><thead><tr><th>SKU</th><th>Tên sản phẩm</th><th>Lượt báo</th></tr></thead><tbody>${(r.top_skus||[]).map(x=>`<tr><td><b>${escapeHtml(x.sku)}</b></td><td>${escapeHtml(x.product_name||'')}</td><td>${Number(x.reports||0)}</td></tr>`).join('')}</tbody></table></div></article>`;}catch(e){$('#reportBody').innerHTML=`<div class="message" data-type="error">${escapeHtml(safeMessage(e))}</div>`;}
}

async function renderSku(){
 const can=elevated();$('#content').innerHTML=`<div class="heading"><div><p class="eyebrow">CATALOG</p><h2>Danh mục SKU / tên hàng</h2></div></div><article class="card"><p class="muted">Chỉ lưu <b>SKU và tên sản phẩm</b>; không lưu số tồn, bin, số lượng chờ xuất hoặc vị trí.</p>${can?`<input id="catalogFile" type="file" accept=".xlsx"><button id="replaceCatalog" class="primary">CẬP NHẬT TỪ FILE TỒN BIN</button><div id="catalogMsg" class="message" hidden></div>`:''}<label>Tìm SKU / tên hàng<input id="catalogSearch" placeholder="Nhập SKU hoặc tên sản phẩm"></label><button id="catalogSearchBtn" class="secondary">TÌM</button><div id="catalogRows"></div></article>`;
 const load=async()=>{try{const q=$('#catalogSearch').value.trim();if(!q){$('#catalogRows').innerHTML='<p class="muted">Nhập từ khóa để tra cứu.</p>';return;}const d=await api('search-skus',{query:q,limit:100});$('#catalogRows').innerHTML=`<div class="table-wrap"><table><thead><tr><th>SKU</th><th>Tên sản phẩm</th></tr></thead><tbody>${d.items.map(i=>`<tr><td><b>${escapeHtml(i.sku)}</b></td><td>${escapeHtml(i.product_name)}</td></tr>`).join('')}</tbody></table></div>`;}catch(e){$('#catalogRows').innerHTML=`<div class="message" data-type="error">${escapeHtml(safeMessage(e))}</div>`;}};$('#catalogSearchBtn').onclick=load;$('#catalogSearch').addEventListener('keydown',e=>{if(e.key==='Enter')load();});state.liveRefresh.catalog=load;
 if(can)$('#replaceCatalog').onclick=async()=>{const f=$('#catalogFile').files?.[0];if(!f)return message('#catalogMsg','Chọn file XLSX trước.','error');if(f.size>MAX_FILE_BYTES)return message('#catalogMsg','File vượt giới hạn 20 MB.','error');try{setBusy(true,'Đang đọc SKU và tên sản phẩm…');const X=await getExcelJS(),wb=new X.Workbook();await wb.xlsx.load(await f.arrayBuffer());const sh=wb.worksheets[0];if(!sh)throw new Error('File không có worksheet.');const h=new Map();sh.getRow(1).eachCell((c,col)=>h.set(normalize(c.text),col));const find=a=>a.map(normalize).map(x=>h.get(x)).find(Boolean),sc=find(['sku','mã sku','ma sku']),nc=find(['tên sku','ten sku','tên sản phẩm','ten san pham','tên hàng','ten hang','product name','sku name']);if(!sc||!nc)throw new Error('File phải có cột SKU và Tên SKU/Tên sản phẩm.');const m=new Map();for(let r=2;r<=sh.rowCount;r++){const sku=String(sh.getRow(r).getCell(sc).text||'').trim(),name=String(sh.getRow(r).getCell(nc).text||'').trim();if(!sku&&!name)continue;if(!sku||!name)throw new Error(`Dòng ${r}: thiếu SKU hoặc tên sản phẩm`);if(m.has(sku)&&m.get(sku)!==name)throw new Error(`SKU ${sku} có nhiều tên khác nhau`);m.set(sku,name);}if(!m.size)throw new Error('Không tìm thấy SKU hợp lệ.');const items=[...m].map(([sku,product_name])=>({sku,product_name})),res=await api('replace-catalog',{items,source_name:f.name});message('#catalogMsg',`Đã cập nhật ${Number(res.active_count||items.length).toLocaleString('vi-VN')} SKU · phiên ${res.revision}.`,'good');}catch(e){message('#catalogMsg',safeMessage(e),'error');}finally{setBusy(false);}};
}
async function renderUsers(){
 $('#content').innerHTML=`<div class="heading"><div><p class="eyebrow">STAFF</p><h2>Nhân sự & quyền</h2></div><button id="staffSync" class="secondary">ĐỒNG BỘ NGUỒN NGAY</button></div><div id="staffStatus"></div><div id="usersBody"></div>`;
 const load=async()=>{try{const [d,st]=await Promise.all([api('list-users'),api('staff-sync-status')]);state.managedUsers=d.users||[];const last=st.runs?.[0];$('#staffStatus').innerHTML=`<article class="card"><b>Nguồn DANH MỤC NHÂN SỰ</b><p>${last?`${escapeHtml(last.status)} · ${formatTime(last.finished_at)} · ${Number(last.eligible_rows||0)} nhân sự hợp lệ`:'Chưa đồng bộ.'}</p><p class="muted">Site 1291 / Kho HY1. Chuyên viên, Trưởng nhóm, Trưởng kho → Admin Invent; còn lại → Picker. 6281280 được bảo vệ tuyệt đối. Nhân sự mất khỏi nguồn chỉ ngừng hoạt động, lịch sử vẫn giữ.</p></article>`;$('#usersBody').innerHTML=`<div class="table-wrap"><table><thead><tr><th>User</th><th>Họ tên</th><th>Vị trí</th><th>Quyền</th><th>Nguồn</th><th>Trạng thái</th></tr></thead><tbody>${state.managedUsers.map(u=>`<tr><td><b>${escapeHtml(u.employee_code)}</b>${u.protected_account?' 🔒':''}</td><td>${escapeHtml(u.full_name)}</td><td>${escapeHtml(u.source_position||'—')}</td><td>${escapeHtml(ROLES[u.role]||u.role)}</td><td>${u.source_kind==='GSHEET'?'Google Sheet':'Tạo thêm'}</td><td>${u.active?'Hoạt động':'Ngừng'}</td></tr>`).join('')}</tbody></table></div><article class="card"><h3>Tạo thêm tài khoản ngoài danh sách nguồn</h3><p class="muted">${role()==='ADMIN_INVENT'?'Admin Invent chỉ được tạo thêm Picker.':'Admin hệ thống được tạo Admin Invent, Người báo hàng hoặc Picker.'} Nếu bỏ trống mật khẩu, server dùng mật khẩu mặc định lưu an toàn.</p><div class="form-grid"><label>Mã nhân viên<input id="newCode"></label><label>Họ tên<input id="newName"></label><label>Nhà thầu<input id="newContractor"></label><label>Quyền<select id="newRole">${(role()==='ADMIN'?['ADMIN_INVENT','INVENT','PICKER']:['PICKER']).map(r=>`<option value="${r}">${ROLES[r]}</option>`).join('')}</select></label><label>Mật khẩu riêng (không bắt buộc)<input id="newPassword" type="password" autocomplete="new-password"></label></div><button id="createExtraUser" class="primary">TẠO TÀI KHOẢN</button><div id="userMsg" class="message" hidden></div></article>`;$('#createExtraUser').onclick=async()=>{try{const item={employee_code:$('#newCode').value.trim(),full_name:$('#newName').value.trim(),contractor:$('#newContractor').value.trim(),role:$('#newRole').value,active:true,initial_password:$('#newPassword').value},r=await api('import-users',{items:[item]});if(r.failed)throw new Error(r.errors?.[0]||'Không tạo được tài khoản');message('#userMsg','Đã tạo tài khoản.','good');await load();}catch(e){message('#userMsg',safeMessage(e),'error');}};}catch(e){$('#usersBody').innerHTML=`<div class="message" data-type="error">${escapeHtml(safeMessage(e))}</div>`;}};
 state.liveRefresh.staff=load;
 $('#staffSync').onclick=async()=>{try{setBusy(true,'Đang đồng bộ DANH MỤC NHÂN SỰ…');const r=await api('staff-sync-now');alert(`Đồng bộ ${r.status}: tạo ${r.created||0}, cập nhật ${r.updated||0}, ngừng ${r.deactivated||0}, lỗi ${r.failed||0}.`);await load();}catch(e){alert(safeMessage(e));}finally{setBusy(false);}};load();
}
async function editUser(id) {
  const user=state.managedUsers.find((u)=>u.id===id);if(!user)return;
  const allowed=user.role==='ADMIN'?['ADMIN']:(role()==='ADMIN'?['ADMIN_INVENT','INVENT','PICKER']:['INVENT','PICKER']);
  const fullName=prompt('Họ tên:',user.full_name);if(fullName===null)return;
  const contractor=prompt('Nhà thầu:',user.contractor||'');if(contractor===null)return;
  const selectedRole=prompt(`Quyền (${allowed.join(' / ')}):`,user.role)?.trim().toUpperCase();if(!selectedRole||!allowed.includes(selectedRole))return alert('Quyền không hợp lệ.');
  const active=user.role==='ADMIN'?true:confirm('OK = tài khoản HOẠT ĐỘNG. Cancel = KHÓA tài khoản.');
  const password=prompt('Mật khẩu mới (để trống nếu giữ nguyên):','');if(password===null)return;
  try{setBusy(true,'Đang cập nhật nhân sự…');await api('update-user',{id:user.id,employee_code:user.employee_code,full_name:fullName.trim(),contractor:contractor.trim(),role:selectedRole,active,new_password:password});await renderUsers();}catch(error){alert(safeMessage(error));}finally{setBusy(false);}
}

async function renderBackupAccounts(){
  $('#content').innerHTML=`<div class="heading"><div><p class="eyebrow">RECOVERY IDENTITY</p><h2>Tài khoản dự phòng</h2></div><button id="newBackup" class="primary">TẠO TÀI KHOẢN</button></div><article class="card"><p>Tài khoản kỹ thuật dùng khi Service lỗi, tách hoàn toàn khỏi nhân sự và báo cáo năng suất. Mật khẩu không được lưu trên Web/Sheet.</p></article><div id="backupBody"></div>`;
  const load=async()=>{try{const d=await api('backup-account-list');const rows=d.accounts||[];$('#backupBody').innerHTML=rows.length?rows.map(a=>`<article class="card"><strong>${escapeHtml(a.username)} · ${escapeHtml(a.display_name)}</strong><p>${escapeHtml(ROLES[a.role]||a.role)} · ${escapeHtml(a.status)} · thiết bị: ${escapeHtml(a.device_scope||'*')}</p><small>Hết hạn: ${a.expires_at?formatTime(a.expires_at):'Không đặt'}</small><div class="actions">${a.status==='ACTIVE'?`<button class="secondary" data-reset-backup="${a.id}">ĐẶT LẠI MẬT KHẨU</button><button class="danger" data-lock-backup="${a.id}">KHÓA</button>`:`<button class="primary" data-unlock-backup="${a.id}">MỞ KHÓA + ĐẶT MẬT KHẨU</button>`}</div></article>`).join(''):'<div class="card muted">Chưa có tài khoản dự phòng.</div>';$$('[data-lock-backup]').forEach(b=>b.onclick=async()=>{if(!confirm('Khóa tài khoản dự phòng này?'))return;try{await api('backup-account-lock',{id:b.dataset.lockBackup});await load();}catch(e){alert(safeMessage(e));}});$$('[data-reset-backup]').forEach(b=>b.onclick=()=>backupPasswordAction('reset',b.dataset.resetBackup,load));$$('[data-unlock-backup]').forEach(b=>b.onclick=()=>backupPasswordAction('unlock',b.dataset.unlockBackup,load));}catch(e){$('#backupBody').innerHTML=`<div class="message" data-type="error">${escapeHtml(safeMessage(e))}</div>`;}};
  $('#newBackup').onclick=async()=>{const username=prompt('Username dự phòng (chữ thường, số, . _ -):')?.trim().toLowerCase();if(!username)return;const display_name=prompt('Tên hiển thị:')?.trim();if(!display_name)return;const roleValue=prompt('Vai trò: ADMIN / ADMIN_INVENT / INVENT / PICKER','INVENT')?.trim().toUpperCase();if(!roleValue)return;const device_scope=prompt('Device scope (* hoặc device ID cụ thể):','*')?.trim()||'*';const days=Number(prompt('Thời hạn tài khoản (ngày):','30')||30);const password=prompt('Mật khẩu dự phòng (ít nhất 14 ký tự):')||'';if(password.length<14)return alert('Mật khẩu cần ít nhất 14 ký tự.');try{await api('backup-account-create',{username,display_name,role:roleValue,device_scope,password,expires_at:new Date(Date.now()+Math.max(1,days)*86400000).toISOString()});await load();}catch(e){alert(safeMessage(e));}};
  load();
}
async function backupPasswordAction(action,id,done){const password=prompt('Mật khẩu mới (ít nhất 14 ký tự):')||'';if(password.length<14)return alert('Mật khẩu cần ít nhất 14 ký tự.');try{await api(`backup-account-${action}`,{id,password});await done();}catch(e){alert(safeMessage(e));}}

async function renderDevices() {
  $('#content').innerHTML = `<div class="heading"><div><p class="eyebrow">DEVICE</p><h2>Thiết bị & thông báo</h2></div></div><div id="deviceBody" class="card muted">Đang tải…</div>`;
  try {
    const logs = await api('list-logs',{limit:50});
    $('#deviceBody').innerHTML = `<p>Log thiết bị gần đây là nguồn chẩn đoán; FCM accepted không được coi là thiết bị đã nhận nếu chưa có client_received/ACK.</p>${logs.logs.length ? `<div class="table-wrap"><table><thead><tr><th>User</th><th>Thiết bị</th><th>App</th><th>Thời gian</th></tr></thead><tbody>${logs.logs.map(l=>`<tr><td>${escapeHtml(l.employee_code)}</td><td>${escapeHtml(l.device_name)}</td><td>${escapeHtml(l.app_version)}</td><td>${formatTime(l.created_at)}</td></tr>`).join('')}</tbody></table></div>` : '<p>Chưa có log thiết bị gần đây.</p>'}`;
  } catch(error){$('#deviceBody').innerHTML=`<div class="message" data-type="error">${escapeHtml(safeMessage(error))}</div>`;}
}

async function renderIntegrations(){
 $('#content').innerHTML=`<div class="heading"><div><p class="eyebrow">SYSTEM</p><h2>Hệ thống & dung lượng</h2></div></div><div id="serviceBody"></div>`;try{const d=await api('service-metrics'),u=d.usage||{},l=d.free_limits||{},db=Number(u.database_bytes||0),lim=Number(l.database_bytes||1);$('#serviceBody').innerHTML=`<div class="metrics"><article class="metric"><span>Database</span><strong>${(db/1048576).toFixed(1)} MB</strong></article><article class="metric"><span>SKU hoạt động</span><strong>${Number(u.sku_active||0).toLocaleString('vi-VN')}</strong></article><article class="metric"><span>Nhân sự hoạt động</span><strong>${Number(u.profiles_active||0)}</strong></article><article class="metric"><span>Thiết bị FCM</span><strong>${Number(u.active_device_tokens||0)}</strong></article></div><div class="panel-grid"><article class="card"><h3>Ngưỡng kiểm soát 0 đồng</h3><p>Database: ${(db/lim*100).toFixed(1)}% / 500 MB</p><p>Storage: 1 GB · Egress: 5 GB/tháng · MAU: 50.000/tháng · Edge Functions: 500.000 lượt/tháng · Realtime: 2.000.000 message/tháng · 200 kết nối đồng thời · tối đa 2 project active.</p><p class="muted">Thông tin dùng để cảnh báo vận hành; hệ thống không tự bật Billing.</p></article><article class="card"><h3>Dữ liệu kỹ thuật</h3><p>Notification events: ${Number(u.notification_events||0).toLocaleString('vi-VN')}</p><p>Diagnostic log: ${(Number(u.diagnostic_log_bytes||0)/1048576).toFixed(2)} MB</p><p>Google Sheet chờ: ${Number(u.sheet_pending||0)}</p><p>Catalog revision: ${Number(u.catalog_revision||0)}</p></article></div>`;}catch(e){$('#serviceBody').innerHTML=`<div class="message" data-type="error">${escapeHtml(safeMessage(e))}</div>`;}
}

async function renderLogs() {
  $('#content').innerHTML = `<div class="heading"><div><p class="eyebrow">AUDIT</p><h2>Log & audit</h2></div><button id="refreshLogs" class="secondary">Làm mới</button></div><div class="panel-grid"><section><h3>Log thiết bị</h3><div id="logs"></div></section><section><h3>Audit nghiệp vụ</h3><div id="audit"></div></section></div>`;
  $('#refreshLogs').onclick=renderLogs;
  try{const [logs,audit]=await Promise.all([api('list-logs',{limit:100}),api('audit-history',{limit:150})]);$('#logs').innerHTML=logs.logs.length?logs.logs.map(l=>`<article class="card log"><div><strong>${escapeHtml(l.employee_code)} · ${escapeHtml(l.device_name)}</strong><span>${escapeHtml(l.app_version)} · ${formatTime(l.created_at)}</span><small>${Number(l.compressed_bytes||0).toLocaleString('vi-VN')} bytes · SHA ${escapeHtml(String(l.sha256).slice(0,12))}</small></div><button class="secondary" data-log="${l.id}">TẢI</button></article>`).join(''):'<div class="card muted">Chưa có log.</div>';$$('[data-log]').forEach(b=>b.onclick=()=>downloadLog(b.dataset.log));$('#audit').innerHTML=audit.audit.length?audit.audit.map(a=>`<article class="card"><strong>${escapeHtml(a.action)}</strong><p>${escapeHtml(a.from_status||'—')} → ${escapeHtml(a.to_status||'—')}</p><small>${formatTime(a.created_at)} · issue ${escapeHtml(String(a.issue_id).slice(0,8))}</small></article>`).join(''):'<div class="card muted">Chưa có audit.</div>';}catch(error){$('#logs').innerHTML=`<div class="message" data-type="error">${escapeHtml(safeMessage(error))}</div>`;}
}
async function downloadLog(id){try{setBusy(true,'Đang tạo link tải log…');const r=await api('download-log',{id});location.href=r.url;}catch(error){alert(safeMessage(error));}finally{setBusy(false);}}

async function renderSla(){
 $('#content').innerHTML=`<div class="heading"><div><p class="eyebrow">SLA</p><h2>Mốc thời gian vận hành</h2></div></div><div id="slaBody"></div>`;
 try{const c=await api('get-operational-config');$('#slaBody').innerHTML=`<article class="card"><div class="form-grid"><label>Thời gian nhận xử lý (phút)<input id="ackMin" type="number" min="1" max="480" value="${c.acknowledge_minutes}"></label><label>Chu kỳ nhắc xử lý (phút)<input id="reminderMin" type="number" min="1" max="480" value="${c.reminder_minutes}"></label><label>Thời gian châm hàng (phút)<input id="replenishMin" type="number" min="1" max="480" value="${c.replenish_minutes}"></label><label>Nhắc Picker xác nhận (phút)<input id="pickerAckMin" type="number" min="1" max="60" value="${c.picker_ack_reminder_minutes}"></label></div><p class="muted">Hết mốc chỉ nhắc/escalate. Hệ thống không tự cho phép SKIP.</p><button id="saveSla" class="primary">LƯU MỐC THỜI GIAN</button><div id="slaMsg" class="message" hidden></div></article>`;$('#saveSla').onclick=async()=>{try{await api('save-operational-config',{acknowledge_minutes:Number($('#ackMin').value),reminder_minutes:Number($('#reminderMin').value),replenish_minutes:Number($('#replenishMin').value),picker_ack_reminder_minutes:Number($('#pickerAckMin').value),auto_skip_enabled:false,auto_skip_after_minutes:0});message('#slaMsg','Đã lưu mốc thời gian.','good');}catch(e){message('#slaMsg',safeMessage(e),'error');}};}catch(e){$('#slaBody').innerHTML=`<div class="message" data-type="error">${escapeHtml(safeMessage(e))}</div>`;}
}

async function renderConfig(){
 $('#content').innerHTML=`<div class="heading"><div><p class="eyebrow">CONFIG</p><h2>Cấu hình hệ thống</h2></div></div><div id="configBody"></div>`;
 try{const c=await api('get-config');$('#configBody').innerHTML=`<article class="card"><p><b>Retention nghiệp vụ: 45 ngày</b></p><p class="muted">OPEN/CLAIMED, event chưa ACK và conflict không bị xóa theo tuổi.</p><div class="form-grid"><label>Lưu log chẩn đoán (ngày)<input id="logDays" type="number" min="1" max="30" value="${c.diagnostic_log_retention_days}"></label><label class="check"><input id="staffAuto" type="checkbox" ${c.staff_auto_sync_enabled?'checked':''}>Tự động đồng bộ nhân sự</label><label>Chu kỳ đồng bộ nhân sự (phút)<input id="staffInterval" type="number" min="30" max="1440" value="${c.staff_sync_interval_minutes}"></label></div><button id="saveConfig" class="primary">LƯU CẤU HÌNH</button><div id="cfgMsg" class="message" hidden></div></article>`;$('#saveConfig').onclick=async()=>{try{await api('save-config',{retention_days:45,diagnostic_log_retention_days:Number($('#logDays').value),staff_auto_sync_enabled:$('#staffAuto').checked,staff_sync_interval_minutes:Number($('#staffInterval').value),auto_skip_enabled:false,auto_skip_after_minutes:0});message('#cfgMsg','Đã lưu cấu hình.','good');}catch(e){message('#cfgMsg',safeMessage(e),'error');}};}catch(e){$('#configBody').innerHTML=`<div class="message" data-type="error">${escapeHtml(safeMessage(e))}</div>`;}
}

async function renderVersions(){
  $('#content').innerHTML=`<div class="heading"><div><p class="eyebrow">RELEASE</p><h2>Phiên bản</h2></div></div><article class="card"><h3>OTA</h3><p>Stable và Beta được khóa channel trong APK, signer và SHA được workflow release kiểm tra trước publish.</p><p class="muted">Release mới vẫn đi qua workflow production đã harden; Web không chứa signing key.</p></article><article class="card"><h3>Runtime</h3><p>Dùng mục Thiết bị & thông báo / Log để đối chiếu app version đang chạy. Không coi file build là đã triển khai nếu chưa có evidence runtime.</p></article>`;
}

state.session = readSession();
if (state.session) renderApp(); else renderLogin();
