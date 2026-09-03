import './web-fast-ui.css';
import { getLocale } from './i18n.js';

const SESSION_KEY = 'bao-hang-1291-web-session';
const BACKEND = 'https://backend.bao-hang-1291.invalid';
const API = `${BACKEND}/api/web-api`;
const ROLE_LABELS = {
  ADMIN: 'Admin hệ thống',
  ADMIN_INVENT: 'Admin Event',
  INVENT: 'Người báo hàng',
  PICKER: 'Người lấy hàng',
};

const state = {
  bucket: 'claimed',
  selectedId: '',
  board: null,
  loading: false,
  queued: false,
  deltaBusy: false,
  pendingSeq: 0,
  withdrawnLoaded: false,
  withdrawnLoading: false,
  role: '',
  boardAt: 0,
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>'"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c]));

function routeToken() {
  return typeof globalThis.__BH_ROUTE_TOKEN__ === 'function' ? globalThis.__BH_ROUTE_TOKEN__() : null;
}
function routeActive(token = null) {
  if (typeof globalThis.__BH_ROUTE_ACTIVE__ === 'function') return globalThis.__BH_ROUTE_ACTIVE__('events', token);
  return Boolean($('.tabs button[data-tab="events"].active'));
}

function session() {
  try {
    const value = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    return value?.access_token && value?.profile ? value : null;
  } catch { return null; }
}

function applyRoleState() {
  const s = session();
  const testRole = String(document.body.dataset.testRole || '').trim().toUpperCase();
  state.role = ['ADMIN_INVENT','INVENT','PICKER'].includes(testRole) ? testRole : (s?.profile?.role || '');
  if (state.role) document.body.dataset.role = state.role;
  else delete document.body.dataset.role;
}

function fixBranding() {
  document.querySelectorAll('.security').forEach((el) => {
    if (/Chuyên viên Pick Pack 1291/i.test(el.textContent || '')) {
      el.textContent = (el.textContent || '').replace(/Chuyên viên Pick Pack 1291/gi, 'Báo Hàng 1291');
    }
  });
}

async function api(action, payload = {}) {
  const s = session();
  if (!s) throw new Error('Phiên đăng nhập không tồn tại.');
  const headers = {
    'content-type': 'application/json',
    apikey: 'compat-public',
    authorization: `Bearer ${s.access_token}`,
  };
  const testRole = String(document.body.dataset.testRole || '').trim().toUpperCase();
  if (['ADMIN_INVENT','INVENT','PICKER'].includes(testRole)) headers['x-admin-test-role'] = testRole;
  const url = `${API}/${encodeURIComponent(action)}`;
  const init = { method: 'POST', headers, body: JSON.stringify(payload) };
  const response = typeof globalThis.__BH_AUTH_FETCH__ === 'function'
    ? await globalThis.__BH_AUTH_FETCH__(url, init)
    : await fetch(url, init);
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  if (!response.ok) throw new Error(data.error || data.message || `Lỗi máy chủ ${response.status}`);
  return data;
}

function fmtTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit', hour12: false });
}

function age(value) {
  if (!value) return '—';
  const min = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (min < 1) return 'vừa xong';
  if (min < 60) return `${min} phút`;
  return `${Math.floor(min / 60)}g ${min % 60}p`;
}

function statusLabel(status) {
  return ({
    OPEN: 'Chờ nhận', CLAIMED: 'Đang xử lý', SEARCHING: 'Đang xử lý',
    REPLENISHING: 'Đang xử lý', AVAILABLE: 'Đã có hàng',
    SKIP_ALLOWED: 'Cho phép bỏ qua', CLOSED: 'Đã đóng', WITHDRAWN: 'Đã thu hồi',
  })[status] || status || '—';
}

function tone(status) {
  if (['AVAILABLE','CLOSED'].includes(status)) return 'good';
  if (status === 'SKIP_ALLOWED') return 'danger';
  if (['CLAIMED','SEARCHING','REPLENISHING'].includes(status)) return 'work';
  return 'open';
}

function rowsForBucket() {
  if (!state.board) return [];
  if (state.bucket === 'withdrawn') return state.board.withdrawn || [];
  return state.board[state.bucket] || [];
}

function allRows() {
  if (!state.board) return [];
  return ['claimed','open','recent','withdrawn'].flatMap((k) => state.board[k] || []);
}

