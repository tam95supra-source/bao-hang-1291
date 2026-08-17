import './ops-console.css';

const BACKEND_BRIDGE_URL = 'https://backend.bao-hang-1291.invalid';
const BRIDGE_PUBLIC_KEY = 'compat-public';
const WEB_API = `${BACKEND_BRIDGE_URL}/api/web-api`;
const ADMIN_OPS = `${BACKEND_BRIDGE_URL}/api/admin-ops`;
const SESSION_KEY = 'bao-hang-1291-web-session';
const ROLE_LABELS = {
  ADMIN: 'Admin hệ thống',
  ADMIN_INVENT: 'Admin Event',
  INVENT: 'Người báo hàng',
  PICKER: 'Picker / Người lấy hàng',
};

const ui = {
  customView: '',
  enhanceTimer: null,
  overviewClock: null,
  issueBoardCache: null,
  issueBoardAt: 0,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
function formatTime(value, withSeconds = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return date.toLocaleString('vi-VN', { hour12: false, second: withSeconds ? '2-digit' : undefined });
}
function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes || 0));
  if (value < 1024) return `${value.toLocaleString('vi-VN')} B`;
  if (value < 1048576) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1073741824) return `${(value / 1048576).toFixed(1)} MB`;
  return `${(value / 1073741824).toFixed(2)} GB`;
}
function readSession() {
  try {
    const session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    return session?.access_token && session?.refresh_token && session?.profile ? session : null;
  } catch { return null; }
}
function detectedTestRole() {
  const text = $('.test-banner strong')?.textContent?.trim() || '';
  if (text.includes('Admin Event')) return 'ADMIN_INVENT';
  if (text.includes('Người báo hàng')) return 'INVENT';
  if (text.includes('Picker')) return 'PICKER';
  return '';
}
function effectiveRole() { return detectedTestRole() || readSession()?.profile?.role || 'PICKER'; }
function isManager() { return ['ADMIN', 'ADMIN_INVENT'].includes(effectiveRole()); }
async function refreshSessionIfNeeded() {
  const session = readSession();
  if (!session) throw new Error('Phiên đăng nhập không tồn tại.');
  const now = Math.floor(Date.now() / 1000);
  if ((session.expires_at || 0) > now + 90) return session;
  const response = await fetch(`${BACKEND_BRIDGE_URL}/auth/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: BRIDGE_PUBLIC_KEY },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error_description || data.message || 'Phiên đăng nhập đã hết hạn.');
  const updated = {
    ...session,
    access_token: data.access_token,
    refresh_token: data.refresh_token || session.refresh_token,
    expires_at: now + Number(data.expires_in || 3600),
  };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(updated));
  return updated;
}
async function request(base, action, payload = {}) {
  const session = await refreshSessionIfNeeded();
  const headers = {
    'content-type': 'application/json',
    apikey: BRIDGE_PUBLIC_KEY,
    authorization: `Bearer ${session.access_token}`,
  };
  const testRole = detectedTestRole();
  if (testRole) headers['x-admin-test-role'] = testRole;
  const response = await fetch(`${base}/${encodeURIComponent(action)}`, {
    method: 'POST', headers, body: JSON.stringify(payload),
  });
  const text = await response.text();
  let data = {};
  if (text) {
    try { data = JSON.parse(text); } catch { data = { error: text }; }
  }
  if (!response.ok) throw new Error(data.error || data.message || `Lỗi máy chủ ${response.status}`);
  return data;
}
const webApi = (action, payload = {}) => request(WEB_API, action, payload);
const opsApi = (action, payload = {}) => request(ADMIN_OPS, action, payload);

function busy(text = 'Đang xử lý…') {
  let overlay = $('#opsBusy');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'opsBusy';
    overlay.className = 'ops-busy';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `<div><span class="spinner"></span><strong>${escapeHtml(text)}</strong></div>`;
  overlay.hidden = false;
  return () => { overlay.hidden = true; };
}
function toast(text, type = 'good') {
  let el = $('#opsToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'opsToast';
    el.className = 'ops-toast';
    document.body.appendChild(el);
  }
  el.dataset.type = type;
  el.textContent = text;
  el.hidden = false;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.hidden = true; }, 3500);
}
function modal({ title, body, confirmText = 'Xác nhận', danger = false, onConfirm }) {
  $('#opsModal')?.remove();
  const wrap = document.createElement('div');
  wrap.id = 'opsModal';
  wrap.className = 'ops-modal';
  wrap.innerHTML = `<section role="dialog" aria-modal="true" aria-labelledby="opsModalTitle">
    <div class="ops-modal-head"><h3 id="opsModalTitle">${escapeHtml(title)}</h3><button class="ops-icon-button" data-close aria-label="Đóng">×</button></div>
    <div class="ops-modal-body">${body}</div>
    <div class="ops-modal-actions"><button class="secondary" data-close>Hủy</button><button class="${danger ? 'danger' : 'primary'}" data-confirm>${escapeHtml(confirmText)}</button></div>
  </section>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  $$('[data-close]', wrap).forEach((button) => button.addEventListener('click', close));
  wrap.addEventListener('click', (event) => { if (event.target === wrap) close(); });
  $('[data-confirm]', wrap).addEventListener('click', async () => {
    const button = $('[data-confirm]', wrap);
    button.disabled = true;
    try { await onConfirm(wrap); close(); }
    catch (error) { const box = $('.ops-modal-error', wrap); if (box) { box.textContent = error.message; box.hidden = false; } else toast(error.message, 'error'); }
    finally { if (button.isConnected) button.disabled = false; }
  });
  setTimeout(() => $('input,select,button', wrap)?.focus(), 0);
}

function addSection(tabs, before, label) {
  if (!before) return;
  const section = document.createElement('span');
  section.className = 'nav-section-label';
  section.textContent = label;
  tabs.insertBefore(section, before);
}
function normalizeNavigation() {
  const tabs = $('.tabs');
  if (!tabs || !readSession()) return;
  const buttons = $$('button[data-tab]', tabs);
  if (!buttons.length) return;
  const byId = new Map(buttons.map((button) => [button.dataset.tab, button]));
  const labels = {
    overview: 'Tổng quan hôm nay',
    events: 'Xử lý báo thiếu',
    sku: 'Danh mục SKU',
    reports: 'Báo cáo vận hành',
    users: 'Nhân sự & tài khoản',
    devices: 'Thiết bị & thông báo',
    services: 'Hạ tầng & chi phí',
    logs: 'Nhật ký hệ thống',
    config: 'Thời gian nghiệp vụ',
    sla: 'Thời gian nghiệp vụ',
    versions: 'Phiên bản ứng dụng',
  };
  for (const [id, label] of Object.entries(labels)) if (byId.has(id)) byId.get(id).textContent = label;

  $$('.nav-section-label', tabs).forEach((el) => el.remove());
  const isAdmin = byId.has('versions') || byId.has('services');
  const isAdminEvent = !isAdmin && byId.has('users') && byId.has('sla');
  if (isAdminEvent && !tabs.querySelector('[data-ops-tab="server"]')) {
    const button = document.createElement('button');
    button.dataset.opsTab = 'server';
    button.textContent = 'Hạ tầng & chi phí';
    const logButton = byId.get('logs');
    tabs.insertBefore(button, logButton || null);
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      ui.customView = 'server';
      history.replaceState(null, '', '#/server');
      $$('button', tabs).forEach((item) => item.classList.toggle('active', item === button));
      renderServerView();
    });
  }
  const first = (id) => byId.get(id) || tabs.querySelector(`[data-ops-tab="${id}"]`);
  addSection(tabs, first('overview'), 'VẬN HÀNH');
  addSection(tabs, first('users'), 'QUẢN LÝ');
  addSection(tabs, first(isAdmin ? 'config' : 'sla'), 'THIẾT LẬP');
  addSection(tabs, first(isAdmin ? 'services' : 'server'), 'HẠ TẦNG');

  if (location.hash === '#/server' && tabs.querySelector('[data-ops-tab="server"]')) {
    ui.customView = 'server';
    const button = tabs.querySelector('[data-ops-tab="server"]');
    $$('button', tabs).forEach((item) => item.classList.toggle('active', item === button));
  }
  if (!tabs.dataset.opsBound) {
    tabs.dataset.opsBound = '1';
    tabs.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-tab]');
      if (button) ui.customView = '';
    }, true);
  }
}

