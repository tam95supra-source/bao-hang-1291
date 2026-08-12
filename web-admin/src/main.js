import ExcelJS from 'exceljs';
import './style.css';

const SUPABASE_URL = 'https://oedasgcdjppjwidhlqdr.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_LGgDehtHMSyeJ1XyJDvQiQ_cdlqIKq7';
const API_BASE = `${SUPABASE_URL}/functions/v1/web-api`;
const SESSION_KEY = 'bao-hang-1291-admin-session';
const MAX_FILE_BYTES = 15 * 1024 * 1024;

const state = {
  session: null,
  skuPreview: null,
  userPreview: null,
  existingUserCodes: new Set(),
  activeTab: 'overview',
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function normalize(value) {
  return String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replaceAll('đ', 'd')
    .replace(/\s+/g, ' ');
}

function employeeEmail(code) {
  const raw = String(code ?? '').trim().toLowerCase();
  const safe = raw.replace(/[^a-z0-9._-]/g, '-');
  if (!safe || safe !== raw) {
    throw new Error('Mã nhân viên chỉ được dùng chữ, số, dấu chấm, gạch ngang hoặc gạch dưới.');
  }
  return `${safe}@bao-hang-1291.local`;
}

function readSession() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    if (parsed?.access_token && parsed?.refresh_token && parsed?.profile) return parsed;
  } catch {}
  return null;
}

function saveSession(session) {
  state.session = session;
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession() {
  state.session = null;
  sessionStorage.removeItem(SESSION_KEY);
}

async function parseResponse(response) {
  const text = await response.text();
  let data = {};
  if (text) {
    try { data = JSON.parse(text); } catch { data = { error: text }; }
  }
  if (!response.ok) {
    throw new Error(data.error || data.message || `Lỗi máy chủ ${response.status}`);
  }
  return data;
}

async function authToken(payload, grantType = 'password') {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=${grantType}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify(payload),
  });
  return parseResponse(response);
}

async function fetchProfile(accessToken, userId) {
  const query = new URLSearchParams({
    id: `eq.${userId}`,
    select: 'id,employee_code,full_name,contractor,role,active',
  });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/profiles?${query}`, {
    headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${accessToken}` },
  });
  const rows = await parseResponse(response);
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('Tài khoản chưa có hồ sơ nhân sự.');
  return rows[0];
}

async function refreshSessionIfNeeded() {
  if (!state.session) throw new Error('Phiên đăng nhập không tồn tại.');
  const now = Math.floor(Date.now() / 1000);
  if ((state.session.expires_at || 0) > now + 120) return;
  const token = await authToken({ refresh_token: state.session.refresh_token }, 'refresh_token');
  saveSession({
    ...state.session,
    access_token: token.access_token,
    refresh_token: token.refresh_token || state.session.refresh_token,
    expires_at: now + Number(token.expires_in || 3600),
  });
}

