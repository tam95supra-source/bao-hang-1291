import { getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, doc, onSnapshot } from 'firebase/firestore';

const FIREBASE_PROJECT = 'bao-hang-1291';
const FIREBASE_API_KEY = 'AIzaSyB-n368fntzxsuuLlvte9NXhcuX0DDbTXM';
const SESSION_KEY = 'bao-hang-1291-web-session';
const BACKEND = 'https://backend.bao-hang-1291.invalid';

let unsubscribe = null;
let boundUid = '';
let firstSnapshot = true;
let lastMarker = '';
const versions = new Map();
let reconcileBusy = false;
let reconcileQueued = false;

window.__BH_PICKER_REALTIME_METRICS__ ||= { events: 0, patchedCards: 0, alertPatches: 0, staleIgnored: 0, duplicateIgnored: 0, fullScreenRenders: 0 };

function session() {
  try {
    const value = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    return value?.access_token && value?.profile ? value : null;
  } catch { return null; }
}

function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c]));
}

function fmt(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('vi-VN', { hour12: false });
}

function statusLabel(status) {
  return ({ OPEN:'Chờ nhận', CLAIMED:'Đang xử lý', SEARCHING:'Đang xử lý', REPLENISHING:'Đang xử lý', AVAILABLE:'Đã có hàng', SKIP_ALLOWED:'Được phép SKIP', CLOSED:'Đã đóng', WITHDRAWN:'Đã thu hồi' })[status] || status || '—';
}

function issueMarkup(issue) {
  return `<article class="card" data-picker-issue="${esc(issue.id)}" data-picker-version="${Number(issue.issue_version || 0)}"><strong>${esc(statusLabel(issue.status))} · SKU ${esc(issue.sku)}</strong><p>${esc(issue.product_name)}</p><small>${issue.status === 'WITHDRAWN' ? `Thu hồi lúc ${fmt(issue.withdrawn_at)}` : `Báo lúc ${fmt(issue.reported_at)}`}</small>${issue.can_withdraw ? `<button class="danger" data-picker-withdraw="${esc(issue.id)}" data-sku="${esc(issue.sku)}">THU HỒI BÁO THIẾU</button>` : ''}</article>`;
}