function pageHeading(title, subtitle = '', right = '') {
  return `<div class="ops-page-heading"><div><h2>${escapeHtml(title)}</h2>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}</div>${right}</div>`;
}
function metric(label, value, detail = '', tone = '') {
  return `<article class="ops-metric ${tone}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${detail ? `<small>${escapeHtml(detail)}</small>` : ''}</article>`;
}
function progress(label, used, limit, detail = '') {
  const ratio = limit > 0 ? Math.min(100, Math.max(0, used / limit * 100)) : 0;
  const tone = ratio >= 90 ? 'danger' : ratio >= 75 ? 'warn' : 'good';
  return `<div class="ops-progress"><div><span>${escapeHtml(label)}</span><b>${ratio.toFixed(1)}%</b></div><div class="ops-progress-track"><i class="${tone}" style="width:${ratio.toFixed(2)}%"></i></div><small>${escapeHtml(detail || `${formatBytes(used)} / ${formatBytes(limit)}`)}</small></div>`;
}
function localDayLabel() {
  const now = new Date();
  const weekday = now.toLocaleDateString('vi-VN', { weekday: 'long' });
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${now.toLocaleDateString('vi-VN')}`;
}
function statusLabel(status) {
  return ({ OPEN: 'Chờ nhận', CLAIMED: 'Đang xử lý', SEARCHING: 'Đang tìm hàng', REPLENISHING: 'Đang châm hàng', AVAILABLE: 'Đã có hàng', SKIP_ALLOWED: 'Được phép bỏ qua', CLOSED: 'Đã đóng' })[status] || status;
}
function ageLabel(value) {
  if (!value) return '—';
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return 'vừa xong';
  if (minutes < 60) return `${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  return `${hours} giờ ${minutes % 60} phút`;
}

async function renderOverviewView() {
  const content = $('#content');
  if (!content || !isManager()) return;
  content.dataset.opsRender = 'overview';
  content.innerHTML = `${pageHeading('Tổng quan hôm nay', 'Trạng thái vận hành hiện tại, sự kiện cần xử lý và kết quả trong 24 giờ.', `<div class="ops-asof"><b>${escapeHtml(localDayLabel())}</b><span id="overviewNow"></span></div>`)}<div class="ops-loading">Đang tải dữ liệu vận hành…</div>`;
  const updateClock = () => { const el = $('#overviewNow'); if (el) el.textContent = `Cập nhật lúc ${new Date().toLocaleTimeString('vi-VN', { hour12: false })}`; };
  clearInterval(ui.overviewClock); updateClock(); ui.overviewClock = setInterval(updateClock, 30000);
  try {
    const started = performance.now();
    const [summary, reports, service, board] = await Promise.all([
      webApi('admin-summary'), webApi('reports-summary'), webApi('service-metrics'), webApi('issue-board'),
    ]);
    if ($('#content') !== content || content.dataset.opsRender !== 'overview') return;
    const latency = Math.round(performance.now() - started);
    const activeIssues = [...(board.open || []), ...(board.claimed || [])];
    const realtime = document.body.dataset.ticketRealtime === 'online' ? 'Trực tuyến' : document.body.dataset.ticketRealtime === 'fallback' ? 'Tự làm mới' : 'Đang kết nối';
    const staff = summary.staff_sync;
    const hourly = Array.isArray(reports.hourly_reports_24h) ? reports.hourly_reports_24h : new Array(24).fill(0);
    const maxHour = Math.max(1, ...hourly.map(Number));
    const currentHour = new Date().getHours();
    const db = Number(service.usage?.database_bytes || 0);
    const dbLimit = Number(service.free_limits?.database_bytes || 1);
    const issueList = activeIssues.slice(0, 6).map((issue) => `<div class="ops-live-row"><div><b>SKU ${escapeHtml(issue.sku)}</b><span>${escapeHtml(issue.product_name || '')}</span></div><div><strong>${escapeHtml(statusLabel(issue.status))}</strong><small>${escapeHtml(ageLabel(issue.reported_at))}${issue.assigned_name ? ` · ${escapeHtml(issue.assigned_name)}` : ''}</small></div></div>`).join('');
    content.innerHTML = `${pageHeading('Tổng quan hôm nay', 'Trạng thái vận hành hiện tại, sự kiện cần xử lý và kết quả trong 24 giờ.', `<div class="ops-asof"><b>${escapeHtml(localDayLabel())}</b><span id="overviewNow"></span></div>`)}
      <section class="ops-status-strip">
        <span><i class="dot good"></i><b>${escapeHtml(realtime)}</b> cập nhật báo hàng</span>
        <span><i class="dot ${summary.pending_sheet_count ? 'warn' : 'good'}"></i>Google Sheet: <b>${summary.pending_sheet_count ? `${summary.pending_sheet_count} chờ` : 'đã đồng bộ'}</b></span>
        <span><i class="dot ${staff?.failed_count ? 'warn' : 'good'}"></i>Nhân sự: <b>${staff ? formatTime(staff.finished_at) : 'chưa đồng bộ'}</b></span>
        <span><i class="dot ${latency > 2500 ? 'warn' : 'good'}"></i>Phản hồi server: <b>${latency} ms</b></span>
      </section>
      <div class="ops-metrics-grid">
        ${metric('Chờ nhận', String(summary.open_issue_count || 0), 'cần người nhận xử lý', summary.open_issue_count ? 'warn' : '')}
        ${metric('Đang xử lý', String(summary.claimed_issue_count || 0), 'đang có người phụ trách')}
        ${metric('Lượt báo 24 giờ', String(reports.last_24h?.reports || 0), `${reports.last_24h?.issues || 0} đợt báo thiếu`)}
        ${metric('Đã xử lý 24 giờ', String(reports.last_24h?.resolved || 0), `${reports.last_24h?.available || 0} có hàng · ${reports.last_24h?.skipped || 0} bỏ qua`, 'good')}
        ${metric('Quá mốc phản hồi', String(reports.overdue_now || 0), 'cần ưu tiên', reports.overdue_now ? 'danger' : '')}
        ${metric('Nhân sự hoạt động', String(summary.active_user_count || 0), `${summary.profile_count || 0} tài khoản`)}
        ${metric('SKU đang dùng', Number(summary.sku_count || 0).toLocaleString('vi-VN'), 'danh mục hiện hành')}
        ${metric('Dung lượng dữ liệu', `${(db / 1048576).toFixed(1)} MB`, `${(db / dbLimit * 100).toFixed(1)}% gói miễn phí`, db / dbLimit >= .75 ? 'warn' : 'good')}
      </div>
      <div class="ops-dashboard-grid">
        <article class="ops-panel ops-live"><div class="ops-panel-title"><div><h3>Đang diễn ra</h3><p>${activeIssues.length} đợt đang chờ hoặc đang xử lý</p></div><span class="ops-live-pill">LIVE</span></div>${issueList || '<div class="ops-empty">Không có đợt báo thiếu đang chờ xử lý.</div>'}</article>
        <article class="ops-panel"><div class="ops-panel-title"><div><h3>Nhịp báo thiếu 24 giờ</h3><p>Lượt báo theo giờ, cột đậm là giờ hiện tại</p></div></div><div class="ops-hour-chart">${hourly.map((value, hour) => `<div class="ops-hour ${hour === currentHour ? 'current' : ''}" title="${hour}:00 · ${Number(value)} lượt"><i style="height:${Math.max(4, Number(value) / maxHour * 100)}%"></i><span>${hour % 3 === 0 ? hour : ''}</span></div>`).join('')}</div></article>
        <article class="ops-panel"><div class="ops-panel-title"><div><h3>Hiệu suất xử lý</h3><p>24 giờ gần nhất và thời gian xử lý 30 ngày</p></div></div><div class="ops-kv"><span>Một nửa đợt được nhận trong</span><b>${reports.median_claim_minutes ?? '—'} phút</b><span>Một nửa đợt xử lý xong trong</span><b>${reports.median_resolution_minutes ?? '—'} phút</b><span>95% xử lý xong trong</span><b>${reports.p95_resolution_minutes ?? '—'} phút</b><span>Đợt báo lại trong 30 phút</span><b>${reports.recurrent_episodes || 0}</b></div></article>
        <article class="ops-panel"><div class="ops-panel-title"><div><h3>Đồng bộ & dung lượng</h3><p>Thông tin nền đang ảnh hưởng vận hành</p></div></div>${progress('Dung lượng Neon', db, dbLimit)}<div class="ops-kv compact"><span>Đồng bộ nhân sự</span><b>${staff ? `${staff.status} · ${formatTime(staff.finished_at)}` : 'Chưa có'}</b><span>Google Sheet chờ xuất</span><b>${summary.pending_sheet_count || 0}</b><span>Thiết bị FCM hoạt động</span><b>${service.usage?.active_device_tokens || 0}</b></div></article>
      </div>`;
    updateClock();
  } catch (error) {
    content.innerHTML = `${pageHeading('Tổng quan hôm nay', 'Trạng thái vận hành hiện tại.')}<div class="message" data-type="error">${escapeHtml(error.message)}</div>`;
  }
}

function managedRoles() {
  return effectiveRole() === 'ADMIN' ? ['ADMIN_INVENT', 'INVENT', 'PICKER'] : effectiveRole() === 'ADMIN_INVENT' ? ['INVENT', 'PICKER'] : [];
}
function roleOptions(selected = '') {
  return managedRoles().map((role) => `<option value="${role}" ${role === selected ? 'selected' : ''}>${escapeHtml(ROLE_LABELS[role])}</option>`).join('');
}
function canManageUser(user) {
  return user.source_kind === 'MANUAL' && !user.protected_account && user.role !== 'ADMIN' && managedRoles().includes(user.role);
}
async function renderUsersView() {
  const content = $('#content');
  if (!content || !isManager()) return;
  content.dataset.opsRender = 'users';
  content.innerHTML = `${pageHeading('Nhân sự & tài khoản', 'Google Sheet là nguồn chính; tài khoản tạo thêm được quản lý riêng và không ghi ngược vào nguồn.', `<button class="secondary" id="opsStaffSync">Đồng bộ nguồn ngay</button>`)}<div class="ops-loading">Đang tải nhân sự…</div>`;
  try {
    const [list, sync, service] = await Promise.all([webApi('list-users'), webApi('staff-sync-status'), webApi('service-metrics')]);
    if ($('#content') !== content || content.dataset.opsRender !== 'users') return;
    const users = list.users || [];
    const last = sync.runs?.[0];
    const auto = Boolean(service.config?.staff_auto_sync_enabled);
    const interval = Number(service.config?.staff_sync_interval_minutes || 60);
    const manualCount = users.filter((u) => u.source_kind === 'MANUAL').length;
    const gsheetCount = users.filter((u) => u.source_kind === 'GSHEET').length;
    content.innerHTML = `${pageHeading('Nhân sự & tài khoản', 'Google Sheet là nguồn chính; tài khoản tạo thêm được quản lý riêng và không ghi ngược vào nguồn.', `<button class="secondary" id="opsStaffSync">Đồng bộ nguồn ngay</button>`)}
      <section class="ops-status-strip">
        <span><i class="dot ${last?.status === 'FAILED' ? 'warn' : 'good'}"></i>Nguồn Google Sheet: <b>${last ? `${last.status} · ${formatTime(last.finished_at)}` : 'chưa đồng bộ'}</b></span>
        <span><i class="dot ${auto ? 'good' : 'warn'}"></i>Tự đồng bộ nguồn: <b>${auto ? `mỗi ${interval} phút` : 'đang tắt'}</b></span>
        <span><i class="dot good"></i>Thay đổi trong service: <b>realtime</b></span>
        <span>Google Sheet: <b>${gsheetCount}</b> · Tạo thêm: <b>${manualCount}</b></span>
      </section>
      <article class="ops-panel ops-users-panel">
        <div class="ops-panel-title"><div><h3>Danh sách tài khoản</h3><p>Chỉ tài khoản “Tạo thêm” mới có nút Sửa/Xóa. Nhân sự Google Sheet được khóa theo nguồn.</p></div><label class="ops-search">Tìm<input id="opsUserSearch" placeholder="Mã nhân viên hoặc họ tên"></label></div>
        <div class="table-wrap"><table class="ops-users-table"><thead><tr><th>Mã nhân viên</th><th>Họ tên</th><th>Quyền</th><th>Nguồn</th><th>Trạng thái</th><th class="ops-action-col">Thao tác</th></tr></thead><tbody id="opsUserRows"></tbody></table></div>
      </article>
      <article class="ops-panel ops-create-user"><div class="ops-panel-title"><div><h3>Thêm tài khoản ngoài Google Sheet</h3><p>Chỉ cần mã nhân viên, họ tên, quyền và mật khẩu. Không yêu cầu nhà thầu.</p></div></div>
        <form id="opsCreateUser" class="ops-form-grid">
          <label>Mã nhân viên<input name="employee_code" required autocomplete="off"></label>
          <label>Họ tên<input name="full_name" required autocomplete="off"></label>
          <label>Quyền<select name="role" required>${roleOptions()}</select></label>
          <label>Mật khẩu<input name="password" type="password" minlength="8" required autocomplete="new-password"></label>
          <div class="ops-form-actions"><button class="primary" type="submit">Tạo tài khoản</button><span id="opsCreateMessage"></span></div>
        </form>
      </article>`;

    const draw = () => {
      const needle = ($('#opsUserSearch')?.value || '').trim().toLocaleLowerCase('vi-VN');
      const filtered = users.filter((u) => !needle || `${u.employee_code} ${u.full_name}`.toLocaleLowerCase('vi-VN').includes(needle));
      $('#opsUserRows').innerHTML = filtered.map((user) => `<tr data-user-id="${escapeHtml(user.id)}">
        <td><b>${escapeHtml(user.employee_code)}</b>${user.protected_account ? '<span class="ops-lock">Bảo vệ</span>' : ''}</td>
        <td>${escapeHtml(user.full_name)}</td>
        <td>${escapeHtml(ROLE_LABELS[user.role] || user.role)}</td>
        <td>${user.source_kind === 'GSHEET' ? '<span class="ops-source source">Google Sheet</span>' : '<span class="ops-source manual">Tạo thêm</span>'}</td>
        <td><span class="ops-status ${user.active ? 'active' : 'inactive'}">${user.active ? 'Hoạt động' : 'Đã xóa / ngừng'}</span></td>
        <td class="ops-action-col">${canManageUser(user) ? `<div class="ops-row-actions"><button class="secondary" data-edit-user="${escapeHtml(user.id)}">Sửa</button><button class="danger-outline" data-delete-user="${escapeHtml(user.id)}" ${user.active ? '' : 'disabled'}>Xóa</button></div>` : '<span class="ops-readonly">Theo nguồn</span>'}</td>
      </tr>`).join('') || '<tr><td colspan="6" class="ops-empty-cell">Không có tài khoản phù hợp.</td></tr>';
      $$('[data-edit-user]').forEach((button) => button.onclick = () => openEditUser(users.find((u) => u.id === button.dataset.editUser), async () => { await renderUsersView(); }));
      $$('[data-delete-user]').forEach((button) => button.onclick = () => openDeleteUser(users.find((u) => u.id === button.dataset.deleteUser), async () => { await renderUsersView(); }));
    };
    draw();
    $('#opsUserSearch').addEventListener('input', draw);
    $('#opsStaffSync').onclick = async () => {
      const done = busy('Đang đồng bộ danh mục nhân sự…');
      try {
        const result = await webApi('staff-sync-now');
        toast(`Đồng bộ ${result.status}: tạo ${result.created || 0}, cập nhật ${result.updated || 0}, ngừng ${result.deactivated || 0}.`);
        await renderUsersView();
      } catch (error) { toast(error.message, 'error'); }
      finally { done(); }
    };
    $('#opsCreateUser').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const done = busy('Đang tạo tài khoản…');
      try {
        await opsApi('create-user', Object.fromEntries(form.entries()));
        toast('Đã tạo tài khoản và phát đồng bộ realtime.');
        await renderUsersView();
      } catch (error) { $('#opsCreateMessage').textContent = error.message; $('#opsCreateMessage').className = 'bad-text'; }
      finally { done(); }
    });
  } catch (error) {
    content.innerHTML = `${pageHeading('Nhân sự & tài khoản')}<div class="message" data-type="error">${escapeHtml(error.message)}</div>`;
  }
}
function openEditUser(user, after) {
  if (!user) return;
  modal({
    title: `Sửa tài khoản ${user.employee_code}`,
    confirmText: 'Lưu thay đổi',
    body: `<div class="ops-form-grid modal-grid">
      <label>Mã nhân viên<input id="editCode" value="${escapeHtml(user.employee_code)}"></label>
      <label>Họ tên<input id="editName" value="${escapeHtml(user.full_name)}"></label>
      <label>Quyền<select id="editRole">${roleOptions(user.role)}</select></label>
      <label>Mật khẩu mới <small>Để trống nếu giữ nguyên</small><input id="editPassword" type="password" minlength="8" autocomplete="new-password"></label>
      <label class="ops-check span"><input id="editActive" type="checkbox" ${user.active ? 'checked' : ''}> Tài khoản hoạt động</label>
      <div class="ops-modal-error span" hidden></div>
    </div>`,
    onConfirm: async (root) => {
      await opsApi('update-user', {
        id: user.id,
        employee_code: $('#editCode', root).value.trim(),
        full_name: $('#editName', root).value.trim(),
        role: $('#editRole', root).value,
        active: $('#editActive', root).checked,
        new_password: $('#editPassword', root).value,
      });
      toast('Đã cập nhật tài khoản.');
      await after();
    },
  });
}
function openDeleteUser(user, after) {
  if (!user) return;
  modal({
    title: 'Xóa tài khoản tạo thêm',
    confirmText: 'Xóa tài khoản',
    danger: true,
    body: `<div class="ops-warning-box"><b>${escapeHtml(user.employee_code)} · ${escapeHtml(user.full_name)}</b><p>Tài khoản sẽ bị khóa ngay và không đăng nhập/ghi nghiệp vụ được nữa. Lịch sử ticket, audit và báo cáo cũ vẫn được giữ để không làm mất dấu vận hành.</p></div><div class="ops-modal-error" hidden></div>`,
    onConfirm: async () => {
      await opsApi('delete-user', { id: user.id });
      toast('Đã xóa tài khoản; lịch sử được giữ nguyên.');
      await after();
    },
  });
}

