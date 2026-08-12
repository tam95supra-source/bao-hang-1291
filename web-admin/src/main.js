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
  ADMIN_INVENT: 'Admin Event',
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
  inventoryChannel: null,
  realtimeStatus: 'OFFLINE',
  fallbackTimer: null,
  refreshTimer: null,
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
  clearTimeout(state.refreshTimer);
  state.refreshTimer = null;
  const channels = [state.issueChannel, state.inventoryChannel].filter(Boolean);
  state.issueChannel = null;
  state.inventoryChannel = null;
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

function renderLogin(msg = '') {
  stopRealtime();
  document.body.innerHTML = `<main class="login-shell"><section class="login-card">
    <div class="brand">1291</div><p class="eyebrow">BÁO HÀNG 1291</p><h1>Web nghiệp vụ</h1>
    <p class="muted">Đăng nhập bằng tài khoản Báo hàng 1291.</p>
    <form id="loginForm"><label>Mã nhân viên<input id="employeeCode" required autocomplete="username"></label>
    <label>Mật khẩu<input id="password" type="password" required autocomplete="current-password"></label>
    <button class="primary wide">ĐĂNG NHẬP</button></form><div id="loginMessage" class="message" hidden></div>
    <p class="security">Quyền được kiểm tra tại server. Web không chứa service-role key, credential Supra hoặc private key.</p>
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
  if (currentRole === 'ADMIN') return [
    ['overview','Tổng quan'],['events','Sự kiện'],['inventory','Tồn bin'],['reports','Báo cáo'],['users','Nhân sự & quyền'],
    ['devices','Thiết bị & thông báo'],['integrations','Tích hợp'],['logs','Log & audit'],['config','Cấu hình'],['versions','Phiên bản'],
  ];
  if (currentRole === 'ADMIN_INVENT') return [
    ['overview','Tổng quan'],['events','Sự kiện'],['inventory','Tồn bin'],['reports','Báo cáo'],['sku','SKU'],['users','Nhân sự'],['logs','Log'],['sla','SLA vận hành'],
  ];
  if (currentRole === 'INVENT') return [['events','Sự kiện'],['inventory','Tồn bin']];
  return [['picker','Picker']];
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
      ${healthChip('SERVICE','ONLINE','good')}${healthChip('REALTIME','ĐANG NỐI')}${healthChip('SHEET','—')}${healthChip('TỒN BIN','—')}
    </div></div><div class="user"><strong>${escapeHtml(profile.full_name)}</strong><span>${escapeHtml(profile.employee_code)} · ${escapeHtml(ROLES[currentRole] || currentRole)}</span><button id="logout" class="ghost">Đăng xuất</button></div></header>
    ${state.testRole ? `<div class="test-banner">ĐANG KIỂM THỬ QUYỀN: <strong>${escapeHtml(ROLES[state.testRole])}</strong> · API cũng bị hạ quyền tương ứng. <button id="exitTest">Thoát kiểm thử</button></div>` : ''}
    ${actualRole() === 'ADMIN' && !state.testRole ? `<div class="test-tools"><span>Kiểm thử giao diện + quyền server:</span><button data-test="ADMIN_INVENT">Admin Event</button><button data-test="INVENT">Người báo hàng</button><button data-test="PICKER">Picker</button></div>` : ''}
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
  $$('[data-tab]').forEach((button) => button.classList.toggle('active', button.dataset.tab === state.activeTab));
  const handlers = {
    overview: renderOverview, events: renderEvents, picker: renderPicker, inventory: renderInventory, reports: renderReports,
    sku: renderSku, users: renderUsers, devices: renderDevices, integrations: renderIntegrations, logs: renderLogs,
    sla: renderSla, config: renderConfig, versions: renderVersions,
  };
  handlers[state.activeTab]?.();
}
function scheduleLiveRefresh(kind) {
  if (document.hidden) return;
  clearTimeout(state.refreshTimer);
  state.refreshTimer = setTimeout(() => {
    if (kind === 'inventory' && ['inventory','overview'].includes(state.activeTab)) renderTab();
    if (kind === 'issue' && ['events','overview','picker'].includes(state.activeTab)) renderTab();
  }, 180);
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
  state.issueChannel = realtimeClient.channel('site:1291:issues', { config: { private: true } })
    .on('broadcast', { event: 'issue_changed' }, () => scheduleLiveRefresh('issue'))
    .subscribe(subscribeStatus);
  state.inventoryChannel = realtimeClient.channel('site:1291:inventory', { config: { private: true } })
    .on('broadcast', { event: 'snapshot_published' }, () => scheduleLiveRefresh('inventory'))
    .subscribe(subscribeStatus);
  setTimeout(() => { if (state.realtimeStatus !== 'ONLINE') ensureFallbackPolling(); }, 6000);
}
function ensureFallbackPolling() {
  if (state.fallbackTimer || document.hidden || !state.session) return;
  state.fallbackTimer = setInterval(() => {
    if (document.hidden) return;
    if (['events','picker','inventory','overview'].includes(state.activeTab)) renderTab();
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

async function renderOverview() {
  $('#content').innerHTML = `<div class="heading"><div><p class="eyebrow">LIVE</p><h2>Tổng quan vận hành</h2></div><button id="refresh" class="secondary">Làm mới</button></div><div id="metrics" class="metrics"></div><div id="overviewStatus"></div>`;
  $('#refresh').onclick = renderOverview;
  try {
    const data = await api('admin-summary');
    $('#metrics').innerHTML = [
      ['Chờ nhận',data.open_issue_count],['Đang xử lý',data.claimed_issue_count],['SKU master',data.sku_count],['Nhân sự hoạt động',data.active_user_count],['Chờ Sheet',data.pending_sheet_count],['Log',data.diagnostic_log_count],
    ].map(([label,value]) => `<article class="metric"><span>${label}</span><strong>${Number(value || 0).toLocaleString('vi-VN')}</strong></article>`).join('');
    const snap = data.inventory_snapshot;
    $('#overviewStatus').innerHTML = `<div class="panel-grid"><article class="card"><h3>Google Sheet</h3><p>${data.pending_sheet_count ? `<b class="bad-text">${data.pending_sheet_count} đang chờ</b>` : 'Không có hàng đợi đang chờ.'}</p><button id="syncSheet" class="secondary">ĐỒNG BỘ NGAY</button><div id="overviewMsg" class="message" hidden></div></article>
      <article class="card"><h3>Tồn bin</h3>${snap ? `<p>Snapshot: ${formatTime(snap.source_captured_at)}</p><p>${Number(snap.normalized_row_count || 0).toLocaleString('vi-VN')} dòng chuẩn hóa · hash ${escapeHtml(String(snap.sha256 || '').slice(0,12))}</p>` : '<p class="muted">Chưa có snapshot.</p>'}</article></div>`;
    $('#syncSheet').onclick = async () => { try { setBusy(true,'Đang đồng bộ Google Sheet…'); const result = await api('sync-google-sheet'); message('#overviewMsg', `Đã xuất ${result.exported || 0}; còn ${result.remaining || 0} sự kiện.`, 'good'); } catch (error) { message('#overviewMsg', safeMessage(error), 'error'); } finally { setBusy(false); } };
    const sheetEl = $('[data-health="SHEET"]'); if (sheetEl) { $('em', sheetEl).textContent = data.pending_sheet_count ? `${data.pending_sheet_count} CHỜ` : 'OK'; sheetEl.className = `health-chip ${data.pending_sheet_count ? 'warn' : 'good'}`; }
    const invEl = $('[data-health="TỒN BIN"]'); if (invEl) { $('em', invEl).textContent = snap ? formatAge(snap.source_captured_at) : 'CHƯA CÓ'; invEl.className = `health-chip ${snap ? '' : 'warn'}`; }
  } catch (error) { $('#metrics').innerHTML = `<div class="message" data-type="error">${escapeHtml(safeMessage(error))}</div>`; }
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
  const draw = () => {
    const rows = board?.[bucket] || [];
    $('#board').innerHTML = rows.length ? rows.map((issue) => issueCard(issue, bucket)).join('') : `<div class="card muted">Không có SKU ở nhóm này.</div>`;
    $$('[data-claim]').forEach((b) => b.onclick = () => claimIssue(b.dataset.claim, load));
    $$('[data-action]').forEach((b) => b.onclick = () => issueAction(b.dataset.issue, b.dataset.action, b.dataset.sku, load));
    $$('[data-reassign]').forEach((b) => b.onclick = () => openReassign(b.dataset.reassign, b.dataset.sku, load));
  };
  const load = async () => {
    try { board = await api('issue-board'); draw(); }
    catch (error) { $('#board').innerHTML = `<div class="message" data-type="error">${escapeHtml(safeMessage(error))}</div>`; }
  };
  $('#refreshBoard').onclick = load;
  $$('[data-bucket]').forEach((b) => b.onclick = () => { bucket = b.dataset.bucket; $$('[data-bucket]').forEach((x) => x.classList.toggle('active', x === b)); draw(); });
  load();
}
function issueCard(issue, bucket) {
  const recurrence = issue.recurrence_30m ? '<span class="badge warn">TÁI PHÁT ≤30 PHÚT</span>' : '';
  const assignment = issue.assigned_name ? ` · Xử lý: ${escapeHtml(issue.assigned_name)}` : '';
  const header = `<article class="card issue"><div class="issue-top"><div><strong>SKU ${escapeHtml(issue.sku)}</strong><span>${Number(issue.report_count || 1)} lượt · v${Number(issue.issue_version || 1)}</span></div><time>${formatTime(issue.reported_at)}</time></div><p>${escapeHtml(issue.product_name)}</p><small>${escapeHtml(statusLabel(issue.status))}${assignment}</small>${recurrence}`;
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
    <div id="selectedSku" class="selected muted">Chưa chọn SKU</div><div id="stockHint"></div><button id="reportShortage" class="danger wide" disabled>BÁO THIẾU</button><div id="pickerMsg" class="message" hidden></div></div>
    <div class="heading compact"><h3>Báo gần đây của tôi</h3><button id="refreshMine" class="secondary">Làm mới</button></div><div id="myIssues"></div><div id="pendingAlert"></div>`;
  let timer;
  state.selectedSku = null;
  $('#skuSearch').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(searchSku, 120); });
  $('#reportShortage').onclick = reportShortage;
  $('#refreshMine').onclick = loadMyIssues;
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
async function selectSku(item) {
  state.selectedSku = item;
  $('#selectedSku').classList.remove('muted');
  $('#selectedSku').innerHTML = `<strong>SKU ${escapeHtml(item.sku)}</strong><span>${escapeHtml(item.product_name)}</span>`;
  $('#reportShortage').disabled = false;
  $('#skuResults').innerHTML = '';
  try {
    const stock = await api('inventory-status',{ sku:item.sku });
    const map = {
      AVAILABLE:'CÓ THỂ CÒN TỒN', ZERO:'KHÔNG CÒN TỒN KHẢ DỤNG', STALE:'DỮ LIỆU TỒN ĐÃ CŨ', NO_DATA:'CHƯA CÓ DỮ LIỆU TỒN',
    };
    const warning = stock.freshness_status === 'STALE' ? '<b>KHÔNG DÙNG SỐ TỒN NÀY ĐỂ QUYẾT ĐỊNH.</b>' : '';
    $('#stockHint').innerHTML = `<div class="stock-hint ${stock.stock_status === 'STALE' ? 'warn' : ''}"><strong>${map[stock.stock_status] || 'CHƯA XÁC ĐỊNH'}</strong><span>Snapshot: ${formatTime(stock.snapshot_captured_at)}</span>${warning}</div>`;
  } catch { $('#stockHint').innerHTML = '<div class="stock-hint warn">Không lấy được trạng thái tồn. Picker vẫn được phép báo thiếu.</div>'; }
}
async function reportShortage() {
  const item = state.selectedSku;
  if (!item || !confirm(`Báo thiếu SKU ${item.sku}?\n${item.product_name}`)) return;
  const button = $('#reportShortage');
  button.disabled = true;
  try {
    const result = await api('report-shortage',{ sku:item.sku, client_request_id:uuid() });
    message('#pickerMsg', result.already_reported ? `SKU đã có báo trước. Đã ghi thêm lượt của bạn; tổng ${result.issue.report_count} lượt.` : 'Đã được server xác nhận báo thiếu.', 'good');
    state.selectedSku = null;
    $('#skuSearch').value = '';
    $('#selectedSku').textContent = 'Chưa chọn SKU';
    $('#selectedSku').classList.add('muted');
    $('#stockHint').innerHTML = '';
    await loadMyIssues();
    $('#skuSearch').focus();
  } catch (error) { message('#pickerMsg', safeMessage(error), 'error'); }
  finally { button.disabled = !state.selectedSku; }
}
async function loadMyIssues() {
  const target = $('#myIssues'); if (!target) return;
  try {
    const data = await api('my-issues');
    target.innerHTML = data.issues.length ? data.issues.slice(0,50).map((issue) => `<article class="card"><strong>${escapeHtml(statusLabel(issue.status))} · SKU ${escapeHtml(issue.sku)}</strong><p>${escapeHtml(issue.product_name)}</p><small>${Number(issue.report_count || 1)} lượt · ${formatTime(issue.reported_at)}</small></article>`).join('') : '<div class="card muted">Chưa có báo thiếu.</div>';
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

async function renderInventory() {
  const exact = role() !== 'PICKER';
  $('#content').innerHTML = `<div class="heading"><div><p class="eyebrow">INVENTORY</p><h2>Tồn bin</h2></div><button id="refreshInventory" class="secondary">Làm mới</button></div>
    <div id="inventorySummary"></div>${exact ? `<div class="card"><label>Tìm SKU<input id="inventorySearch" placeholder="Nhập SKU"></label><button id="inventorySearchBtn" class="secondary">TÌM</button><div id="inventoryRows"></div></div>` : ''}
    ${elevated() ? `<div class="panel-grid"><article class="card"><h3>Đồng bộ từ Supra</h3><p class="muted">Chỉ chạy khi credential + read-only POC đã xác minh contract JSON. Không suy đoán schema.</p><button id="syncSupra" class="primary">ĐỒNG BỘ TỪ SUPRA</button><div id="supraSyncMsg" class="message" hidden></div></article>
    <article class="card"><h3>Recovery XLSX</h3><p class="muted">Fallback có kiểm soát; dùng cùng staging/finalize nguyên tử.</p><input id="inventoryFile" type="file" accept=".xlsx"><button id="importInventory" class="secondary">IMPORT SNAPSHOT XLSX</button><div id="inventoryImportMsg" class="message" hidden></div></article></div>` : ''}`;
  $('#refreshInventory').onclick = renderInventory;
  if (elevated()) {
    $('#syncSupra').onclick = async () => { try { setBusy(true,'Đang khởi tạo job Supra…'); await api('inventory-sync-start',{ client_request_id:uuid() }); message('#supraSyncMsg','Job đã được tạo.','good'); } catch (error) { message('#supraSyncMsg',safeMessage(error),'error'); } finally { setBusy(false); } };
    $('#importInventory').onclick = importInventoryXlsx;
  }
  if (exact) {
    $('#inventorySearchBtn').onclick = loadInventoryRows;
    $('#inventorySearch').addEventListener('keydown',(event)=>{ if(event.key==='Enter') loadInventoryRows(); });
  }
  try {
    const summary = elevated() ? await api('inventory-summary') : null;
    if (summary) {
      const snap = summary.snapshot;
      $('#inventorySummary').innerHTML = `<div class="metrics"><article class="metric"><span>SKU hiện hành</span><strong>${Number(summary.current_sku_count || 0).toLocaleString('vi-VN')}</strong></article><article class="metric"><span>Freshness</span><strong>${escapeHtml(snap?.freshness_status || 'UNKNOWN')}</strong></article><article class="metric"><span>Kết nối Supra</span><strong>${escapeHtml(summary.connection?.status || 'DISABLED')}</strong></article></div>
        <article class="card"><b>Snapshot hiện hành</b><p>${snap ? `${formatTime(snap.source_captured_at)} · ${Number(snap.normalized_row_count || 0).toLocaleString('vi-VN')} dòng · hash ${escapeHtml(snap.sha256_short)}` : 'Chưa có snapshot.'}</p><div class="table-wrap"><table><thead><tr><th>Job</th><th>Trạng thái</th><th>Nguồn</th><th>Yêu cầu</th><th>Lỗi</th></tr></thead><tbody>${(summary.jobs||[]).map(j=>`<tr><td>${escapeHtml(j.id.slice(0,8))}</td><td>${escapeHtml(j.state)}</td><td>${escapeHtml(j.requested_source)}</td><td>${formatTime(j.requested_at)}</td><td>${escapeHtml(j.error_code||'')}</td></tr>`).join('')}</tbody></table></div></article>`;
    } else $('#inventorySummary').innerHTML = '<div class="card muted">Chọn SKU ở màn Picker để xem trạng thái tồn.</div>';
  } catch (error) { $('#inventorySummary').innerHTML = `<div class="message" data-type="error">${escapeHtml(safeMessage(error))}</div>`; }
  if (exact) loadInventoryRows();
}
async function loadInventoryRows() {
  const target = $('#inventoryRows'); if (!target) return;
  try {
    const data = await api('inventory-current',{ query:$('#inventorySearch')?.value.trim() || '', limit:200 });
    target.innerHTML = `<div class="table-wrap"><table><thead><tr><th>SKU</th><th>Tồn Bin pickable</th><th>Chờ xuất</th><th>Khả dụng</th><th>Khác</th><th>Freshness</th><th>Snapshot</th></tr></thead><tbody>${data.items.map(i=>`<tr><td>${escapeHtml(i.sku)}</td><td>${escapeHtml(i.pickable_bin_qty)}</td><td>${escapeHtml(i.pickable_pending_out_qty)}</td><td><b>${escapeHtml(i.pickable_available_qty)}</b></td><td>${escapeHtml(i.other_stock_qty)}</td><td>${escapeHtml(i.freshness_status)}</td><td>${formatTime(i.snapshot_captured_at)}</td></tr>`).join('')}</tbody></table></div>`;
  } catch (error) { target.innerHTML = `<div class="message" data-type="error">${escapeHtml(safeMessage(error))}</div>`; }
}
async function importInventoryXlsx() {
  const file = $('#inventoryFile')?.files?.[0];
  if (!file) return message('#inventoryImportMsg','Chọn file XLSX trước.','error');
  if (file.size > MAX_FILE_BYTES) return message('#inventoryImportMsg','File vượt giới hạn 20 MB.','error');
  try {
    setBusy(true,'Đang đọc và kiểm tra Tồn Bin…');
    const ExcelJS = await getExcelJS();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error('File không có worksheet.');
    const header = new Map();
    sheet.getRow(1).eachCell((cell, col) => header.set(normalize(cell.text), col));
    const requiredCols = ['sku','ton bin','ton cho xuat','tinh chat lt'];
    for (const key of requiredCols) if (!header.get(key)) throw new Error(`Thiếu cột bắt buộc: ${key}`);
    const binCodeCol = header.get('ma vtlt') || header.get('ma ptlt') || null;
    const items = [];
    for (let rowNo = 2; rowNo <= sheet.rowCount; rowNo++) {
      const row = sheet.getRow(rowNo);
      const sku = String(row.getCell(header.get('sku')).text || '').trim();
      if (!sku) continue;
      const binQty = Number(String(row.getCell(header.get('ton bin')).value ?? row.getCell(header.get('ton bin')).text ?? 0).replace(',','.'));
      const pendingRaw = row.getCell(header.get('ton cho xuat')).value ?? row.getCell(header.get('ton cho xuat')).text ?? 0;
      const pending = Number(String(pendingRaw || 0).replace(',','.')) || 0;
      if (!Number.isFinite(binQty) || binQty < 0 || pending < 0) throw new Error(`Dòng ${rowNo}: số tồn không hợp lệ.`);
      const storage = String(row.getCell(header.get('tinh chat lt')).text || '').trim();
      const storageNorm = normalize(storage);
      items.push({ row_key:String(rowNo), sku, bin_code:binCodeCol ? String(row.getCell(binCodeCol).text || '').trim() : '', storage_type:storage, is_pickable:['pickable','co the lay hang'].includes(storageNorm), bin_qty:binQty, pending_out_qty:pending });
    }
    if (!items.length) throw new Error('Không có dòng tồn hợp lệ.');
    const start = await api('inventory-recovery-start',{ client_request_id:uuid() });
    const jobId = start.job.id;
    let staged = 0;
    for (let index = 0; index < items.length; index += 500) {
      const batch = items.slice(index,index+500);
      const result = await api('inventory-recovery-stage',{ job_id:jobId, batch_index:index/500, items:batch });
      staged = Number(result.total_staged || staged + batch.length);
      $('#busyText').textContent = `Đã staging ${staged.toLocaleString('vi-VN')} / ${items.length.toLocaleString('vi-VN')} dòng…`;
    }
    const result = await api('inventory-recovery-finalize',{ job_id:jobId, source_captured_at:new Date(file.lastModified || Date.now()).toISOString() });
    message('#inventoryImportMsg',`Hoàn tất ${items.length.toLocaleString('vi-VN')} dòng · ${result.state}. Snapshot chỉ đổi sau finalize nguyên tử.`,'good');
    await renderInventory();
  } catch (error) { message('#inventoryImportMsg',safeMessage(error),'error'); }
  finally { setBusy(false); }
}

async function renderReports() {
  $('#content').innerHTML = `<div class="heading"><div><p class="eyebrow">REPORT</p><h2>Báo cáo vận hành</h2></div><button id="refreshReports" class="secondary">Làm mới</button></div><div id="reportMetrics" class="metrics"></div><div id="reportBody"></div>`;
  $('#refreshReports').onclick = renderReports;
  try {
    const data = await api('reports-summary');
    $('#reportMetrics').innerHTML = [
      ['Đợt báo thiếu',data.issues],['Tổng lượt báo',data.reports],['Claim median',data.median_claim_minutes == null ? '—' : `${data.median_claim_minutes}m`],['Xử lý median',data.median_resolution_minutes == null ? '—' : `${data.median_resolution_minutes}m`],['Xử lý P95',data.p95_resolution_minutes == null ? '—' : `${data.p95_resolution_minutes}m`],['Đợt tái phát',data.recurrent_episodes],
    ].map(([l,v])=>`<article class="metric"><span>${l}</span><strong>${escapeHtml(v)}</strong></article>`).join('');
    $('#reportBody').innerHTML = `<div class="panel-grid"><article class="card"><h3>Theo trạng thái</h3>${Object.entries(data.by_status||{}).map(([key,value])=>`<div class="row"><span>${escapeHtml(statusLabel(key))}</span><b>${value}</b></div>`).join('')}</article><article class="card"><h3>SKU báo nhiều</h3>${(data.top_skus||[]).slice(0,15).map(i=>`<div class="row"><span>${escapeHtml(i.sku)}</span><b>${i.reports}</b></div>`).join('')}</article></div>`;
  } catch (error) { $('#reportBody').innerHTML = `<div class="message" data-type="error">${escapeHtml(safeMessage(error))}</div>`; }
}

function renderSku() {
  $('#content').innerHTML = `<div class="heading"><div><p class="eyebrow">MASTER</p><h2>SKU</h2></div></div><article class="card"><p>Import SKU theo file Excel. Chỉ publish khi server chấp nhận từng batch.</p><input id="skuFile" type="file" accept=".xlsx"><button id="importSku" class="primary">IMPORT SKU</button><div id="skuMsg" class="message" hidden></div></article>`;
  $('#importSku').onclick = importSkuXlsx;
}
async function importSkuXlsx() {
  const file = $('#skuFile')?.files?.[0]; if (!file) return message('#skuMsg','Chọn file trước.','error');
  try {
    setBusy(true,'Đang đọc SKU…');
    const ExcelJS = await getExcelJS(); const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await file.arrayBuffer()); const ws=wb.worksheets[0];
    const h=new Map();ws.getRow(1).eachCell((c,i)=>h.set(normalize(c.text),i));const skuCol=h.get('sku'),nameCol=h.get('ten san pham');if(!skuCol||!nameCol)throw new Error('Thiếu cột SKU hoặc Tên sản phẩm.');
    const map=new Map();for(let r=2;r<=ws.rowCount;r++){const sku=String(ws.getRow(r).getCell(skuCol).text||'').trim();const name=String(ws.getRow(r).getCell(nameCol).text||'').trim();if(sku&&name)map.set(sku,name);}
    const items=[...map].map(([sku,product_name])=>({sku,product_name}));for(let i=0;i<items.length;i+=1000){await api('import-skus',{items:items.slice(i,i+1000)});$('#busyText').textContent=`Đã import ${Math.min(i+1000,items.length)} / ${items.length} SKU…`;}
    message('#skuMsg',`Hoàn tất ${items.length.toLocaleString('vi-VN')} SKU.`,'good');
  } catch(error){message('#skuMsg',safeMessage(error),'error');}finally{setBusy(false);}
}

async function renderUsers() {
  $('#content').innerHTML = `<div class="heading"><div><p class="eyebrow">ACCESS</p><h2>Nhân sự & quyền</h2></div><button id="refreshUsers" class="secondary">Làm mới</button></div><div id="users"></div>`;
  $('#refreshUsers').onclick = renderUsers;
  try {
    const data = await api('list-users'); state.managedUsers = data.users;
    $('#users').innerHTML = data.users.length ? data.users.map((u)=>`<article class="card user-card"><div><strong>${escapeHtml(u.employee_code)} · ${escapeHtml(u.full_name)}</strong><span>${escapeHtml(ROLES[u.role]||u.role)} · ${u.active?'HOẠT ĐỘNG':'ĐÃ KHÓA'}${u.contractor?` · ${escapeHtml(u.contractor)}`:''}</span></div><button class="secondary" data-edit-user="${u.id}">CHỈNH SỬA</button></article>`).join('') : '<div class="card muted">Không có nhân sự trong phạm vi quyền.</div>';
    $$('[data-edit-user]').forEach((b)=>b.onclick=()=>editUser(b.dataset.editUser));
  } catch(error){$('#users').innerHTML=`<div class="message" data-type="error">${escapeHtml(safeMessage(error))}</div>`;}
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

async function renderDevices() {
  $('#content').innerHTML = `<div class="heading"><div><p class="eyebrow">DEVICE</p><h2>Thiết bị & thông báo</h2></div></div><div id="deviceBody" class="card muted">Đang tải…</div>`;
  try {
    const logs = await api('list-logs',{limit:50});
    $('#deviceBody').innerHTML = `<p>Log thiết bị gần đây là nguồn chẩn đoán; FCM accepted không được coi là thiết bị đã nhận nếu chưa có client_received/ACK.</p>${logs.logs.length ? `<div class="table-wrap"><table><thead><tr><th>User</th><th>Thiết bị</th><th>App</th><th>Thời gian</th></tr></thead><tbody>${logs.logs.map(l=>`<tr><td>${escapeHtml(l.employee_code)}</td><td>${escapeHtml(l.device_name)}</td><td>${escapeHtml(l.app_version)}</td><td>${formatTime(l.created_at)}</td></tr>`).join('')}</tbody></table></div>` : '<p>Chưa có log thiết bị gần đây.</p>'}`;
  } catch(error){$('#deviceBody').innerHTML=`<div class="message" data-type="error">${escapeHtml(safeMessage(error))}</div>`;}
}

async function renderIntegrations() {
  $('#content').innerHTML = `<div class="heading"><div><p class="eyebrow">INTEGRATION</p><h2>Tích hợp</h2></div></div><div id="integrationStatus"></div>
    <article class="card"><h3>Credential Supra</h3><p class="muted">Chỉ Admin hệ thống. Giá trị chỉ gửi một lần qua HTTPS đến Edge Function, không lưu browser storage và không hiển thị lại.</p>
    <div class="form-grid" id="credentialFields">${['authorization','token','apisid','appid','sid','scid','usid','warehouse'].map(k=>`<label>${k}<input data-cred="${k}" type="password" autocomplete="off"></label>`).join('')}</div><button id="saveCred" class="danger">LƯU CREDENTIAL MỚI</button><div id="credMsg" class="message" hidden></div></article>`;
  try { const c=await api('inventory-connection-status'); $('#integrationStatus').innerHTML=`<article class="card"><h3>Supra</h3><div class="row"><span>Trạng thái</span><b>${escapeHtml(c.status)}</b></div><div class="row"><span>Credential version</span><b>${Number(c.credential_version||0)}</b></div><div class="row"><span>Contract POC</span><b>${c.contract_verified?'VERIFIED':'CHƯA XÁC MINH'}</b></div><div class="row"><span>Test gần nhất</span><b>${formatTime(c.last_tested_at)}</b></div></article>`; } catch(error){$('#integrationStatus').innerHTML=`<div class="message" data-type="error">${escapeHtml(safeMessage(error))}</div>`;}
  $('#saveCred').onclick=async()=>{if(!confirm('Credential cũ sẽ được thay bằng bản mã hóa mới. Tiếp tục?'))return;const credentials={};$$('[data-cred]').forEach(i=>{if(i.value.trim())credentials[i.dataset.cred]=i.value.trim();});try{setBusy(true,'Đang mã hóa credential phía server…');const r=await api('inventory-credential-update',{credentials});$$('[data-cred]').forEach(i=>i.value='');message('#credMsg',`Đã lưu an toàn credential version ${r.credential_version}. Cần POC read-only trước khi bật sync Supra.`,'good');}catch(error){message('#credMsg',safeMessage(error),'error');}finally{setBusy(false);}};
}

async function renderLogs() {
  $('#content').innerHTML = `<div class="heading"><div><p class="eyebrow">AUDIT</p><h2>Log & audit</h2></div><button id="refreshLogs" class="secondary">Làm mới</button></div><div class="panel-grid"><section><h3>Log thiết bị</h3><div id="logs"></div></section><section><h3>Audit nghiệp vụ</h3><div id="audit"></div></section></div>`;
  $('#refreshLogs').onclick=renderLogs;
  try{const [logs,audit]=await Promise.all([api('list-logs',{limit:100}),api('audit-history',{limit:150})]);$('#logs').innerHTML=logs.logs.length?logs.logs.map(l=>`<article class="card log"><div><strong>${escapeHtml(l.employee_code)} · ${escapeHtml(l.device_name)}</strong><span>${escapeHtml(l.app_version)} · ${formatTime(l.created_at)}</span><small>${Number(l.compressed_bytes||0).toLocaleString('vi-VN')} bytes · SHA ${escapeHtml(String(l.sha256).slice(0,12))}</small></div><button class="secondary" data-log="${l.id}">TẢI</button></article>`).join(''):'<div class="card muted">Chưa có log.</div>';$$('[data-log]').forEach(b=>b.onclick=()=>downloadLog(b.dataset.log));$('#audit').innerHTML=audit.audit.length?audit.audit.map(a=>`<article class="card"><strong>${escapeHtml(a.action)}</strong><p>${escapeHtml(a.from_status||'—')} → ${escapeHtml(a.to_status||'—')}</p><small>${formatTime(a.created_at)} · issue ${escapeHtml(String(a.issue_id).slice(0,8))}</small></article>`).join(''):'<div class="card muted">Chưa có audit.</div>';}catch(error){$('#logs').innerHTML=`<div class="message" data-type="error">${escapeHtml(safeMessage(error))}</div>`;}
}
async function downloadLog(id){try{setBusy(true,'Đang tạo link tải log…');const r=await api('download-log',{id});location.href=r.url;}catch(error){alert(safeMessage(error));}finally{setBusy(false);}}

async function renderSla(){
  $('#content').innerHTML=`<div class="heading"><div><p class="eyebrow">OPERATIONS</p><h2>SLA vận hành</h2></div></div><form id="slaForm" class="card form-grid"><label>Nhắc nhận xử lý (phút)<input id="ack" type="number" min="1" max="480"></label><label>Chu kỳ nhắc (phút)<input id="reminder" type="number" min="1" max="480"></label><label>Quá thời gian xử lý (phút)<input id="replenish" type="number" min="1" max="480"></label><label>Nhắc Picker ACK (phút)<input id="pickerAck" type="number" min="1" max="60"></label><button class="primary span">LƯU SLA VẬN HÀNH</button><div id="slaMsg" class="message span" hidden></div></form>`;
  try{const c=await api('get-operational-config');$('#ack').value=c.acknowledge_minutes;$('#reminder').value=c.reminder_minutes;$('#replenish').value=c.replenish_minutes;$('#pickerAck').value=c.picker_ack_reminder_minutes;}catch(error){message('#slaMsg',safeMessage(error),'error');}
  $('#slaForm').onsubmit=async(event)=>{event.preventDefault();try{setBusy(true,'Đang lưu SLA…');await api('save-operational-config',{acknowledge_minutes:Number($('#ack').value),reminder_minutes:Number($('#reminder').value),replenish_minutes:Number($('#replenish').value),picker_ack_reminder_minutes:Number($('#pickerAck').value)});message('#slaMsg','Đã lưu SLA vận hành. Không có auto-SKIP.','good');}catch(error){message('#slaMsg',safeMessage(error),'error');}finally{setBusy(false);}};
}

async function renderConfig(){
  $('#content').innerHTML=`<div class="heading"><div><p class="eyebrow">SYSTEM</p><h2>Cấu hình hệ thống</h2></div></div><form id="configForm" class="card form-grid">
    <label>Retention nghiệp vụ (ngày)<input id="retention" type="number" min="7" max="365"></label><label>Retention log (ngày)<input id="logRetention" type="number" min="1" max="60"></label>
    <label>Fresh tồn (phút)<input id="fresh" type="number" min="1" max="120"></label><label>Stale tồn (phút)<input id="stale" type="number" min="2" max="480"></label>
    <label>Chu kỳ sync tồn (phút)<input id="invInterval" type="number" min="10" max="120"></label><label>Giờ bắt đầu<input id="startHour" type="number" min="0" max="23"></label><label>Giờ kết thúc<input id="endHour" type="number" min="0" max="23"></label>
    <label class="check"><input id="autoInventory" type="checkbox"> Bật lịch tự động khi kết nối Supra đã VERIFIED</label>
    <button class="primary span">LƯU CẤU HÌNH HỆ THỐNG</button><div id="configMsg" class="message span" hidden></div></form>`;
  let current;
  try{current=await api('get-config');$('#retention').value=current.retention_days;$('#logRetention').value=current.diagnostic_log_retention_days;$('#fresh').value=current.inventory_fresh_minutes;$('#stale').value=current.inventory_stale_minutes;$('#invInterval').value=current.inventory_sync_interval_minutes;$('#startHour').value=current.inventory_operating_start_hour;$('#endHour').value=current.inventory_operating_end_hour;$('#autoInventory').checked=Boolean(current.inventory_auto_sync_enabled);}catch(error){message('#configMsg',safeMessage(error),'error');}
  $('#configForm').onsubmit=async(event)=>{event.preventDefault();try{setBusy(true,'Đang lưu cấu hình…');await api('save-config',{...current,retention_days:Number($('#retention').value),diagnostic_log_retention_days:Number($('#logRetention').value),inventory_fresh_minutes:Number($('#fresh').value),inventory_stale_minutes:Number($('#stale').value),inventory_sync_interval_minutes:Number($('#invInterval').value),inventory_operating_start_hour:Number($('#startHour').value),inventory_operating_end_hour:Number($('#endHour').value),inventory_auto_sync_enabled:$('#autoInventory').checked});message('#configMsg','Đã lưu cấu hình hệ thống.','good');}catch(error){message('#configMsg',safeMessage(error),'error');}finally{setBusy(false);}};
}

async function renderVersions(){
  $('#content').innerHTML=`<div class="heading"><div><p class="eyebrow">RELEASE</p><h2>Phiên bản</h2></div></div><article class="card"><h3>OTA</h3><p>Stable và Beta được khóa channel trong APK, signer và SHA được workflow release kiểm tra trước publish.</p><p class="muted">Release mới vẫn đi qua workflow production đã harden; Web không chứa signing key.</p></article><article class="card"><h3>Runtime</h3><p>Dùng mục Thiết bị & thông báo / Log để đối chiếu app version đang chạy. Không coi file build là đã triển khai nếu chưa có evidence runtime.</p></article>`;
}

state.session = readSession();
if (state.session) renderApp(); else renderLogin();