async function api(path, body = {}) {
  const s = session();
  if (!s) throw new Error('AUTH_REQUIRED');
  const response = await fetch(`${BACKEND}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: 'compat-public', authorization: `Bearer ${s.access_token}` },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  if (!response.ok) throw new Error(data.error || data.message || `HTTP_${response.status}`);
  return data;
}

function preserveUi() {
  const active = document.activeElement;
  return {
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    focusId: active?.id || '',
    search: document.querySelector('#skuSearch')?.value ?? null,
    selected: document.querySelector('#selectedSku')?.innerHTML ?? null,
    tabHash: location.hash,
  };
}

function restoreUi(snapshot) {
  const input = document.querySelector('#skuSearch');
  if (input && snapshot.search !== null && input.value !== snapshot.search) input.value = snapshot.search;
  const selected = document.querySelector('#selectedSku');
  if (selected && snapshot.selected !== null && selected.innerHTML !== snapshot.selected) selected.innerHTML = snapshot.selected;
  if (snapshot.focusId && document.getElementById(snapshot.focusId)) document.getElementById(snapshot.focusId).focus({ preventScroll: true });
  if (location.hash !== snapshot.tabHash) history.replaceState(null, '', snapshot.tabHash);
  window.scrollTo(snapshot.scrollX, snapshot.scrollY);
}

function bindWithdrawButtons(root = document) {
  root.querySelectorAll?.('[data-picker-withdraw]').forEach((button) => {
    if (button.dataset.bound === '1') return;
    button.dataset.bound = '1';
    button.addEventListener('click', async () => {
      const issueId = button.dataset.pickerWithdraw;
      const sku = button.dataset.sku || '';
      if (!confirm(`Thu hồi báo thiếu SKU ${sku}?\n\nChỉ có thể thu hồi trong 30 giây kể từ lúc báo.`)) return;
      button.disabled = true;
      try {
        await api('/api/issue-withdraw/withdraw', { issue_id: issueId });
        await patchIssue(issueId);
      } catch (error) {
        alert(error?.message || String(error));
      } finally { button.disabled = false; }
    });
  });
}

async function patchIssue(issueId) {
  const target = document.querySelector('#myIssues');
  if (!target) return;
  const before = preserveUi();
  const data = await api('/api/issue-withdraw/my');
  const issue = (data.issues || []).find((item) => String(item.id) === String(issueId));
  let existing = target.querySelector(`[data-picker-issue="${CSS.escape(String(issueId))}"]`);
  if (!existing && issue) {
    existing = [...target.querySelectorAll(':scope > article.card')].find((node) => (node.textContent || '').includes(`SKU ${issue.sku}`)) || null;
  }
  if (!issue) {
    existing?.remove();
  } else if (existing) {
    existing.outerHTML = issueMarkup(issue);
  } else {
    target.insertAdjacentHTML('afterbegin', issueMarkup(issue));
  }
  bindWithdrawButtons(target);
  restoreUi(before);
  window.__BH_PICKER_REALTIME_METRICS__.patchedCards++;
}

async function patchPendingAlert() {
  const target = document.querySelector('#pendingAlert');
  if (!target) return;
  const data = await api('/api/web-api/pending-alerts');
  const event = data.events?.[0];
  if (!event) { target.innerHTML = ''; return; }
  await api('/api/web-api/mark-alert-received', { event_id: event.id }).catch(() => {});
  target.innerHTML = `<div class="alert-modal" data-picker-alert="${esc(event.id)}"><div><p class="eyebrow">CẢNH BÁO BẮT BUỘC XÁC NHẬN</p><h2>${esc(event.title)}</h2><p>${esc(event.message)}</p><p class="muted">Trạng thái server v${Number(event.issue_version || 1)}</p><button id="ackAlertRealtime" class="primary wide">ĐÃ HIỂU</button></div></div>`;
  await api('/api/web-api/mark-alert-displayed', { event_id: event.id }).catch(() => {});
  document.querySelector('#ackAlertRealtime')?.addEventListener('click', async () => {
    const button = document.querySelector('#ackAlertRealtime');
    if (button) button.disabled = true;
    try {
      await api('/api/web-api/ack-alert', { event_id: event.id });
      target.innerHTML = '';
      await patchIssue(event.issue_id).catch(() => {});
    } catch (error) { alert(error?.message || String(error)); }
    finally { if (button?.isConnected) button.disabled = false; }
  });
  window.__BH_PICKER_REALTIME_METRICS__.alertPatches++;
}

async function reconcileEvent(event) {
  const issueId = String(event.entity_id || '');
  if (!issueId) return;
  if (reconcileBusy) { reconcileQueued = true; return; }
  reconcileBusy = true;
  try {
    await Promise.all([patchIssue(issueId), patchPendingAlert()]);
  } finally {
    reconcileBusy = false;
    if (reconcileQueued) {
      reconcileQueued = false;
      queueMicrotask(() => reconcileEvent(event));
    }
  }
}

function marker(event) {
  return [event.event_id || '', event.entity_id || '', event.entity_version || '', event.created_at?.toMillis?.() || event.created_at || '', event.source || ''].join('|');
}

async function attach() {
  const s = session();
  const pickerReady = s?.profile?.role === 'PICKER' && document.querySelector('#skuSearch');
  if (!pickerReady) {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    boundUid = '';
    return;
  }
  if (unsubscribe && boundUid === s.profile.id) return;
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
  boundUid = '';

  const app = getApps()[0] || initializeApp({ apiKey: FIREBASE_API_KEY, authDomain: `${FIREBASE_PROJECT}.web.app`, projectId: FIREBASE_PROJECT });
  const auth = getAuth(app);
  if (typeof auth.authStateReady === 'function') await auth.authStateReady();
  if (!auth.currentUser || auth.currentUser.uid !== s.profile.id) return;

  boundUid = s.profile.id;
  firstSnapshot = true;
  lastMarker = '';
  versions.clear();
  const firestore = getFirestore(app);
  unsubscribe = onSnapshot(doc(firestore, 'realtime', 'issues'), (snapshot) => {
    if (!snapshot.exists() || snapshot.metadata?.hasPendingWrites) return;
    const event = snapshot.data() || {};
    const currentMarker = marker(event);
    if (firstSnapshot) { firstSnapshot = false; lastMarker = currentMarker; return; }
    if (currentMarker === lastMarker) { window.__BH_PICKER_REALTIME_METRICS__.duplicateIgnored++; return; }
    lastMarker = currentMarker;
    const id = String(event.entity_id || '');
    const version = Number(event.entity_version || 0);
    const previous = versions.get(id) || 0;
    if (version && previous && version <= previous) { window.__BH_PICKER_REALTIME_METRICS__.staleIgnored++; return; }
    if (version) versions.set(id, version);
    window.__BH_PICKER_REALTIME_METRICS__.events++;
    void reconcileEvent(event).catch((error) => console.warn('picker realtime patch failed', error?.message || error));
  }, (error) => {
    unsubscribe = null;
    boundUid = '';
    console.warn('picker realtime channel failed', error?.message || error);
    queueMicrotask(() => attach().catch(() => {}));
  });

  bindWithdrawButtons(document);
}

const observer = new MutationObserver(() => { queueMicrotask(() => attach().catch(() => {})); });
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('pageshow', () => attach().catch(() => {}));
window.addEventListener('hashchange', () => attach().catch(() => {}));
setTimeout(() => attach().catch(() => {}), 0);