async function api(action, payload = {}) {
  await refreshSessionIfNeeded();
  const response = await fetch(`${API_BASE}/${encodeURIComponent(action)}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      authorization: `Bearer ${state.session.access_token}`,
    },
    body: JSON.stringify(payload),
  });
  if (response.status === 401) {
    clearSession();
    renderLogin('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
    throw new Error('Phiên đăng nhập đã hết hạn.');
  }
  return parseResponse(response);
}

function setBusy(busy, text = 'Đang xử lý…') {
  const overlay = $('#busyOverlay');
  if (!overlay) return;
  $('#busyText').textContent = text;
  overlay.hidden = !busy;
}

function showMessage(target, message, type = 'info') {
  const box = typeof target === 'string' ? $(target) : target;
  if (!box) return;
  box.textContent = message;
  box.dataset.type = type;
  box.hidden = !message;
}

function renderLogin(message = '') {
  document.body.innerHTML = `
    <main class="login-shell">
      <section class="login-card" aria-labelledby="loginTitle">
        <div class="brand-mark">1291</div>
        <p class="eyebrow">BÁO HÀNG 1291</p>
        <h1 id="loginTitle">Admin Center</h1>
        <p class="muted">Đăng nhập bằng tài khoản INVENT ADMIN đang dùng trên ứng dụng.</p>
        <form id="loginForm" autocomplete="on">
          <label>Mã nhân viên<input id="employeeCode" autocomplete="username" required maxlength="80"></label>
          <label>Mật khẩu<input id="password" type="password" autocomplete="current-password" required maxlength="200"></label>
          <button class="primary wide" type="submit">ĐĂNG NHẬP</button>
        </form>
        <div id="loginMessage" class="message" hidden></div>
        <p class="security-note">Phiên đăng nhập chỉ lưu trong tab trình duyệt hiện tại. Web không chứa service-role key hoặc Firebase private key.</p>
      </section>
    </main>`;
  if (message) showMessage('#loginMessage', message, 'error');
  $('#loginForm').addEventListener('submit', handleLogin);
  $('#employeeCode').focus();
}

async function handleLogin(event) {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  showMessage('#loginMessage', 'Đang xác thực…');
  try {
    const code = $('#employeeCode').value.trim();
    const password = $('#password').value;
    const token = await authToken({ email: employeeEmail(code), password });
    const profile = await fetchProfile(token.access_token, token.user.id);
    if (!profile.active) throw new Error('Tài khoản đã ngừng hoạt động.');
    if (profile.role !== 'INVENT_ADMIN') throw new Error('Web quản trị chỉ dành cho INVENT ADMIN.');
    saveSession({
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + Number(token.expires_in || 3600),
      profile,
    });
    renderApp();
    await initializeAdminData();
  } catch (error) {
    showMessage('#loginMessage', error.message || String(error), 'error');
  } finally {
    button.disabled = false;
  }
}

function renderApp() {
  const profile = state.session.profile;
  document.body.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">BÁO HÀNG 1291</p>
          <h1>Admin Center</h1>
        </div>
        <div class="user-block">
          <div><strong id="headerName"></strong><span id="headerMeta"></span></div>
          <button id="logoutBtn" class="ghost">Đăng xuất</button>
        </div>
      </header>

      <nav class="tabs" aria-label="Chức năng quản trị">
        <button data-tab="overview" class="active">Tổng quan</button>
        <button data-tab="sku">SKU</button>
        <button data-tab="users">Nhân sự</button>
        <button data-tab="config">Cấu hình</button>
      </nav>

      <main class="content">
        <section id="tab-overview" class="tab-panel active">
          <div class="section-heading"><div><p class="eyebrow">TRẠNG THÁI LIVE</p><h2>Tổng quan hệ thống</h2></div><button id="refreshOverview" class="secondary">Làm mới</button></div>
          <div class="metrics" id="metrics"></div>
          <div class="panel-grid two">
            <article class="card"><h3>Đồng bộ Google Sheet</h3><p class="muted">Đẩy các sự kiện đang chờ sang file báo cáo.</p><button id="syncSheetBtn" class="secondary">ĐỒNG BỘ NGAY</button><div id="syncMessage" class="message" hidden></div></article>
            <article class="card"><h3>Nguyên tắc dữ liệu</h3><p class="muted">Import là upsert. SKU hoặc nhân sự vắng mặt trong file mới không bị xóa tự động.</p><div class="status-chip good">Không xóa dữ liệu ngoài file</div></article>
          </div>
        </section>

        <section id="tab-sku" class="tab-panel">
          <div class="section-heading"><div><p class="eyebrow">DANH MỤC</p><h2>Import SKU từ Excel</h2></div><button id="skuTemplateBtn" class="secondary">Tải file mẫu</button></div>
          <article class="card upload-card">
            <label class="drop-zone" id="skuDrop"><input id="skuFile" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"><strong>Chọn hoặc kéo thả file SKU.xlsx</strong><span>Tối đa 15 MB · đọc Sheet đầu tiên · cột SKU + Tên sản phẩm</span></label>
            <div id="skuMessage" class="message" hidden></div>
          </article>
          <section id="skuPreview" hidden></section>
        </section>

        <section id="tab-users" class="tab-panel">
          <div class="section-heading"><div><p class="eyebrow">TÀI KHOẢN</p><h2>Import nhân sự từ Excel</h2></div><a class="button-link secondary" href="/MAU_NHAN_SU_BAO_HANG_1291.xlsx" download>Tải file mẫu</a></div>
          <article class="card upload-card">
            <label class="drop-zone" id="userDrop"><input id="userFile" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"><strong>Chọn hoặc kéo thả file Nhân sự.xlsx</strong><span>Tối đa 15 MB · mật khẩu chỉ dùng khi tạo tài khoản mới</span></label>
            <div id="userMessage" class="message" hidden></div>
          </article>
          <section id="userPreview" hidden></section>
        </section>

        <section id="tab-config" class="tab-panel">
          <div class="section-heading"><div><p class="eyebrow">SLA</p><h2>Cấu hình thời gian</h2></div></div>
          <form id="configForm" class="card form-grid">
            <label>Xác nhận nhận tin (phút)<input id="ackMinutes" type="number" min="1" max="480" required></label>
            <label>Nhắc lại (phút)<input id="reminderMinutes" type="number" min="1" max="480" required></label>
            <label>Cho phép skip (phút)<input id="skipMinutes" type="number" min="1" max="480" required></label>
            <label>Thời gian xử lý/châm (phút)<input id="replenishMinutes" type="number" min="1" max="480" required></label>
            <div class="form-actions"><button class="primary" type="submit">LƯU CẤU HÌNH</button></div>
            <div id="configMessage" class="message span-all" hidden></div>
          </form>
        </section>
      </main>
    </div>
    <div id="busyOverlay" class="busy-overlay" hidden><div class="busy-card"><div class="spinner"></div><strong id="busyText">Đang xử lý…</strong></div></div>`;

  $('#headerName').textContent = profile.full_name;
  $('#headerMeta').textContent = `${profile.employee_code} · INVENT ADMIN`;
  $('#logoutBtn').addEventListener('click', logout);
  $$('.tabs button').forEach((button) => button.addEventListener('click', () => switchTab(button.dataset.tab)));
  $('#refreshOverview').addEventListener('click', loadOverview);
  $('#syncSheetBtn').addEventListener('click', syncSheet);
  $('#skuFile').addEventListener('change', (e) => previewSkuFile(e.target.files?.[0]));
  $('#userFile').addEventListener('change', (e) => previewUserFile(e.target.files?.[0]));
  $('#skuTemplateBtn').addEventListener('click', downloadSkuTemplate);
  $('#configForm').addEventListener('submit', saveConfig);
  setupDropZone('#skuDrop', '#skuFile', previewSkuFile);
  setupDropZone('#userDrop', '#userFile', previewUserFile);
}

function switchTab(tab) {
  state.activeTab = tab;
  $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${tab}`));
}

async function initializeAdminData() {
  setBusy(true, 'Đang tải dữ liệu quản trị…');
  try {
    await Promise.all([loadOverview(), loadConfig(), loadUserIndex()]);
  } catch (error) {
    console.error(error);
  } finally {
    setBusy(false);
  }
}

async function loadOverview() {
  const metrics = $('#metrics');
  if (!metrics) return;
  metrics.innerHTML = '<div class="metric loading">Đang tải…</div>';
  try {
    const data = await api('admin-summary');
    const items = [
      ['SKU', data.sku_count, 'Danh mục hiện có'],
      ['Nhân sự hoạt động', data.active_user_count, `Tổng ${data.profile_count} tài khoản`],
      ['Báo thiếu đang mở', data.active_issue_count, 'SKU đang chờ/xử lý'],
      ['Chờ Google Sheet', data.pending_sheet_count, 'Sự kiện chưa xuất'],
    ];
    metrics.replaceChildren(...items.map(([label, value, hint]) => metricCard(label, value, hint)));
  } catch (error) {
    metrics.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'message'; box.dataset.type = 'error'; box.textContent = error.message; metrics.append(box);
  }
}

function metricCard(label, value, hint) {
  const card = document.createElement('article');
  card.className = 'metric';
  const p = document.createElement('p'); p.textContent = label;
  const strong = document.createElement('strong'); strong.textContent = Number(value || 0).toLocaleString('vi-VN');
  const span = document.createElement('span'); span.textContent = hint;
  card.append(p, strong, span);
  return card;
}

async function loadUserIndex() {
  const data = await api('admin-user-index');
  state.existingUserCodes = new Set((data.employee_codes || []).map((v) => String(v).toLowerCase()));
}

async function syncSheet() {
  const button = $('#syncSheetBtn');
  button.disabled = true;
  showMessage('#syncMessage', 'Đang đồng bộ…');
  try {
    const result = await api('sync-google-sheet');
    showMessage('#syncMessage', `Hoàn tất: ${result.exported || 0} sự kiện; còn ${result.remaining || 0}.`, 'success');
    await loadOverview();
  } catch (error) {
    showMessage('#syncMessage', error.message, 'error');
  } finally { button.disabled = false; }
}

async function loadConfig() {
  try {
    const config = await api('get-config');
    $('#ackMinutes').value = config.acknowledge_minutes;
    $('#reminderMinutes').value = config.reminder_minutes;
    $('#skipMinutes').value = config.skip_minutes;
    $('#replenishMinutes').value = config.replenish_minutes;
  } catch (error) {
    showMessage('#configMessage', error.message, 'error');
  }
}

async function saveConfig(event) {
  event.preventDefault();
  const values = {
    acknowledge_minutes: Number($('#ackMinutes').value),
    reminder_minutes: Number($('#reminderMinutes').value),
    skip_minutes: Number($('#skipMinutes').value),
    replenish_minutes: Number($('#replenishMinutes').value),
  };
  if (Object.values(values).some((v) => !Number.isInteger(v) || v < 1 || v > 480)) {
    showMessage('#configMessage', 'Mỗi mốc phải là số nguyên từ 1 đến 480 phút.', 'error');
    return;
  }
  const button = event.submitter;
  button.disabled = true;
  try {
    await api('save-config', values);
    showMessage('#configMessage', 'Đã lưu cấu hình SLA.', 'success');
  } catch (error) {
    showMessage('#configMessage', error.message, 'error');
  } finally { button.disabled = false; }
}

function setupDropZone(zoneSelector, inputSelector, handler) {
  const zone = $(zoneSelector);
  const input = $(inputSelector);
  for (const eventName of ['dragenter', 'dragover']) {
    zone.addEventListener(eventName, (event) => { event.preventDefault(); zone.classList.add('dragging'); });
  }
  for (const eventName of ['dragleave', 'drop']) {
    zone.addEventListener(eventName, (event) => { event.preventDefault(); zone.classList.remove('dragging'); });
  }
  zone.addEventListener('drop', (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    const transfer = new DataTransfer(); transfer.items.add(file); input.files = transfer.files;
    handler(file);
  });
}

function ensureXlsx(file) {
  if (!file) throw new Error('Chưa chọn file.');
  if (file.size > MAX_FILE_BYTES) throw new Error('File vượt quá 15 MB.');
  if (!file.name.toLowerCase().endsWith('.xlsx')) throw new Error('Chỉ hỗ trợ file .xlsx.');
}

function cellText(cell) {
  const text = cell?.text;
  if (text != null && String(text).trim() !== '') return String(text).trim();
  const value = cell?.value;
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && value.result != null) return String(value.result).trim();
  return String(value).trim();
}

async function readRows(file) {
  ensureXlsx(file);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('Không tìm thấy Sheet đầu tiên trong file XLSX.');
  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = [];
    for (let col = 1; col <= row.cellCount; col += 1) values[col - 1] = cellText(row.getCell(col));
    rows.push(values);
  });
  if (!rows.length) throw new Error('File không có dữ liệu.');
  return rows;
}

function headerMap(row) {
  const map = new Map();
  row.forEach((value, index) => map.set(normalize(value), index));
  return map;
}

function findHeader(headers, aliases) {
  for (const alias of aliases) {
    const key = normalize(alias);
    if (headers.has(key)) return headers.get(key);
  }
  throw new Error(`Thiếu cột bắt buộc: ${aliases[0]}`);
}

async function previewSkuFile(file) {
  const section = $('#skuPreview');
  section.hidden = true;
  showMessage('#skuMessage', 'Đang đọc file…');
  setBusy(true, 'Đang kiểm tra file SKU…');
  try {
    const rows = await readRows(file);
    const headers = headerMap(rows[0]);
    const skuCol = findHeader(headers, ['sku', 'ma sku']);
    const nameCol = findHeader(headers, ['ten san pham', 'ten hang', 'product name']);
    const unique = new Map();
    let duplicateCount = 0;
    const errors = [];
    rows.slice(1).forEach((row, index) => {
      const line = index + 2;
      const sku = String(row[skuCol] || '').trim();
      const product_name = String(row[nameCol] || '').trim();
      if (!sku && !product_name) return;
      if (!sku || !product_name) { errors.push(`Dòng ${line}: thiếu SKU hoặc Tên sản phẩm`); return; }
      const previous = unique.get(sku);
      if (previous) {
        duplicateCount += 1;
        if (normalize(previous.product_name) !== normalize(product_name)) errors.push(`SKU ${sku} có nhiều tên sản phẩm khác nhau`);
        return;
      }
      unique.set(sku, { sku, product_name });
    });
    if (!unique.size) errors.push('Không tìm thấy SKU hợp lệ.');
    state.skuPreview = { fileName: file.name, items: [...unique.values()], duplicateCount, errors };
    renderImportPreview('sku');
    showMessage('#skuMessage', errors.length ? `File có ${errors.length} lỗi cần sửa trước khi import.` : `Đã kiểm tra ${unique.size.toLocaleString('vi-VN')} SKU hợp lệ.`, errors.length ? 'error' : 'success');
  } catch (error) {
    state.skuPreview = null;
    showMessage('#skuMessage', error.message, 'error');
  } finally { setBusy(false); }
}

function parseRole(value, line) {
  const v = normalize(value);
  if (['picker', 'pick', 'nguoi bao', 'nguoi bao hang'].includes(v)) return 'PICKER';
  if (['invent user', 'invent_user', 'invent'].includes(v)) return 'INVENT_USER';
  if (['invent admin', 'invent_admin', 'admin'].includes(v)) return 'INVENT_ADMIN';
  throw new Error(`Dòng ${line}: vai trò '${value}' không hợp lệ`);
}

function parseActive(value, line) {
  const v = normalize(value);
  if (['hoat dong', 'active', 'true', '1', 'co'].includes(v)) return true;
  if (['ngung', 'ngung hoat dong', 'inactive', 'false', '0', 'khong'].includes(v)) return false;
  throw new Error(`Dòng ${line}: trạng thái '${value}' không hợp lệ`);
}

async function previewUserFile(file) {
  const section = $('#userPreview');
  section.hidden = true;
  showMessage('#userMessage', 'Đang đọc file…');
  setBusy(true, 'Đang kiểm tra file nhân sự…');
  try {
    if (!state.existingUserCodes.size) await loadUserIndex();
    const rows = await readRows(file);
    const headers = headerMap(rows[0]);
    const cols = {
      code: findHeader(headers, ['ma nhan vien', 'employee code']),
      name: findHeader(headers, ['ho ten', 'ten nhan vien', 'full name']),
      contractor: findHeader(headers, ['nha thau', 'contractor']),
      role: findHeader(headers, ['vai tro', 'role']),
      active: findHeader(headers, ['trang thai', 'active']),
      password: findHeader(headers, ['mat khau khoi tao', 'mat khau', 'initial password']),
    };
    const unique = new Map();
    const errors = [];
    let createCount = 0;
    let updateCount = 0;
    rows.slice(1).forEach((row, index) => {
      const line = index + 2;
      try {
        const employee_code = String(row[cols.code] || '').trim();
        const full_name = String(row[cols.name] || '').trim();
        if (!employee_code && !full_name) return;
        if (!employee_code || !full_name) throw new Error(`Dòng ${line}: thiếu mã hoặc họ tên`);
        if (!/^[A-Za-z0-9._-]+$/.test(employee_code)) throw new Error(`Dòng ${line}: mã nhân viên không hợp lệ`);
        const key = employee_code.toLowerCase();
        if (unique.has(key)) throw new Error(`Mã nhân viên ${employee_code} bị trùng`);
        const existing = state.existingUserCodes.has(key);
        const initial_password = String(row[cols.password] || '');
        if (!existing && initial_password.length < 8) throw new Error(`Dòng ${line}: tài khoản mới cần mật khẩu ít nhất 8 ký tự`);
        const item = {
          employee_code,
          full_name,
          contractor: String(row[cols.contractor] || '').trim(),
          role: parseRole(row[cols.role], line),
          active: parseActive(row[cols.active], line),
          initial_password,
          _mode: existing ? 'Cập nhật' : 'Tạo mới',
        };
        unique.set(key, item);
        if (existing) updateCount += 1; else createCount += 1;
      } catch (error) { errors.push(error.message); }
    });
    if (!unique.size) errors.push('Không tìm thấy nhân sự hợp lệ.');
    state.userPreview = { fileName: file.name, items: [...unique.values()], createCount, updateCount, errors };
    renderImportPreview('users');
    showMessage('#userMessage', errors.length ? `File có ${errors.length} lỗi cần sửa trước khi import.` : `Hợp lệ: ${createCount} tạo mới, ${updateCount} cập nhật.`, errors.length ? 'error' : 'success');
  } catch (error) {
    state.userPreview = null;
    showMessage('#userMessage', error.message, 'error');
  } finally { setBusy(false); }
}

function renderImportPreview(kind) {
  const isSku = kind === 'sku';
  const preview = isSku ? state.skuPreview : state.userPreview;
  const section = $(`#${isSku ? 'sku' : 'user'}Preview`);
  if (!preview) { section.hidden = true; return; }
  section.hidden = false;
  section.replaceChildren();
  const card = document.createElement('article'); card.className = 'card preview-card';
  const heading = document.createElement('div'); heading.className = 'preview-heading';
  const titleWrap = document.createElement('div');
  const title = document.createElement('h3'); title.textContent = `Xem trước · ${preview.fileName}`;
  const summary = document.createElement('p'); summary.className = 'muted';
  summary.textContent = isSku
    ? `${preview.items.length.toLocaleString('vi-VN')} SKU sau khi gộp · ${preview.duplicateCount} dòng trùng`
    : `${preview.items.length.toLocaleString('vi-VN')} nhân sự · ${preview.createCount} tạo mới · ${preview.updateCount} cập nhật`;
  titleWrap.append(title, summary);
  const button = document.createElement('button'); button.className = 'primary'; button.textContent = 'XÁC NHẬN IMPORT'; button.disabled = preview.errors.length > 0;
  button.addEventListener('click', () => isSku ? importSku() : importUsers());
  heading.append(titleWrap, button); card.append(heading);

  if (preview.errors.length) {
    const errorBox = document.createElement('div'); errorBox.className = 'error-list';
    const strong = document.createElement('strong'); strong.textContent = `${preview.errors.length} lỗi:`; errorBox.append(strong);
    const ul = document.createElement('ul');
    preview.errors.slice(0, 30).forEach((message) => { const li = document.createElement('li'); li.textContent = message; ul.append(li); });
    if (preview.errors.length > 30) { const li = document.createElement('li'); li.textContent = `… và ${preview.errors.length - 30} lỗi khác`; ul.append(li); }
    errorBox.append(ul); card.append(errorBox);
  }

  const tableWrap = document.createElement('div'); tableWrap.className = 'table-wrap';
  const table = document.createElement('table');
  const headers = isSku ? ['SKU', 'Tên sản phẩm'] : ['Mã nhân viên', 'Họ tên', 'Nhà thầu', 'Vai trò', 'Trạng thái', 'Thao tác'];
  const keys = isSku ? ['sku', 'product_name'] : ['employee_code', 'full_name', 'contractor', 'role', 'active', '_mode'];
  const thead = document.createElement('thead'); const trh = document.createElement('tr');
  headers.forEach((h) => { const th = document.createElement('th'); th.textContent = h; trh.append(th); }); thead.append(trh); table.append(thead);
  const tbody = document.createElement('tbody');
  preview.items.slice(0, 20).forEach((item) => {
    const tr = document.createElement('tr');
    keys.forEach((key) => { const td = document.createElement('td'); td.textContent = key === 'active' ? (item[key] ? 'Hoạt động' : 'Ngừng') : String(item[key] ?? ''); tr.append(td); });
    tbody.append(tr);
  });
  table.append(tbody); tableWrap.append(table); card.append(tableWrap);
  if (preview.items.length > 20) { const note = document.createElement('p'); note.className = 'muted preview-limit'; note.textContent = `Chỉ hiển thị 20/${preview.items.length.toLocaleString('vi-VN')} dòng để xem trước.`; card.append(note); }
  section.append(card);
}

async function importSku() {
  const preview = state.skuPreview;
  if (!preview || preview.errors.length) return;
  setBusy(true, `Đang import 0/${preview.items.length} SKU…`);
  try {
    let imported = 0;
    for (let i = 0; i < preview.items.length; i += 1000) {
      const batch = preview.items.slice(i, i + 1000);
      await api('import-skus', { items: batch });
      imported += batch.length;
      $('#busyText').textContent = `Đang import ${imported}/${preview.items.length} SKU…`;
    }
    showMessage('#skuMessage', `Hoàn tất ${imported.toLocaleString('vi-VN')} SKU. SKU trùng đã được gộp.`, 'success');
    state.skuPreview = null; $('#skuPreview').hidden = true; $('#skuFile').value = '';
    await loadOverview();
  } catch (error) {
    showMessage('#skuMessage', `Import dừng: ${error.message}`, 'error');
  } finally { setBusy(false); }
}

async function importUsers() {
  const preview = state.userPreview;
  if (!preview || preview.errors.length) return;
  setBusy(true, `Đang import 0/${preview.items.length} nhân sự…`);
  try {
    let processed = 0, created = 0, updated = 0;
    for (let i = 0; i < preview.items.length; i += 200) {
      const items = preview.items.slice(i, i + 200).map(({ _mode, ...item }) => item);
      const result = await api('import-users', { items });
      if (Number(result.failed || 0) > 0) {
        const detail = Array.isArray(result.errors) && result.errors.length ? ` ${result.errors[0]}` : '';
        throw new Error(`${result.failed} dòng bị lỗi.${detail}`);
      }
      created += Number(result.created || 0); updated += Number(result.updated || 0); processed += items.length;
      $('#busyText').textContent = `Đang import ${processed}/${preview.items.length} nhân sự…`;
    }
    showMessage('#userMessage', `Hoàn tất: ${created} tạo mới, ${updated} cập nhật.`, 'success');
    state.userPreview = null; $('#userPreview').hidden = true; $('#userFile').value = '';
    await Promise.all([loadUserIndex(), loadOverview()]);
  } catch (error) {
    showMessage('#userMessage', `Import dừng: ${error.message}`, 'error');
  } finally { setBusy(false); }
}

async function downloadSkuTemplate() {
  setBusy(true, 'Đang tạo file mẫu SKU…');
  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('SKU');
    sheet.addRow(['SKU', 'Tên sản phẩm']);
    sheet.addRow(['12910001', 'Tên sản phẩm mẫu']);
    sheet.getRow(1).font = { bold: true };
    sheet.columns = [{ width: 20 }, { width: 48 }];
    const buffer = await workbook.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a'); a.href = url; a.download = 'MAU_SKU_BAO_HANG_1291.xlsx'; document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  } catch (error) {
    showMessage('#skuMessage', error.message, 'error');
  } finally { setBusy(false); }
}

async function logout() {
  const token = state.session?.access_token;
  clearSession();
  if (token) {
    fetch(`${SUPABASE_URL}/auth/v1/logout`, { method: 'POST', headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` } }).catch(() => {});
  }
  renderLogin();
}

async function restore() {
  const stored = readSession();
  if (!stored) { renderLogin(); return; }
  state.session = stored;
  try {
    await refreshSessionIfNeeded();
    const profile = await fetchProfile(state.session.access_token, state.session.profile.id);
    if (!profile.active || profile.role !== 'INVENT_ADMIN') throw new Error('Tài khoản không còn quyền INVENT ADMIN.');
    saveSession({ ...state.session, profile });
    renderApp();
    await initializeAdminData();
  } catch (error) {
    clearSession();
    renderLogin(error.message || 'Phiên đăng nhập không còn hợp lệ.');
  }
}

restore();