function issueSignature(issue) {
  return [issue.id, issue.issue_version, issue.status, issue.report_count, issue.assigned_id,
    issue.assigned_name, issue.latest_reporter_name, issue.updated_at, issue.withdrawn_at].join('|');
}

function cardMarkup(issue) {
  const status = state.bucket === 'withdrawn' ? 'WITHDRAWN' : issue.status;
  return `<button class="fast-issue-row ${state.selectedId === issue.id ? 'selected' : ''}" data-fast-select="${esc(issue.id)}" data-signature="${esc(issueSignature(issue))}">
    <span class="fast-sku">${esc(issue.sku)}</span>
    <span class="fast-product">${esc(issue.product_name || 'Chưa có tên SKU')}</span>
    <span class="fast-meta"><b class="fast-status ${tone(status)}">${esc(statusLabel(status))}</b><em>${Number(issue.report_count || 1)} lượt</em><em>${esc(age(issue.reported_at || issue.updated_at || issue.withdrawn_at))}</em></span>
  </button>`;
}

function ensureShell() {
  if (!routeActive()) return null;
  const content = $('#content');
  if (!content) return null;
  let shell = $('#fastEvents');
  if (shell) return shell;
  content.innerHTML = `<section id="fastEvents" class="fast-events">
    <div class="fast-page-head"><div><p class="eyebrow">BÁO HÀNG</p><h2>Xử lý báo thiếu</h2><p class="fast-subtitle">Realtime · cập nhật đúng dòng, không tải lại màn hình.</p></div><button class="secondary" id="fastRefresh">Làm mới</button></div>
    <div class="fast-buckets" role="tablist">
      <button data-fast-bucket="claimed" class="active">Đang xử lý <b data-fast-count="claimed">0</b></button>
      <button data-fast-bucket="open">Chờ nhận <b data-fast-count="open">0</b></button>
      <button data-fast-bucket="recent">Gần đây <b data-fast-count="recent">0</b></button>
      <button data-fast-bucket="withdrawn">Đã thu hồi <b data-fast-count="withdrawn">—</b></button>
    </div>
    <div class="fast-workspace">
      <div class="fast-list" id="fastList" aria-live="polite"><div class="fast-empty-row">Đang tải báo thiếu…</div></div>
      <aside class="fast-detail" id="fastDetail"><div class="fast-empty"><strong>Chọn một SKU</strong><span>Chi tiết và thao tác sẽ hiển thị tại đây.</span></div></aside>
    </div>
  </section>`;
  $('#fastRefresh').addEventListener('click', () => loadBoard(true));
  $$('#fastEvents [data-fast-bucket]').forEach((button) => button.addEventListener('click', () => {
    state.bucket = button.dataset.fastBucket;
    $$('#fastEvents [data-fast-bucket]').forEach((b) => b.classList.toggle('active', b === button));
    reconcile();
    if (state.bucket === 'withdrawn') void loadWithdrawn();
  }));
  $('#fastList').addEventListener('click', (event) => {
    const row = event.target.closest('[data-fast-select]');
    if (!row) return;
    state.selectedId = row.dataset.fastSelect;
    reconcileSelection();
    renderDetail();
  });
  $('#fastDetail').addEventListener('click', handleDetailAction);
  return shell || $('#fastEvents');
}

function reconcileSelection() {
  $$('#fastList [data-fast-select]').forEach((row) => row.classList.toggle('selected', row.dataset.fastSelect === state.selectedId));
}

function reconcileList() {
  const list = $('#fastList');
  if (!list) return;
  const rows = rowsForBucket();
  const existing = new Map($$('[data-fast-select]', list).map((el) => [el.dataset.fastSelect, el]));
  const keep = new Set();

  for (const issue of rows) {
    const id = String(issue.id || '');
    if (!id) continue;
    keep.add(id);
    let node = existing.get(id);
    const sig = issueSignature(issue);
    if (!node) {
      const wrap = document.createElement('div');
      wrap.innerHTML = cardMarkup(issue).trim();
      node = wrap.firstElementChild;
      node.classList.add('entering');
      list.appendChild(node);
      requestAnimationFrame(() => node.classList.remove('entering'));
    } else if (node.dataset.signature !== sig) {
      const wrap = document.createElement('div');
      wrap.innerHTML = cardMarkup(issue).trim();
      const fresh = wrap.firstElementChild;
      fresh.classList.add('changed');
      node.replaceWith(fresh);
      node = fresh;
      setTimeout(() => node.classList.remove('changed'), 550);
    }
    list.appendChild(node);
  }
  for (const [id, node] of existing) {
    if (!keep.has(id)) {
      node.classList.add('leaving');
      setTimeout(() => node.remove(), 160);
    }
  }
  if (!rows.length && !list.querySelector('.fast-empty-row')) {
    list.innerHTML = `<div class="fast-empty-row">Không có SKU trong nhóm này.</div>`;
  } else if (rows.length) {
    $('.fast-empty-row', list)?.remove();
  }
}