async function renderTimingView() {
  const content = $('#content');
  if (!content || !isManager()) return;
  content.dataset.opsRender = 'timing';
  content.innerHTML = `${pageHeading('Thời gian nghiệp vụ', 'Mỗi nhóm thời gian được tách riêng theo đúng bước xử lý báo hàng.')}<div class="ops-loading">Đang tải cấu hình…</div>`;
  try {
    const config = await webApi('get-operational-config');
    if ($('#content') !== content || content.dataset.opsRender !== 'timing') return;
    content.innerHTML = `${pageHeading('Thời gian nghiệp vụ', 'Mỗi nhóm thời gian được tách riêng theo đúng bước xử lý báo hàng.')}
      <form id="opsTimingForm">
        <div class="ops-settings-grid">
          <article class="ops-setting-card"><span class="ops-step">01</span><h3>Báo thiếu & nhận xử lý</h3><p>Khoảng thời gian để Người báo hàng nhận đợt báo thiếu và mốc nhắc lại nếu chưa có phản hồi.</p><label>Mốc cần nhận xử lý (phút)<input type="number" name="acknowledge_minutes" min="1" max="480" value="${Number(config.acknowledge_minutes)}"></label><label>Nhắc lại khi chưa xử lý (phút)<input type="number" name="reminder_minutes" min="1" max="480" value="${Number(config.reminder_minutes)}"></label></article>
          <article class="ops-setting-card"><span class="ops-step">02</span><h3>Châm hàng</h3><p>Mốc theo dõi sau khi đợt báo thiếu đã được nhận và đang tìm/châm bổ sung hàng.</p><label>Mốc châm hàng (phút)<input type="number" name="replenish_minutes" min="1" max="480" value="${Number(config.replenish_minutes)}"></label></article>
          <article class="ops-setting-card"><span class="ops-step">03</span><h3>Cho phép bỏ qua</h3><p>Tự động cho phép bỏ qua chỉ chạy khi được bật. Khi tắt, hệ thống không tự cho phép bỏ qua dù quá thời gian.</p><label class="ops-check"><input type="checkbox" name="auto_skip_enabled" ${config.auto_skip_enabled ? 'checked' : ''}> Bật tự động cho phép bỏ qua</label><label>Mốc tự cho phép bỏ qua (phút)<input type="number" name="auto_skip_after_minutes" min="15" max="4320" value="${Number(config.auto_skip_after_minutes)}"></label></article>
          <article class="ops-setting-card"><span class="ops-step">04</span><h3>Xác nhận của Người lấy hàng</h3><p>Khi ĐÃ CÓ HÀNG hoặc ĐƯỢC BỎ QUA, Người lấy hàng phải xác nhận cảnh báo. Đây là chu kỳ nhắc nếu chưa xác nhận.</p><label>Nhắc xác nhận (phút)<input type="number" name="picker_ack_reminder_minutes" min="1" max="60" value="${Number(config.picker_ack_reminder_minutes)}"></label></article>
        </div>
        <div class="ops-save-bar"><div><b>Áp dụng đồng bộ</b><span>Thay đổi được phát realtime sang Web/App đang hoạt động.</span></div><button class="primary" type="submit">Lưu thời gian nghiệp vụ</button></div>
      </form>`;
    $('#opsTimingForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const payload = {
        acknowledge_minutes: Number(form.get('acknowledge_minutes')),
        reminder_minutes: Number(form.get('reminder_minutes')),
        replenish_minutes: Number(form.get('replenish_minutes')),
        picker_ack_reminder_minutes: Number(form.get('picker_ack_reminder_minutes')),
        auto_skip_enabled: form.get('auto_skip_enabled') === 'on',
        auto_skip_after_minutes: Number(form.get('auto_skip_after_minutes')),
      };
      const done = busy('Đang lưu thời gian nghiệp vụ…');
      try { await webApi('save-operational-config', payload); toast('Đã lưu và phát cấu hình realtime.'); }
      catch (error) { toast(error.message, 'error'); }
      finally { done(); }
    });
  } catch (error) {
    content.innerHTML = `${pageHeading('Thời gian nghiệp vụ')}<div class="message" data-type="error">${escapeHtml(error.message)}</div>`;
  }
}

