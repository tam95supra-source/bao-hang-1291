const BACKEND_BRIDGE_URL = 'https://backend.bao-hang-1291.invalid';
const WEB_API = `${BACKEND_BRIDGE_URL}/api/web-api`;
const SESSION_KEY = 'bao-hang-1291-web-session';

const originalEvents = window.__BH_WV2_RENDER__?.events;

function session() {
  try {
    const value = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    return value?.access_token && value?.profile ? value : null;
  } catch { return null; }
}

function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
}

function time(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString('vi-VN', { hour12: false });
}

async function api(action, payload = {}) {
  if (globalThis.__BH_AUTH__?.ensureSession) await globalThis.__BH_AUTH__.ensureSession(false);
  const s = session();
  if (!s) throw new Error('Phiên đăng nhập không tồn tại.');
  const response = await fetch(`${WEB_API}/${encodeURIComponent(action)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: 'compat-public', authorization: `Bearer ${s.access_token}` },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text }; }
  if (!response.ok) throw new Error(body.error || body.message || `Lỗi máy chủ ${response.status}`);
  return body;
}

function openCard(issue) {
  return `<article class="wv2-issue" data-state="claimed" data-issue-id="${esc(issue.id)}" data-open-issue="1"><div class="wv2-issue-head"><div><strong>SKU ${esc(issue.sku)}</strong><span>${Number(issue.report_count || 1)} lượt báo</span></div><time>${esc(time(issue.reported_at))}</time></div><div class="wv2-product"><strong>${esc(issue.product_name || '')}</strong></div><div class="wv2-meta"><span class="wv2-status active">Chờ nhận xử lý</span></div><div class="wv2-actions"><button class="secondary" data-claim="${esc(issue.id)}">NHẬN XỬ LÝ</button></div></article>`;
}

async function patchOpenIssues() {
  const s = session();
  if (!s || !['ADMIN','ADMIN_INVENT','INVENT'].includes(s.profile?.role)) return;
  if (!document.querySelector('.tabs [data-tab="events"].active')) return;
  const root = document.querySelector('.warehouse-v2-root');
  const list = root?.querySelector('#wv2IssueList');
  const activeBucket = root?.querySelector('[data-wv2-bucket].active')?.dataset?.wv2Bucket;
  if (!root || !list || activeBucket !== 'claimed') return;

  const board = await api('issue-board');
  const claimed = Array.isArray(board.claimed) ? board.claimed : [];
  const open = Array.isArray(board.open) ? board.open : [];

  const originalCards = [...list.querySelectorAll('.wv2-issue:not([data-open-issue])')];
  originalCards.forEach((card, index) => {
    const issue = claimed[index];
    if (issue?.id) card.dataset.issueId = String(issue.id);
  });

  for (const issue of [...open].reverse()) {
    if (!issue?.id || list.querySelector(`[data-issue-id="${CSS.escape(String(issue.id))}"]`)) continue;
    list.insertAdjacentHTML('afterbegin', openCard(issue));
  }

  const count = root.querySelector('[data-wv2-bucket="claimed"] .wv2-count');
  if (count) count.textContent = String(open.length + claimed.length);

  root.querySelectorAll('[data-open-issue] [data-claim]').forEach((button) => {
    if (button.dataset.bound === '1') return;
    button.dataset.bound = '1';
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await api('claim-issue', { issue_id: button.dataset.claim });
        await window.__BH_WV2_RENDER__?.events?.();
      } catch (error) {
        alert(error.message);
        button.disabled = false;
      }
    });
  });
}

if (typeof originalEvents === 'function') {
  window.__BH_WV2_RENDER__.events = async (...args) => {
    await originalEvents(...args);
    await patchOpenIssues();
  };
}