function currentIssue() {
  return rowsForBucket().find((x) => String(x.id) === String(state.selectedId)) || null;
}

function renderDetail() {
  const detail = $('#fastDetail');
  if (!detail) return;
  const issue = currentIssue();
  if (!issue) {
    detail.innerHTML = `<div class="fast-empty"><strong>Chọn một SKU</strong><span>Chi tiết và thao tác sẽ hiển thị tại đây.</span></div>`;
    return;
  }
  const bucket = state.bucket;
  const manager = ['ADMIN','ADMIN_INVENT'].includes(state.role);
  const activeStatus = ['OPEN','CLAIMED','SEARCHING','REPLENISHING'].includes(issue.status);
  const active = activeStatus && !['recent','withdrawn'].includes(bucket);
  const canAct = active && ['ADMIN','ADMIN_INVENT','INVENT'].includes(state.role);
  const currentUserId = session()?.profile?.id || '';
  const canRestore = issue.status === 'SKIP_ALLOWED' && bucket === 'recent' &&
    (['ADMIN','ADMIN_INVENT'].includes(state.role) || (state.role === 'INVENT' && String(issue.assigned_id || '') === String(currentUserId)));
  detail.innerHTML = `<div class="fast-detail-head"><div><span>SKU</span><h3>${esc(issue.sku)}</h3></div><b class="fast-status ${tone(issue.status)}">${esc(statusLabel(issue.status))}</b></div>
    <p class="fast-detail-name">${esc(issue.product_name || 'Chưa có tên SKU')}</p>
    <dl class="fast-facts">
      <div><dt>Lượt báo</dt><dd>${Number(issue.report_count || 1)}</dd></div>
      <div><dt>Người xử lý</dt><dd>${esc(issue.assigned_name || 'Chưa nhận')}</dd></div>
      <div><dt>Báo lúc</dt><dd>${esc(fmtTime(issue.reported_at))}</dd></div>
      <div><dt>Thời gian chờ</dt><dd>${esc(age(issue.reported_at))}</dd></div>
    </dl>
    ${issue.recurrence_30m ? '<div class="fast-warning">SKU báo lại trong vòng 30 phút.</div>' : ''}
    <div class="fast-actions">
      ${active && issue.status === 'OPEN' ? `<button class="secondary" data-fast-action="claim" data-id="${esc(issue.id)}">Nhận xử lý</button>` : ''}
      ${canAct ? `<button class="primary" data-fast-action="available" data-id="${esc(issue.id)}" data-sku="${esc(issue.sku)}">Có hàng</button><button class="danger" data-fast-action="skip" data-id="${esc(issue.id)}" data-sku="${esc(issue.sku)}">Cho phép bỏ qua</button>` : ''}
      ${canRestore ? `<button class="primary" data-fast-action="found" data-id="${esc(issue.id)}" data-sku="${esc(issue.sku)}">ĐÃ TÌM THẤY HÀNG</button>` : ''}
      ${manager && active ? `<button class="secondary" data-fast-action="reassign" data-id="${esc(issue.id)}" data-sku="${esc(issue.sku)}">Điều phối lại</button>` : ''}
    </div>
    <div class="fast-sync-state" id="fastSyncState" hidden></div>`;
}

function setSync(text = '') {
  const el = $('#fastSyncState');
  if (!el) return;
  el.textContent = text;
  el.hidden = !text;
  $$('#fastDetail button').forEach((b) => { b.disabled = Boolean(text); });
}