async function renderServerView() {
  const content = $('#content');
  if (!content || !isManager()) return;
  content.dataset.opsRender = 'server';
  content.innerHTML = `${pageHeading('Hạ tầng & chi phí', 'Sức khỏe dịch vụ, dung lượng và hàng rào giữ mục tiêu vận hành 0 USD.')}<div class="ops-loading">Đang kiểm tra dịch vụ…</div>`;
  try {
    const started = performance.now();
    const [service, summary] = await Promise.all([webApi('service-metrics'), webApi('admin-summary')]);
    const latency = Math.round(performance.now() - started);
    if ($('#content') !== content || content.dataset.opsRender !== 'server') return;
    const usage = service.usage || {};
    const limits = service.free_limits || {};
    const provider = String(service.provider || 'NEON_FREE');
    const region = String(service.region || 'aws-ap-southeast-1');
    const db = Number(usage.database_bytes || 0);
    const dbLimit = Number(limits.database_bytes || 512 * 1024 * 1024);
    const dbPct = dbLimit ? db / dbLimit * 100 : 0;
    const logBytes = Number(usage.diagnostic_log_bytes || 0);
    const computeGuard = Number(limits.compute_hours_month || 0);
    const risk = dbPct >= 90 || Number(summary.pending_sheet_count || 0) > 100;
    content.innerHTML = `${pageHeading('Hạ tầng & chi phí', 'Sức khỏe dịch vụ, dung lượng và hàng rào giữ mục tiêu vận hành 0 USD.', `<div class="ops-cost-target ${risk ? 'warn' : 'good'}"><span>CHI PHÍ DỰ KIẾN</span><strong>$0</strong><small>${risk ? 'Có chỉ số cần theo dõi' : 'Đang trong mục tiêu'}</small></div>`)}
      <section class="ops-status-strip">
        <span><i class="dot good"></i>Neon: <b>ACTIVE</b></span>
        <span><i class="dot ${document.body.dataset.ticketRealtime === 'online' ? 'good' : 'warn'}"></i>Cập nhật báo hàng: <b>${document.body.dataset.ticketRealtime === 'online' ? 'TRỰC TUYẾN' : 'TỰ LÀM MỚI/ĐANG KẾT NỐI'}</b></span>
        <span><i class="dot ${summary.pending_sheet_count ? 'warn' : 'good'}"></i>Google Sheet: <b>${summary.pending_sheet_count ? `${summary.pending_sheet_count} chờ` : 'OK'}</b></span>
        <span><i class="dot ${latency > 2500 ? 'warn' : 'good'}"></i>API: <b>${latency} ms</b></span>
      </section>
      <div class="ops-server-grid">
        <article class="ops-panel"><div class="ops-panel-title"><div><h3>Neon production</h3><p>PostgreSQL nghiệp vụ + Data API; Firebase JWT được kiểm tra tại RLS/RPC</p></div><span class="ops-service-badge">FREE TARGET</span></div>
          <div class="ops-kv"><span>Provider</span><b>${escapeHtml(provider)}</b><span>Mã dự án</span><b>tiny-boat-19315489</b><span>Nhánh chính</span><b>production · br-broad-resonance-aznwrpea</b><span>Khu vực</span><b>${escapeHtml(region)}</b><span>Tài khoản hoạt động</span><b>${usage.profiles_active || 0}</b><span>Tổng đợt báo thiếu</span><b>${usage.issues_total || 0}</b><span>Đợt đang xử lý</span><b>${usage.issues_active || 0}</b></div>
          ${progress('Dung lượng dữ liệu Neon', db, dbLimit)}
          <div class="ops-kv compact"><span>Log chẩn đoán đã ghi nhận</span><b>${usage.diagnostic_logs || 0} bản ghi · ${formatBytes(logBytes)}</b><span>Data API</span><b>Production</b></div>
        </article>
        <article class="ops-panel"><div class="ops-panel-title"><div><h3>Neon Free & Data API</h3><p>Hạn mức guard mà server đang áp dụng; không giả lập số đã dùng nếu không có telemetry.</p></div></div><div class="ops-limit-grid">
          ${metric('Database guard', formatBytes(dbLimit), `${dbPct.toFixed(1)}% đang dùng`)}
          ${metric('Compute guard', computeGuard ? `${computeGuard} giờ/tháng` : '—', 'mốc bảo vệ cấu hình server')}
          ${metric('Data API', 'BẬT', 'Firebase JWT + RLS/RPC')}
          ${metric('Realtime nghiệp vụ', 'Firestore', 'Firebase control-plane')}
        </div><p class="ops-note">Các chỉ số sử dụng ở trên được đọc từ Neon production. Quota không có telemetry trực tiếp không được hiển thị thành số “đã dùng”.</p></article>
        <article class="ops-panel"><div class="ops-panel-title"><div><h3>Firebase</h3><p>Auth + Firestore realtime + FCM HTTP v1 + Hosting Web</p></div><span class="ops-service-badge good">SPARK GUARD</span></div><div class="ops-kv"><span>Project</span><b>bao-hang-1291</b><span>Hosting</span><b>bao-hang-1291.web.app</b><span>FCM token hoạt động</span><b>${usage.active_device_tokens || 0}</b><span>Billing policy</span><b>Không tự bật</b><span>Deploy guard</span><b>Chặn nếu Cloud Billing được bật</b></div></article>
        <article class="ops-panel"><div class="ops-panel-title"><div><h3>GitHub & phát hành</h3><p>Public source, CI/CD và OTA</p></div><span class="ops-service-badge good">PUBLIC</span></div><div class="ops-kv"><span>Repo</span><b>tam95supra-source/bao-hang-1291</b><span>Runner policy</span><b>Standard / self-hosted</b><span>Paid runner</span><b>Không dùng</b><span>Release</span><b>Chỉ chạy khi có yêu cầu Beta/Stable</b></div></article>
        <article class="ops-panel span-two"><div class="ops-panel-title"><div><h3>Hàng rào mục tiêu $0</h3><p>Hệ thống ưu tiên dừng/giảm tải trước khi chuyển sang phương án có phí.</p></div></div><div class="ops-guard-list">
          <div class="good"><b>Neon</b><span>Production là backend nghiệp vụ; DB/compute dùng guard Free và không có cơ chế tự nâng gói.</span></div>
          <div class="good"><b>Firebase</b><span>CI kiểm tra billingEnabled=false trước mỗi lần deploy Hosting.</span></div>
          <div class="good"><b>GitHub</b><span>Repo public dùng runner chuẩn; không dùng larger runner trả phí.</span></div>
          <div class="good"><b>Supabase rollback</b><span>Chỉ giữ khả năng rollback; Web không có target mạng Supabase và cron nghiệp vụ cũ đã tắt.</span></div>
          <div class="${dbPct >= 75 ? 'warn' : 'good'}"><b>Dung lượng DB</b><span>${dbPct.toFixed(1)}% giới hạn guard. Cảnh báo sớm từ 75%, ưu tiên cleanup trước 90%.</span></div>
        </div></article>
      </div>`;
  } catch (error) {
    content.innerHTML = `${pageHeading('Hạ tầng & chi phí')}<div class="message" data-type="error">${escapeHtml(error.message)}</div>`;
  }
}