async function handleDetailAction(event) {
  const button = event.target.closest('[data-fast-action]');
  if (!button) return;
  const action = button.dataset.fastAction;
  const id = button.dataset.id;
  const sku = button.dataset.sku || '';
  try {
    if (action === 'skip') {
      if (!confirm(`Xác nhận không tìm thấy SKU ${sku} và CHO PHÉP BỎ QUA?`)) return;
      if (!confirm(`XÁC NHẬN LẦN 2\nCho phép bỏ qua SKU ${sku}?`)) return;
    }
    if (action === 'available' && !confirm(`Xác nhận SKU ${sku} đã có hàng/châm bù?`)) return;
    if (action === 'found' && !confirm(`SKU ${sku} trước đó đã được cho phép bỏ qua. Xác nhận hiện đã tìm thấy hàng và báo lại cho người lấy hàng?`)) return;
    setSync('Đang đồng bộ…');
    if (action === 'claim') await api('claim-issue', { issue_id: id, client_request_id: crypto.randomUUID() });
    if (action === 'available') await api('update-issue', { issue_id: id, action: 'AVAILABLE', client_request_id: crypto.randomUUID() });
    if (action === 'skip') await api('update-issue', { issue_id: id, action: 'NOT_FOUND', client_request_id: crypto.randomUUID() });
    if (action === 'found') await api('restore-skipped', { issue_id: id, reason: 'Đã tìm thấy hàng sau khi trước đó cho phép bỏ qua' });
    if (action === 'reassign') {
      const result = await api('list-users');
      const users = (result.users || []).filter((u) => ['INVENT','ADMIN_INVENT'].includes(u.role) && u.active);
      if (!users.length) throw new Error('Không có Người báo hàng đang hoạt động để điều phối.');
      const options = users.map((u, i) => `${i + 1}. ${u.employee_code} — ${u.full_name}`).join('\n');
      const selected = prompt(`Điều phối SKU ${sku}\n\n${options}\n\nNhập số thứ tự người nhận:`);
      if (!selected) { setSync(''); return; }
      const target = users[Number(selected) - 1];
      if (!target) throw new Error('Lựa chọn không hợp lệ.');
      const reason = prompt('Lý do điều phối lại:')?.trim();
      if (!reason) throw new Error('Cần nhập lý do điều phối.');
      await api('reassign-issue', { issue_id: id, new_assignee_id: target.id, reason, client_request_id: crypto.randomUUID() });
    }
    await loadBoard(true);
  } catch (error) {
    alert(error?.message || String(error));
  } finally { setSync(''); }
}

function updateCounts() {
  for (const key of ['claimed','open','recent','withdrawn']) {
    const el = $(`[data-fast-count="${key}"]`);
    if (!el) continue;
    if (key === 'withdrawn' && !state.withdrawnLoaded) el.textContent = '—';
    else el.textContent = String(state.board?.[key]?.length || 0);
  }
}

function reconcile() {
  if (!routeActive() || !ensureShell()) return;
  updateCounts();
  const rows = rowsForBucket();
  if (state.selectedId && !rows.some((r) => String(r.id) === String(state.selectedId))) state.selectedId = '';
  if (!state.selectedId && rows.length) state.selectedId = String(rows[0].id || '');
  reconcileList();
  reconcileSelection();
  renderDetail();
}

async function loadWithdrawn() {
  if (!routeActive() || state.withdrawnLoading) return;
  const token = routeToken();
  state.withdrawnLoading = true;
  try {
    const data = await api('withdrawn-board');
    if (!routeActive(token)) return;
    state.board = { ...(state.board || {}), withdrawn: data.withdrawn || [] };
    state.withdrawnLoaded = true;
    if (state.bucket === 'withdrawn') reconcile();
    else updateCounts();
  } catch (error) {
    if (routeActive(token) && state.bucket === 'withdrawn') {
      const list = $('#fastList');
      if (list) list.innerHTML = `<div class="message" data-type="error">${esc(error?.message || String(error))}</div>`;
    }
  } finally {
    state.withdrawnLoading = false;
  }
}