async function currentIssueBoard() {
  if (ui.issueBoardCache && Date.now() - ui.issueBoardAt < 1500) return ui.issueBoardCache;
  ui.issueBoardCache = await webApi('issue-board');
  ui.issueBoardAt = Date.now();
  return ui.issueBoardCache;
}
async function enhanceRecentIssueCards() {
  if ($('.tabs button[data-tab="events"].active') == null || ui.customView) return;
  const activeBucket = $('.subtabs button.active')?.dataset?.bucket;
  if (activeBucket !== 'recent') return;
  const board = $('#board');
  if (!board || board.dataset.opsRestoreBusy === '1') return;
  const cards = $$('.issue', board);
  if (!cards.length || cards.every((card) => card.dataset.opsIssueId)) return;
  board.dataset.opsRestoreBusy = '1';
  try {
    const data = await currentIssueBoard();
    const recent = data.recent || [];
    cards.forEach((card, index) => {
      const issue = recent[index];
      if (!issue) return;
      card.dataset.opsIssueId = issue.id;
      if (issue.status !== 'SKIP_ALLOWED') return;
      const actions = document.createElement('div');
      actions.className = 'actions ops-restore-actions';
      actions.innerHTML = `<button class="success-action" data-restore-skip="${escapeHtml(issue.id)}">ĐÃ TÌM THẤY HÀNG — HỦY BỎ QUA</button>`;
      card.appendChild(actions);
      $('[data-restore-skip]', actions).onclick = () => confirmRestoreSkip(issue);
    });
  } catch { /* Main board continues to work if the enhancement request is temporarily unavailable. */ }
  finally { if (board.isConnected) board.dataset.opsRestoreBusy = '0'; }
}
function confirmRestoreSkip(issue) {
  modal({
    title: `Hủy bỏ qua SKU ${issue.sku}`,
    confirmText: 'Xác nhận đã tìm thấy hàng',
    body: `<div class="ops-restore-summary"><b>SKU ${escapeHtml(issue.sku)} · ${escapeHtml(issue.product_name || '')}</b><p>Hành động này sửa quyết định “được phép bỏ qua” thành “đã có hàng”. Cảnh báo cho phép bỏ qua trước đó sẽ hết hiệu lực ngay.</p><ul><li>Người lấy hàng đã báo SKU này nhận cảnh báo bắt buộc: <b>KHÔNG BỎ QUA — ĐÃ CÓ HÀNG</b>.</li><li>Nhóm Người báo hàng / Admin nhận thông báo trạng thái mới.</li><li>Đợt báo tăng phiên trạng thái và ghi nhật ký riêng; không tạo đợt mới và không xóa lịch sử cho phép bỏ qua.</li></ul></div><label class="ops-modal-reason">Ghi chú lý do<input id="restoreReason" value="Đã tìm thấy hàng sau khi cho phép bỏ qua"></label><div class="ops-modal-error" hidden></div>`,
    onConfirm: async (root) => {
      const done = busy('Đang hủy quyền bỏ qua và gửi cảnh báo…');
      try {
        const result = await opsApi('restore-skipped', { issue_id: issue.id, reason: $('#restoreReason', root).value.trim() });
        toast(`SKU ${result.issue?.sku || issue.sku} đã chuyển sang ĐÃ CÓ HÀNG.`);
        ui.issueBoardCache = null;
        $('#refreshBoard')?.click();
      } finally { done(); }
    },
  });
}

function activeTabId() {
  if (ui.customView) return ui.customView;
  return $('.tabs button[data-tab].active')?.dataset?.tab || '';
}
function enhanceCurrentPage() {
  normalizeNavigation();
  if (!readSession() || !$('#content')) return;
  const tab = activeTabId();
  const content = $('#content');
  if (tab === 'overview' && isManager() && content.dataset.opsRender !== 'overview') renderOverviewView();
  else if (tab === 'users' && isManager() && content.dataset.opsRender !== 'users') renderUsersView();
  else if (['config', 'sla'].includes(tab) && isManager() && content.dataset.opsRender !== 'timing') renderTimingView();
  else if ((tab === 'services' || tab === 'server') && isManager() && content.dataset.opsRender !== 'server') renderServerView();
  else if (tab === 'events') enhanceRecentIssueCards();
}
function scheduleEnhance(delay = 120) {
  clearTimeout(ui.enhanceTimer);
  ui.enhanceTimer = setTimeout(enhanceCurrentPage, delay);
}

const observer = new MutationObserver(() => scheduleEnhance());
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('hashchange', () => scheduleEnhance(40));
window.addEventListener('pageshow', () => scheduleEnhance(40));
document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleEnhance(40); });
scheduleEnhance(40);