async function loadBoard(force = false) {
  if (!routeActive()) return;
  if (!force && state.board && Date.now() - state.boardAt < 5000) {
    ensureShell();
    reconcile();
    return;
  }
  if (state.loading) { state.queued = true; return; }
  const token = routeToken();
  state.loading = true;
  ensureShell();
  try {
    const main = await api('issue-board');
    if (!routeActive(token)) return;
    state.board = { ...main, withdrawn: state.board?.withdrawn || [], realtime_seq: Number(main.realtime_seq || 0) };
    state.boardAt = Date.now();
    if (!force && state.bucket === 'claimed' && !(state.board.claimed || []).length && (state.board.open || []).length) state.bucket = 'open';
    document.querySelectorAll('#fastEvents [data-fast-bucket]').forEach((b) => b.classList.toggle('active', b.dataset.fastBucket === state.bucket));
    reconcile();
    if (state.bucket === 'withdrawn') void loadWithdrawn();
  } catch (error) {
    if (!routeActive(token)) return;
    const list = $('#fastList');
    if (list && !state.board) list.innerHTML = `<div class="message" data-type="error">${esc(error?.message || String(error))}</div>`;
  } finally {
    state.loading = false;
    if (state.queued) {
      state.queued = false;
      if (routeActive()) setTimeout(() => loadBoard(true), 120);
    }
  }
}

function removeIssueFromBoard(issueId) {
  if (!state.board) return;
  for (const key of ['open','claimed','recent']) {
    state.board[key] = (state.board[key] || []).filter((item) => String(item.id) !== String(issueId));
  }
}

function addVisibleIssue(issue) {
  if (!state.board || !issue) return;
  removeIssueFromBoard(issue.id);
  if (['OPEN','CLAIMED','SEARCHING','REPLENISHING'].includes(issue.status)) {
    const key = issue.status === 'OPEN' ? 'open' : 'claimed';
    state.board[key] = [...(state.board[key] || []), issue];
  } else if (['AVAILABLE','SKIP_ALLOWED'].includes(issue.status)) {
    state.board.recent = [issue, ...(state.board.recent || [])];
  }
}

async function applyIssueSignal(signal = {}) {
  if (!routeActive()) {
    state.boardAt = 0;
    return;
  }
  const token = routeToken();
  const incomingSeq = Number(signal.event_id || signal.realtime_event_id || 0);
  state.pendingSeq = Math.max(state.pendingSeq, incomingSeq);
  if (state.deltaBusy) return;
  state.deltaBusy = true;
  try {
    while (state.board) {
      const afterSeq = Number(state.board.realtime_seq || 0);
      if (incomingSeq > 0 && incomingSeq <= afterSeq && state.pendingSeq <= afterSeq) break;
      const delta = await api('issue-delta', { after_seq: afterSeq, limit: 200 });
      if (delta.requires_full_reconcile) {
        await loadBoard(true);
        break;
      }
      let withdrawnChanged = false;
      for (const event of delta.events || []) {
        removeIssueFromBoard(event.entity_id);
        if (event.visible && event.issue) addVisibleIssue(event.issue);
        withdrawnChanged ||= Boolean(event.withdrawn_changed);
      }
      state.board.realtime_seq = Number(delta.latest_seq || afterSeq);
      if (withdrawnChanged) {
        state.withdrawnLoaded = false;
        if (state.bucket === 'withdrawn') await loadWithdrawn();
      }
      if (!routeActive(token)) return;
      reconcile();
      if (delta.has_more) continue;
      if (state.pendingSeq > state.board.realtime_seq) {
        state.pendingSeq = 0;
        continue;
      }
      state.pendingSeq = 0;
      break;
    }
  } catch (error) {
    console.warn('issue delta reconcile failed', error?.message || error);
    await loadBoard(true).catch(() => {});
  } finally {
    state.deltaBusy = false;
  }
}

async function renderFastEvents() {
  if (!routeActive()) return;
  applyRoleState();
  if (!ensureShell()) return;
  await loadBoard(false);
}

function installRenderer() {
  const renderers = globalThis.__BH_WV2_RENDER__ || (globalThis.__BH_WV2_RENDER__ = {});
  renderers.events = renderFastEvents;
}

function enhanceStaticUi() {
  applyRoleState();
  fixBranding();
  const profile = session()?.profile;
  const roleLabel = profile ? (ROLE_LABELS[profile.role] || profile.role) : '';
  const roleNode = $('.user span');
  if (roleNode && roleLabel && roleNode.textContent !== roleLabel) roleNode.textContent = roleLabel;
}

globalThis.__BH_FAST_ISSUE_SIGNAL__ = applyIssueSignal;
globalThis.__BH_FAST_REFRESH__ = () => routeActive() ? loadBoard(true) : Promise.resolve();
globalThis.__BH_FAST_ENHANCE__ = enhanceStaticUi;
globalThis.__BH_FAST_INSTALL__ = installRenderer;
enhanceStaticUi();
installRenderer();
