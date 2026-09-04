import './workflow-v3-overrides.css';
import { getLocale, t } from './i18n.js';

const BACKEND = 'https://backend.bao-hang-1291.invalid';
const API = `${BACKEND}/api/web-api`;
const SESSION_KEY = 'bao-hang-1291-web-session';
const ACTIVE_STATUSES = new Set(['OPEN','CLAIMED','SEARCHING','REPLENISHING']);
const MANAGER_ROLES = new Set(['ADMIN','ADMIN_INVENT']);
const PROCESS_ROLES = new Set(['ADMIN','ADMIN_INVENT','INVENT']);

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>'"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c]));
const tr = (vi, en) => t(vi, en);

function session() {
  try {
    const value = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    return value?.access_token && value?.profile ? value : null;
  } catch { return null; }
}
function role() {
  const test = String(document.body?.dataset?.testRole || '').trim().toUpperCase();
  return ['ADMIN_INVENT','INVENT','PICKER'].includes(test) ? test : (session()?.profile?.role || 'PICKER');
}
function testRole() {
  const value = String(document.body?.dataset?.testRole || '').trim().toUpperCase();
  return ['ADMIN_INVENT','INVENT','PICKER'].includes(value) ? value : null;
}
function routeActive(tab) {
  if (typeof globalThis.__BH_ROUTE_ACTIVE__ === 'function') return globalThis.__BH_ROUTE_ACTIVE__(tab);
  return Boolean($(`.tabs button[data-tab="${tab}"].active`));
}
function routeToken() { return typeof globalThis.__BH_ROUTE_TOKEN__ === 'function' ? globalThis.__BH_ROUTE_TOKEN__() : null; }
function stillActive(tab, token) { return routeActive(tab) && (token == null || routeToken() === token); }

async function parseResponse(response) {
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  if (!response.ok) throw new Error(data.error || data.message || `${tr('Lỗi máy chủ','Server error')} ${response.status}`);
  return data;
}
async function authFetch(url, init) {
  if (typeof globalThis.__BH_AUTH_FETCH__ === 'function') return globalThis.__BH_AUTH_FETCH__(url, init);
  const s = session();
  if (!s) throw new Error(tr('Phiên đăng nhập không tồn tại.','No active login session.'));
  const headers = new Headers(init?.headers || {});
  headers.set('authorization', `Bearer ${s.access_token}`);
  return fetch(url, { ...init, headers });
}
async function api(action, payload = {}) {
  return parseResponse(await authFetch(`${API}/${encodeURIComponent(action)}`, {
    method: 'POST', headers: { 'content-type':'application/json' }, body: JSON.stringify(payload),
  }));
}
async function rpc(name, payload = {}) {
  return parseResponse(await authFetch(`${BACKEND}/data/rpc/${encodeURIComponent(name)}`, {
    method: 'POST', headers: { 'content-type':'application/json' },
    body: JSON.stringify({ ...payload, p_test_role: testRole() }),
  }));
}

function formatDateTime(value, seconds = false) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString(getLocale(), { hour12:false, second: seconds ? '2-digit' : undefined });
}
function formatClock(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString(getLocale(), { hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false });
}
function ageMinutes(value) {
  if (!value) return 0;
  const ms = Date.now() - new Date(value).getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 60000)) : 0;
}
function ageLabel(value) {
  const min = ageMinutes(value);
  if (min < 1) return tr('vừa xong','just now');
  if (min < 60) return `${min} ${tr('phút','min')}`;
  return `${Math.floor(min/60)}${tr('g','h')} ${min%60}${tr('p','m')}`;
}
function durationMinutes(start, end) {
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 60000)) : null;
}
function statusLabel(status) {
  return ({
    OPEN: tr('Đang xử lý','In progress'), CLAIMED: tr('Đang xử lý','In progress'),
    SEARCHING: tr('Đang xử lý','In progress'), REPLENISHING: tr('Đang xử lý','In progress'),
    AVAILABLE: tr('Đã có hàng','Available'), SKIP_ALLOWED: tr('Đã bỏ qua','Skipped'),
    CLOSED: tr('Đã đóng','Closed'), WITHDRAWN: tr('Picker thu hồi','Picker withdrawal'),
  })[status] || status || '—';
}
function statusTone(status) {
  if (status === 'AVAILABLE') return 'good';
  if (status === 'SKIP_ALLOWED') return 'danger';
  if (status === 'WITHDRAWN') return 'muted';
  return 'work';
}
function metric(label, value, detail = '', tone = '') {
  return `<article class="wv3-metric ${tone}"><span>${esc(label)}</span><strong>${esc(value)}</strong>${detail ? `<small>${esc(detail)}</small>` : ''}</article>`;
}
function ratio(n, d) { return d > 0 ? Math.round(Number(n || 0) / d * 1000) / 10 : 0; }
function pct(value) { return `${Number(value || 0).toLocaleString(getLocale(), { maximumFractionDigits:1 })}%`; }
function localDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Bangkok', year:'numeric', month:'2-digit', day:'2-digit' }).format(date);
}
function localMidnightIso(dateKey) { return new Date(`${dateKey}T00:00:00+07:00`).toISOString(); }
function nextLocalMidnightIso(dateKey) {
  const d = new Date(`${dateKey}T00:00:00+07:00`); d.setUTCDate(d.getUTCDate()+1); return d.toISOString();
}
function dayRange(days) {
  const end = new Date();
  const start = new Date(end.getTime() - Math.max(0, days-1) * 86400000);
  return { from: localMidnightIso(localDateKey(start)), to: end.toISOString() };
}

const eventsState = {
  bucket:'active', selectedId:'', board:null, boardAt:0, loading:false, queued:false,
  deltaBusy:false, pendingSeq:0, withdrawnLoaded:false, withdrawnLoading:false,
};
function normalizeBoard(board = {}) {
  const activeMap = new Map();
  [...(board.open || []), ...(board.claimed || [])].forEach((x) => { if (x?.id) activeMap.set(String(x.id), x); });
  const recent = board.recent || [];
  return {
    ...board,
    active:[...activeMap.values()].sort((a,b) => new Date(a.reported_at)-new Date(b.reported_at)),
    available:(board.available || recent.filter((x) => x.status === 'AVAILABLE')).sort((a,b) => new Date(b.updated_at)-new Date(a.updated_at)),
    skipped:(board.skipped || recent.filter((x) => x.status === 'SKIP_ALLOWED')).sort((a,b) => new Date(b.updated_at)-new Date(a.updated_at)),
    withdrawn:(board.withdrawn || []).sort((a,b) => new Date(b.withdrawn_at || b.updated_at)-new Date(a.withdrawn_at || a.updated_at)),
    realtime_seq:Number(board.realtime_seq || 0),
  };
}
function eventRows() { return eventsState.board?.[eventsState.bucket] || []; }
function eventSignature(i) {
  return [i.id,i.issue_version,i.status,i.report_count,i.latest_reporter_name,i.handled_by_name,i.latest_message,i.updated_at,i.withdrawn_at].join('|');
}
function eventCard(i) {
  const status = eventsState.bucket === 'withdrawn' ? 'WITHDRAWN' : i.status;
  return `<button class="fast-issue-row ${eventsState.selectedId===String(i.id)?'selected':''}" data-wv3-select="${esc(i.id)}" data-signature="${esc(eventSignature(i))}">
    <span class="fast-sku">${esc(i.sku)}</span>
    <span class="fast-product">${esc(i.product_name || tr('Chưa có tên SKU','SKU name unavailable'))}</span>
    <span class="fast-meta"><b class="fast-status ${statusTone(status)}">${esc(statusLabel(status))}</b><em>${Number(i.report_count || 1)} ${esc(tr('lượt','reports'))}</em><em>${esc(ageLabel(i.reported_at || i.updated_at || i.withdrawn_at))}</em></span>
  </button>`;
}
function ensureEventsShell() {
  if (!routeActive('events')) return null;
  const content = $('#content'); if (!content) return null;
  let shell = $('#workflowV3Events'); if (shell) return shell;
  content.innerHTML = `<section id="workflowV3Events" class="fast-events workflow-v3-events">
    <div class="fast-page-head"><div><p class="eyebrow">${esc(tr('XỬ LÝ BÁO HÀNG','SHORTAGE HANDLING'))}</p><h2>${esc(tr('Xử lý báo hàng','Shortage handling'))}</h2><p class="fast-subtitle">${esc(tr('Realtime · cập nhật đúng SKU, không tải lại toàn màn hình.','Realtime · only the affected SKU is updated, without a full-page reload.'))}</p></div><button class="secondary" id="wv3EventsRefresh">${esc(tr('Làm mới','Refresh'))}</button></div>
    <div class="fast-buckets wv3-four-tabs" role="tablist">
      <button data-wv3-bucket="active" class="active">${esc(tr('Đang xử lý','In progress'))} <b data-wv3-count="active">0</b></button>
      <button data-wv3-bucket="available">${esc(tr('Đã có hàng','Available'))} <b data-wv3-count="available">0</b></button>
      <button data-wv3-bucket="skipped">${esc(tr('Đã bỏ qua','Skipped'))} <b data-wv3-count="skipped">0</b></button>
      <button data-wv3-bucket="withdrawn">${esc(tr('Picker thu hồi','Picker withdrawal'))} <b data-wv3-count="withdrawn">—</b></button>
    </div>
    <div id="wv3InventoryAlert" class="fast-warning wv3-inventory-alert" hidden></div><div class="fast-workspace"><div class="fast-list" id="wv3EventsList" aria-live="polite"><div class="fast-empty-row">${esc(tr('Đang tải yêu cầu báo thiếu…','Loading shortage requests…'))}</div></div><aside class="fast-detail" id="wv3EventsDetail"><div class="fast-empty"><strong>${esc(tr('Chọn một SKU','Select an SKU'))}</strong><span>${esc(tr('Chi tiết và thao tác sẽ hiển thị tại đây.','Details and actions appear here.'))}</span></div></aside></div>
  </section>`;
  $('#wv3EventsRefresh').onclick = () => void loadEventsBoard(true);
  $$('[data-wv3-bucket]', shell).forEach((b) => b.onclick = () => {
    eventsState.bucket = b.dataset.wv3Bucket; eventsState.selectedId='';
    $$('[data-wv3-bucket]', shell).forEach((x) => x.classList.toggle('active', x===b));
    reconcileEvents(); if (eventsState.bucket==='withdrawn') void loadWithdrawn();
  });
  $('#wv3EventsList').onclick = (e) => { const row=e.target.closest('[data-wv3-select]'); if(!row)return; eventsState.selectedId=row.dataset.wv3Select; reconcileEventsSelection(); renderEventsDetail(); };
  $('#wv3EventsDetail').onclick = handleEventAction;
  return shell;
}
function updateEventsCounts() {
  ['active','available','skipped','withdrawn'].forEach((key) => {
    const node=$(`[data-wv3-count="${key}"]`); if(!node)return;
    node.textContent = key==='withdrawn' && !eventsState.withdrawnLoaded ? '—' : String(eventsState.board?.[key]?.length || 0);
  });
  const alert=$('#wv3InventoryAlert');
  if(alert){const threshold=Number(eventsState.board?.scope?.inventory_reminder_minutes||0);const overdue=(eventsState.board?.active||[]).filter((i)=>threshold>0&&ageMinutes(i.reported_at)>=threshold);alert.hidden=!overdue.length;alert.textContent=overdue.length?tr(`${overdue.length} SKU chưa được xử lí sau mốc ${threshold} phút. Ưu tiên SKU chờ lâu nhất.`,`${overdue.length} SKU(s) remain unresolved past the ${threshold}-minute threshold. Prioritize the oldest.`):'';}
}
function reconcileEventsList() {
  const list=$('#wv3EventsList'); if(!list)return;
  const rows=eventRows(); const existing=new Map($$('[data-wv3-select]',list).map((x)=>[x.dataset.wv3Select,x])); const keep=new Set();
  rows.forEach((i) => {
    const id=String(i.id||''); if(!id)return; keep.add(id); const sig=eventSignature(i); let node=existing.get(id);
    if(!node){const w=document.createElement('div');w.innerHTML=eventCard(i).trim();node=w.firstElementChild;node.classList.add('entering');list.appendChild(node);requestAnimationFrame(()=>node.classList.remove('entering'));}
    else if(node.dataset.signature!==sig){const w=document.createElement('div');w.innerHTML=eventCard(i).trim();const fresh=w.firstElementChild;fresh.classList.add('changed');node.replaceWith(fresh);node=fresh;setTimeout(()=>node.classList.remove('changed'),550);}
    list.appendChild(node);
  });
  existing.forEach((node,id)=>{if(!keep.has(id))node.remove();});
  if(!rows.length) list.innerHTML=`<div class="fast-empty-row">${esc(tr('Không có SKU trong nhóm này.','No SKUs in this group.'))}</div>`;
  else $('.fast-empty-row',list)?.remove();
}
function reconcileEventsSelection() { const root=$('#wv3EventsList'); if(!root)return; $$('[data-wv3-select]',root).forEach((x)=>x.classList.toggle('selected',x.dataset.wv3Select===eventsState.selectedId)); }
function currentEventIssue() { return eventRows().find((x)=>String(x.id)===String(eventsState.selectedId)) || null; }
function renderEventsDetail() {
  const detail=$('#wv3EventsDetail'); if(!detail)return; const i=currentEventIssue();
  if(!i){detail.innerHTML=`<div class="fast-empty"><strong>${esc(tr('Chọn một SKU','Select an SKU'))}</strong><span>${esc(tr('Chi tiết và thao tác sẽ hiển thị tại đây.','Details and actions appear here.'))}</span></div>`;return;}
  const r=role(); const active=ACTIVE_STATUSES.has(i.status) && eventsState.bucket==='active'; const canAct=active && PROCESS_ROLES.has(r); const canRestore=i.status==='SKIP_ALLOWED' && eventsState.bucket==='skipped' && PROCESS_ROLES.has(r);
  const handler = eventsState.bucket==='withdrawn' ? '' : String(i.handled_by_name || '').trim();
  const note = String(i.latest_message || '').trim();
  detail.innerHTML=`<div class="fast-detail-head"><div><span>SKU</span><h3>${esc(i.sku)}</h3></div><b class="fast-status ${statusTone(eventsState.bucket==='withdrawn'?'WITHDRAWN':i.status)}">${esc(statusLabel(eventsState.bucket==='withdrawn'?'WITHDRAWN':i.status))}</b></div>
    <p class="fast-detail-name">${esc(i.product_name || tr('Chưa có tên SKU','SKU name unavailable'))}</p>
    <dl class="fast-facts">
      <div><dt>${esc(tr('Lượt báo','Reports'))}</dt><dd>${Number(i.report_count||1)}</dd></div>
      <div><dt>${esc(tr('Báo lúc','Reported at'))}</dt><dd>${esc(formatClock(i.reported_at))}</dd></div>
      <div><dt>${esc(tr('Thời gian chờ','Waiting time'))}</dt><dd>${esc(ageLabel(i.reported_at))}</dd></div>
      <div><dt>${esc(tr('Người báo gần nhất','Latest reporter'))}</dt><dd>${esc(i.latest_reporter_name || '—')}</dd></div>
      ${handler ? `<div><dt>${esc(tr('Người xử lí','Handled by'))}</dt><dd>${esc(handler)}</dd></div>` : ''}
      ${eventsState.bucket==='withdrawn' ? `<div><dt>${esc(tr('Thu hồi lúc','Withdrawn at'))}</dt><dd>${esc(formatClock(i.withdrawn_at || i.updated_at))}</dd></div>` : ''}
    </dl>
    ${note ? `<div class="fast-warning wv3-note">${esc(note)}</div>` : ''}
    ${i.recurrence_30m ? `<div class="fast-warning">${esc(tr('SKU báo lại trong vòng 30 phút.','SKU was reported again within 30 minutes.'))}</div>` : ''}
    <div class="fast-actions">
      ${canAct?`<button class="primary" data-wv3-action="available" data-id="${esc(i.id)}" data-sku="${esc(i.sku)}">${esc(tr('Có hàng','Available'))}</button><button class="danger" data-wv3-action="skip" data-id="${esc(i.id)}" data-sku="${esc(i.sku)}">${esc(tr('Cho SKIP','Allow SKIP'))}</button>`:''}
      ${canRestore?`<button class="primary" data-wv3-action="found" data-id="${esc(i.id)}" data-sku="${esc(i.sku)}">${esc(tr('Báo lại đã có hàng','Report item available'))}</button>`:''}
    </div><div class="fast-sync-state" id="wv3SyncState" hidden></div>`;
}
function eventBusy(text='') { const el=$('#wv3SyncState'); if(el){el.textContent=text;el.hidden=!text;} $$('#wv3EventsDetail button').forEach((b)=>b.disabled=Boolean(text)); }
async function handleEventAction(e) {
  const b=e.target.closest('[data-wv3-action]'); if(!b)return; const action=b.dataset.wv3Action,sku=b.dataset.sku,id=b.dataset.id;
  if(action==='available'&&!confirm(tr(`Xác nhận SKU ${sku} đã có hàng?`,`Confirm SKU ${sku} is available?`)))return;
  if(action==='skip'){if(!confirm(tr(`Không tìm thấy SKU ${sku}. Cho Người lấy hàng SKIP SKU này?`,`SKU ${sku} was not found. Allow the picker to SKIP it?`)))return;if(!confirm(tr(`Xác nhận lần cuối: cho phép bỏ qua SKU ${sku}?`,`Final confirmation: allow skip for SKU ${sku}?`)))return;}
  if(action==='found'&&!confirm(tr(`SKU ${sku} trước đó đã bỏ qua. Xác nhận hiện đã có hàng?`,`SKU ${sku} was previously skipped. Confirm it is now available?`)))return;
  try{eventBusy(tr('Đang cập nhật…','Updating…')); if(action==='available')await api('update-issue',{issue_id:id,action:'AVAILABLE',client_request_id:crypto.randomUUID()}); if(action==='skip')await api('update-issue',{issue_id:id,action:'NOT_FOUND',client_request_id:crypto.randomUUID()}); if(action==='found')await api('restore-skipped',{issue_id:id,reason:'Đã tìm thấy hàng sau khi đã bỏ qua'}); await loadEventsBoard(true);}catch(err){alert(err.message||String(err));}finally{eventBusy('');}
}
async function loadWithdrawn() {
  if(!routeActive('events')||eventsState.withdrawnLoading)return; const token=routeToken(); eventsState.withdrawnLoading=true;
  try{const d=await api('withdrawn-board');if(!stillActive('events',token))return;eventsState.board=normalizeBoard({...eventsState.board,withdrawn:d.withdrawn||[]});eventsState.withdrawnLoaded=true;reconcileEvents();}catch(err){if(stillActive('events',token)&&eventsState.bucket==='withdrawn')$('#wv3EventsList').innerHTML=`<div class="message" data-type="error">${esc(err.message)}</div>`;}finally{eventsState.withdrawnLoading=false;}
}
async function loadEventsBoard(force=false) {
  if(!routeActive('events'))return;if(!force&&eventsState.board&&Date.now()-eventsState.boardAt<4000){ensureEventsShell();reconcileEvents();return;}if(eventsState.loading){eventsState.queued=true;return;}const token=routeToken();eventsState.loading=true;ensureEventsShell();
  try{const board=await api('issue-board');if(!stillActive('events',token))return;eventsState.board=normalizeBoard({...board,withdrawn:eventsState.board?.withdrawn||[]});eventsState.boardAt=Date.now();reconcileEvents();if(!eventsState.withdrawnLoaded)void loadWithdrawn();}catch(err){if(stillActive('events',token)&&!eventsState.board)$('#wv3EventsList').innerHTML=`<div class="message" data-type="error">${esc(err.message)}</div>`;}finally{eventsState.loading=false;if(eventsState.queued){eventsState.queued=false;setTimeout(()=>void loadEventsBoard(true),100);}}
}
function reconcileEvents() { if(!routeActive('events')||!ensureEventsShell())return;updateEventsCounts();const rows=eventRows();if(eventsState.selectedId&&!rows.some((x)=>String(x.id)===eventsState.selectedId))eventsState.selectedId='';if(!eventsState.selectedId&&rows.length)eventsState.selectedId=String(rows[0].id);const shell=$('#workflowV3Events');if(shell)$$('[data-wv3-bucket]',shell).forEach((b)=>b.classList.toggle('active',b.dataset.wv3Bucket===eventsState.bucket));reconcileEventsList();reconcileEventsSelection();renderEventsDetail(); }
function removeIssue(id) { if(!eventsState.board)return; ['active','available','skipped'].forEach((k)=>eventsState.board[k]=(eventsState.board[k]||[]).filter((x)=>String(x.id)!==String(id))); }
function addIssue(i) { if(!eventsState.board||!i)return;removeIssue(i.id);if(ACTIVE_STATUSES.has(i.status))eventsState.board.active=[...(eventsState.board.active||[]),i].sort((a,b)=>new Date(a.reported_at)-new Date(b.reported_at));else if(i.status==='AVAILABLE')eventsState.board.available=[i,...(eventsState.board.available||[])];else if(i.status==='SKIP_ALLOWED')eventsState.board.skipped=[i,...(eventsState.board.skipped||[])]; }
async function applyIssueSignal(signal={}) {
  if(!routeActive('events')){eventsState.boardAt=0;return;}const token=routeToken();const incoming=Number(signal.event_id||signal.realtime_event_id||0);eventsState.pendingSeq=Math.max(eventsState.pendingSeq,incoming);if(eventsState.deltaBusy)return;eventsState.deltaBusy=true;
  try{while(eventsState.board){const after=Number(eventsState.board.realtime_seq||0);if(incoming>0&&incoming<=after&&eventsState.pendingSeq<=after)break;const d=await api('issue-delta',{after_seq:after,limit:200});if(d.requires_full_reconcile){await loadEventsBoard(true);break;}let withdrawn=false;(d.events||[]).forEach((ev)=>{removeIssue(ev.entity_id);if(ev.visible&&ev.issue)addIssue(ev.issue);withdrawn ||= Boolean(ev.withdrawn_changed);});eventsState.board.realtime_seq=Number(d.latest_seq||after);if(withdrawn){eventsState.withdrawnLoaded=false;if(eventsState.bucket==='withdrawn')await loadWithdrawn();}if(!stillActive('events',token))return;reconcileEvents();if(d.has_more)continue;if(eventsState.pendingSeq>eventsState.board.realtime_seq){eventsState.pendingSeq=0;continue;}eventsState.pendingSeq=0;break;}}catch(err){console.warn('workflow-v3 delta reconcile failed',err?.message||err);await loadEventsBoard(true).catch(()=>{});}finally{eventsState.deltaBusy=false;}
}
async function renderEvents() { if(!routeActive('events'))return;ensureEventsShell();await loadEventsBoard(false); }

function flowBar(label, value, total, tone='') { const width=total>0?Math.max(2,Math.min(100,value/total*100)):0;return `<div class="wv3-flow-row"><span>${esc(label)}</span><div><i class="${tone}" style="width:${width}%"></i></div><b>${Number(value||0).toLocaleString(getLocale())}</b></div>`; }
function hourlyChart(values=[]) { const max=Math.max(1,...values.map(Number));return `<div class="wv3-hourly">${values.map((v,h)=>`<div title="${h}:00 · ${Number(v)}"><i style="height:${Math.max(3,Number(v)/max*100)}%"></i><span>${h%3===0?String(h).padStart(2,'0'):''}</span></div>`).join('')}</div>`; }
async function renderOverview() {
  if(!MANAGER_ROLES.has(role())||!routeActive('overview'))return; const content=$('#content');const token=routeToken();if(!content)return;content.innerHTML=`<div class="warehouse-v2-root workflow-v3-dashboard"><div class="wv3-heading"><div><h2>${esc(tr('Tổng quan hôm nay','Today overview'))}</h2><p>${esc(tr('Tình hình báo thiếu và các ngoại lệ cần xử lý trong ngày.','Shortage handling and exceptions requiring attention today.'))}</p></div><b>${esc(localDateKey())}</b></div><div class="wv2-empty">${esc(tr('Đang tổng hợp dữ liệu vận hành…','Compiling operations data…'))}</div></div>`;
  try{const range={from:localMidnightIso(localDateKey()),to:new Date().toISOString()};const [report,board]=await Promise.all([rpc('api_reports_summary_v2_rpc',{p_from:range.from,p_to:range.to}),api('issue-board')]);if(!stillActive('overview',token))return;const active=normalizeBoard(board).active||[];const totalOut=Number(report.available||0)+Number(report.skipped||0)+Number(report.withdrawn||0);const priority=active.slice(0,8).map((i)=>{let deadline='';if(report.auto_skip_enabled){const due=new Date(i.reported_at).getTime()+Number(report.auto_skip_after_minutes||0)*60000;const remain=Math.ceil((due-Date.now())/60000);deadline=remain<=0?tr('Đã tới hạn tự bỏ qua','Auto-skip due'):`${tr('Còn','Remaining')} ${remain} ${tr('phút tới tự bỏ qua','min to auto-skip')}`;}return `<div class="wv3-priority-row"><div><b>SKU ${esc(i.sku)}</b><span>${esc(i.product_name||'')}</span></div><div><strong>${esc(ageLabel(i.reported_at))}</strong><small>${esc(deadline)}</small></div></div>`;}).join('')||`<div class="wv2-empty">${esc(tr('Không có SKU đang xử lý.','No SKUs are currently in progress.'))}</div>`;const top=(report.top_skus||[]).slice(0,8).map((x,n)=>`<div class="wv3-rank"><b>${n+1}</b><span><strong>${esc(x.sku)}</strong><small>${esc(x.product_name||'')}</small></span><em>${Number(x.reports||0)}</em></div>`).join('')||`<div class="wv2-empty">${esc(tr('Chưa có dữ liệu.','No data yet.'))}</div>`;
    content.innerHTML=`<div class="warehouse-v2-root workflow-v3-dashboard"><div class="wv3-heading"><div><h2>${esc(tr('Tổng quan hôm nay','Today overview'))}</h2><p>${esc(tr('Tập trung vào backlog, kết quả, tốc độ xử lý và ngoại lệ nghiệp vụ.','Focused on backlog, outcomes, handling speed, and operational exceptions.'))}</p></div><div><b>${esc(localDateKey())}</b><small>${esc(tr('Cập nhật','Updated'))} ${esc(formatClock(new Date()))}</small></div></div>
    <div class="wv3-metrics">${metric(tr('Đang xử lý','In progress'),report.active_now||0,tr('SKU cần Inventory xử lý','SKUs awaiting Inventory'))}${metric(tr('Quá mốc nhắc Inventory','Inventory reminder overdue'),report.inventory_overdue_now||0,`${tr('Mốc','Threshold')} ${report.inventory_reminder_minutes} ${tr('phút','min')}`,Number(report.inventory_overdue_now)>0?'warn':'')}${metric(tr('Đã có hàng hôm nay','Available today'),report.available||0,'','good')}${metric(tr('Đã bỏ qua hôm nay','Skipped today'),report.skipped||0,'','danger')}${metric(tr('Tự động bỏ qua','Auto-skipped'),report.auto_skip_count||0,report.auto_skip_enabled?`${report.auto_skip_after_minutes} ${tr('phút','min')}`:tr('Đang tắt','Disabled'))}${metric(tr('Picker chờ xác nhận','Picker awaiting ACK'),report.picker_waiting_ack_now||0,`${report.picker_ack_reminder_minutes} ${tr('phút/lần nhắc','min/reminder')}`,Number(report.picker_waiting_ack_now)>0?'warn':'')}</div>
    <div class="wv3-grid"><section class="wv3-panel span-two"><div class="wv3-panel-head"><div><h3>${esc(tr('SKU cần chú ý ngay','SKUs needing attention'))}</h3><p>${esc(tr('Ưu tiên SKU chờ lâu nhất.','Oldest waiting SKUs first.'))}</p></div></div>${priority}</section><section class="wv3-panel"><div class="wv3-panel-head"><div><h3>${esc(tr('Kết quả hôm nay','Today outcomes'))}</h3><p>${esc(tr('Tỷ trọng các kết quả đã ghi nhận.','Distribution of recorded outcomes.'))}</p></div></div>${flowBar(tr('Đã có hàng','Available'),report.available||0,totalOut,'good')}${flowBar(tr('Đã bỏ qua','Skipped'),report.skipped||0,totalOut,'danger')}${flowBar(tr('Picker thu hồi','Picker withdrawal'),report.withdrawn||0,totalOut,'muted')}</section><section class="wv3-panel"><div class="wv3-panel-head"><div><h3>${esc(tr('Tốc độ xử lý','Handling speed'))}</h3><p>${esc(tr('Từ lúc báo thiếu tới kết quả cuối.','From shortage report to final outcome.'))}</p></div></div><div class="wv3-kpis"><div><span>${esc(tr('Trung bình','Average'))}</span><b>${report.average_resolution_minutes==null?'—':`${report.average_resolution_minutes} ${tr('phút','min')}`}</b></div><div><span>Median</span><b>${report.median_resolution_minutes==null?'—':`${report.median_resolution_minutes} ${tr('phút','min')}`}</b></div><div><span>P95</span><b>${report.p95_resolution_minutes==null?'—':`${report.p95_resolution_minutes} ${tr('phút','min')}`}</b></div></div></section><section class="wv3-panel span-two"><div class="wv3-panel-head"><div><h3>${esc(tr('Phát sinh theo giờ · 24 giờ gần nhất','Hourly volume · last 24 hours'))}</h3><p>${esc(tr('Nhìn nhanh thời điểm phát sinh cao.','Quick view of peak shortage periods.'))}</p></div></div>${hourlyChart(report.hourly_reports_24h||new Array(24).fill(0))}</section><section class="wv3-panel"><div class="wv3-panel-head"><div><h3>${esc(tr('SKU phát sinh nhiều','Frequently reported SKUs'))}</h3><p>${esc(tr('Theo lượt báo trong hôm nay.','By report count today.'))}</p></div></div>${top}</section><section class="wv3-panel"><div class="wv3-panel-head"><div><h3>${esc(tr('Ngoại lệ nghiệp vụ','Operational exceptions'))}</h3></div></div><div class="wv3-kpis"><div><span>${esc(tr('Quá mốc Inventory','Inventory overdue'))}</span><b>${Number(report.inventory_overdue_count||0)}</b></div><div><span>${esc(tr('Picker xác nhận trễ','Late picker ACK'))}</span><b>${Number(report.picker_ack_late_count||0)}</b></div><div><span>${esc(tr('Báo lại trong 30 phút','Repeated within 30 min'))}</span><b>${Number(report.recurrent_episodes||0)}</b></div></div></section></div></div>`;
  }catch(err){if(stillActive('overview',token))content.innerHTML=`<div class="warehouse-v2-root"><div class="message" data-type="error">${esc(err.message)}</div></div>`;}
}

const reportState={preset:'30',from:'',to:'',page:0,pageSize:25,summary:null};
function resolveReportRange() {
  if(reportState.preset==='today')return {from:localMidnightIso(localDateKey()),to:new Date().toISOString()};
  if(reportState.preset==='7')return dayRange(7);
  if(reportState.preset==='30')return dayRange(30);
  if(reportState.preset==='custom'&&reportState.from&&reportState.to)return {from:localMidnightIso(reportState.from),to:nextLocalMidnightIso(reportState.to)};
  return dayRange(30);
}
async function reportPage(range,page=reportState.page,pageSize=reportState.pageSize){return rpc('api_issue_history_page_rpc',{p_from:range.from,p_to:range.to,p_status:null,p_limit:pageSize,p_offset:page*pageSize});}
function reportTableRows(items=[]) {return items.map((i)=>`<tr><td>${esc(formatDateTime(i.reported_at))}</td><td><b>${esc(i.sku)}</b></td><td>${esc(i.product_name||'')}</td><td>${Number(i.report_count||1)}</td><td><span class="wv2-status ${i.status==='AVAILABLE'?'available':i.status==='SKIP_ALLOWED'?'skipped':''}">${esc(statusLabel(i.status))}</span></td><td>${esc(i.handled_by_name||'—')}</td><td>${i.resolved_at?`${durationMinutes(i.reported_at,i.resolved_at)} ${esc(tr('phút','min'))}`:'—'}</td><td>${esc(i.latest_message||'—')}</td></tr>`).join('')||`<tr><td colspan="8">${esc(tr('Chưa có dữ liệu.','No data yet.'))}</td></tr>`;}
function pagination(total,page,pageSize,idPrefix='wv3Report') {const pages=Math.max(1,Math.ceil(total/pageSize));return `<div class="wv3-pagination" data-page-total="${total}"><span>${esc(tr('Tổng','Total'))}: <b>${total}</b> · ${esc(tr('Trang','Page'))} ${page+1}/${pages}</span><div><select id="${idPrefix}PageSize" aria-label="${esc(tr('Số dòng mỗi trang','Rows per page'))}">${[25,50,100].map((n)=>`<option value="${n}" ${n===pageSize?'selected':''}>${n}</option>`).join('')}</select><button class="secondary" id="${idPrefix}First" ${page<=0?'disabled':''}>«</button><button class="secondary" id="${idPrefix}Prev" ${page<=0?'disabled':''}>‹</button><button class="secondary" id="${idPrefix}Next" ${page>=pages-1?'disabled':''}>›</button><button class="secondary" id="${idPrefix}Last" ${page>=pages-1?'disabled':''}>»</button></div></div>`;}
function dailyTrend(rows=[]) {if(!rows.length)return `<div class="wv2-empty">${esc(tr('Chưa có dữ liệu.','No data yet.'))}</div>`;const max=Math.max(1,...rows.map((x)=>Number(x.reports||0)));return `<div class="wv3-daily">${rows.map((x)=>`<div><span>${esc(String(x.day).slice(5))}</span><i style="width:${Math.max(2,Number(x.reports||0)/max*100)}%"></i><b>${Number(x.reports||0)}</b></div>`).join('')}</div>`;}
async function renderReports() {
  if(!MANAGER_ROLES.has(role())||!routeActive('reports'))return;const content=$('#content');const token=routeToken();if(!content)return;const range=resolveReportRange();content.innerHTML=`<div class="warehouse-v2-root workflow-v3-dashboard"><div class="wv3-heading"><div><h2>${esc(tr('Báo cáo vận hành','Operations report'))}</h2><p>${esc(tr('Phân tích báo thiếu, kết quả và tốc độ xử lý theo khoảng thời gian.','Analyze shortages, outcomes, and handling speed by time range.'))}</p></div></div><div class="wv2-empty">${esc(tr('Đang tổng hợp báo cáo…','Compiling report…'))}</div></div>`;
  try{const [s,p]=await Promise.all([rpc('api_reports_summary_v2_rpc',{p_from:range.from,p_to:range.to}),reportPage(range)]);if(!stillActive('reports',token))return;reportState.summary=s;const outcomeTotal=Math.max(1,Number(s.available||0)+Number(s.skipped||0)+Number(s.withdrawn||0));const top=(s.top_skus||[]).slice(0,10).map((x,n)=>`<tr><td>${n+1}</td><td><b>${esc(x.sku)}</b></td><td>${esc(x.product_name||'')}</td><td>${Number(x.reports||0)}</td></tr>`).join('')||`<tr><td colspan="4">${esc(tr('Chưa có dữ liệu.','No data yet.'))}</td></tr>`;const auto=(s.top_auto_skip_skus||[]).slice(0,10).map((x,n)=>`<tr><td>${n+1}</td><td><b>${esc(x.sku)}</b></td><td>${esc(x.product_name||'')}</td><td>${Number(x.count||0)}</td></tr>`).join('')||`<tr><td colspan="4">${esc(tr('Chưa có dữ liệu.','No data yet.'))}</td></tr>`;
    content.innerHTML=`<div class="warehouse-v2-root workflow-v3-dashboard"><div class="wv3-heading"><div><h2>${esc(tr('Báo cáo vận hành','Operations report'))}</h2><p>${esc(tr('Theo dõi khối lượng, kết quả, SLA và SKU bất thường.','Track volume, outcomes, SLA, and exceptional SKUs.'))}</p></div><button class="primary" id="wv3Export">${esc(tr('Xuất Excel','Export Excel'))}</button></div>
    <div class="wv3-report-filter"><button data-range="today" class="${reportState.preset==='today'?'active':''}">${esc(tr('Hôm nay','Today'))}</button><button data-range="7" class="${reportState.preset==='7'?'active':''}">7 ${esc(tr('ngày','days'))}</button><button data-range="30" class="${reportState.preset==='30'?'active':''}">30 ${esc(tr('ngày','days'))}</button><button data-range="custom" class="${reportState.preset==='custom'?'active':''}">${esc(tr('Tùy chọn','Custom'))}</button><label>${esc(tr('Từ','From'))}<input id="wv3From" type="date" value="${esc(reportState.from)}"></label><label>${esc(tr('Đến','To'))}<input id="wv3To" type="date" value="${esc(reportState.to)}"></label></div>
    <div class="wv3-metrics">${metric(tr('Lượt báo','Reports'),s.reports||0,`${Number(s.issues||0)} ${tr('đợt SKU','SKU episodes')}`)}${metric(tr('Đã có hàng','Available'),s.available||0,pct(ratio(s.available,outcomeTotal)),'good')}${metric(tr('Đã bỏ qua','Skipped'),s.skipped||0,pct(ratio(s.skipped,outcomeTotal)),'danger')}${metric(tr('Picker thu hồi','Picker withdrawal'),s.withdrawn||0,pct(ratio(s.withdrawn,outcomeTotal)))}${metric(tr('Tự động bỏ qua','Auto-skipped'),s.auto_skip_count||0,'')}${metric(tr('Báo lại ≤30 phút','Repeated ≤30 min'),s.recurrent_episodes||0,'')}</div>
    <div class="wv3-grid"><section class="wv3-panel"><div class="wv3-panel-head"><div><h3>${esc(tr('Tốc độ xử lý','Handling speed'))}</h3></div></div><div class="wv3-kpis"><div><span>${esc(tr('Trung bình','Average'))}</span><b>${s.average_resolution_minutes==null?'—':`${s.average_resolution_minutes} ${tr('phút','min')}`}</b></div><div><span>Median</span><b>${s.median_resolution_minutes==null?'—':`${s.median_resolution_minutes} ${tr('phút','min')}`}</b></div><div><span>P95</span><b>${s.p95_resolution_minutes==null?'—':`${s.p95_resolution_minutes} ${tr('phút','min')}`}</b></div></div></section><section class="wv3-panel"><div class="wv3-panel-head"><div><h3>${esc(tr('Tuân thủ cảnh báo','Alert compliance'))}</h3></div></div><div class="wv3-kpis"><div><span>${esc(tr('Quá mốc Inventory','Inventory overdue'))}</span><b>${pct(ratio(s.inventory_overdue_count,Number(s.issues||0)))}</b></div><div><span>${esc(tr('Picker ACK trễ','Late picker ACK'))}</span><b>${pct(ratio(s.picker_ack_late_count,Number(s.picker_alert_count||0)))}</b></div><div><span>${esc(tr('Picker đang chờ ACK','Picker awaiting ACK'))}</span><b>${Number(s.picker_waiting_ack_now||0)}</b></div></div></section><section class="wv3-panel span-two"><div class="wv3-panel-head"><div><h3>${esc(tr('Xu hướng theo ngày','Daily trend'))}</h3></div></div>${dailyTrend(s.daily_reports||[])}</section><section class="wv3-panel"><div class="wv3-panel-head"><div><h3>${esc(tr('SKU phát sinh nhiều','Frequently reported SKUs'))}</h3></div></div><div class="wv2-table-wrap"><table class="wv2-table"><thead><tr><th>#</th><th>SKU</th><th>${esc(tr('Tên hàng','Item'))}</th><th>${esc(tr('Lượt báo','Reports'))}</th></tr></thead><tbody>${top}</tbody></table></div></section><section class="wv3-panel"><div class="wv3-panel-head"><div><h3>${esc(tr('SKU tự động bỏ qua nhiều','Most auto-skipped SKUs'))}</h3></div></div><div class="wv2-table-wrap"><table class="wv2-table"><thead><tr><th>#</th><th>SKU</th><th>${esc(tr('Tên hàng','Item'))}</th><th>${esc(tr('Lần','Count'))}</th></tr></thead><tbody>${auto}</tbody></table></div></section></div>
    <div class="wv3-panel wv3-detail-panel"><div class="wv3-panel-head"><div><h3>${esc(tr('Chi tiết báo thiếu','Shortage details'))}</h3><p>${esc(tr('Phân trang từ máy chủ, không tải toàn bộ lịch sử một lần.','Server-side pagination; history is not loaded all at once.'))}</p></div></div><div class="wv2-table-wrap"><table class="wv2-table"><thead><tr><th>${esc(tr('Thời gian báo','Reported at'))}</th><th>SKU</th><th>${esc(tr('Tên hàng','Item'))}</th><th>${esc(tr('Lượt báo','Reports'))}</th><th>${esc(tr('Kết quả','Outcome'))}</th><th>${esc(tr('Người xử lí','Handled by'))}</th><th>${esc(tr('Thời gian xử lý','Handling time'))}</th><th>${esc(tr('Ghi chú','Note'))}</th></tr></thead><tbody id="wv3ReportRows">${reportTableRows(p.items||[])}</tbody></table></div><div id="wv3ReportPager">${pagination(Number(p.total||0),reportState.page,reportState.pageSize)}</div></div></div>`;
    $$('[data-range]',content).forEach((b)=>b.onclick=()=>{reportState.preset=b.dataset.range;reportState.page=0;if(reportState.preset==='custom'&&(!reportState.from||!reportState.to)){reportState.from=localDateKey(new Date(Date.now()-6*86400000));reportState.to=localDateKey();}void renderReports();});$('#wv3From').onchange=(e)=>{reportState.from=e.target.value;reportState.preset='custom';reportState.page=0;if(reportState.to)void renderReports();};$('#wv3To').onchange=(e)=>{reportState.to=e.target.value;reportState.preset='custom';reportState.page=0;if(reportState.from)void renderReports();};bindReportPager(Number(p.total||0));$('#wv3Export').onclick=()=>void exportReport(range,s);
  }catch(err){if(stillActive('reports',token))content.innerHTML=`<div class="warehouse-v2-root"><div class="message" data-type="error">${esc(err.message)}</div></div>`;}
}
function bindReportPager(total) {const pages=Math.max(1,Math.ceil(total/reportState.pageSize));const go=async(page)=>{reportState.page=Math.max(0,Math.min(pages-1,page));const range=resolveReportRange();const p=await reportPage(range);if(!routeActive('reports'))return;$('#wv3ReportRows').innerHTML=reportTableRows(p.items||[]);$('#wv3ReportPager').innerHTML=pagination(Number(p.total||0),reportState.page,reportState.pageSize);bindReportPager(Number(p.total||0));};$('#wv3ReportPageSize').onchange=(e)=>{reportState.pageSize=Number(e.target.value);reportState.page=0;void go(0);};$('#wv3ReportFirst').onclick=()=>void go(0);$('#wv3ReportPrev').onclick=()=>void go(reportState.page-1);$('#wv3ReportNext').onclick=()=>void go(reportState.page+1);$('#wv3ReportLast').onclick=()=>void go(pages-1);}
async function exportReport(range,summary) {
  const button=$('#wv3Export');if(button)button.disabled=true;try{const all=[];let offset=0,total=1;while(offset<total){const page=await rpc('api_issue_history_page_rpc',{p_from:range.from,p_to:range.to,p_status:null,p_limit:100,p_offset:offset});const items=page.items||[];all.push(...items);total=Number(page.total||0);offset+=items.length||100;if(!items.length)break;}const module=await import('exceljs'),ExcelJS=module.default??module,book=new ExcelJS.Workbook();book.creator='Báo hàng 1291';const s=book.addWorksheet('Tổng hợp');[['BÁO CÁO VẬN HÀNH 1291',''],[tr('Từ','From'),range.from],[tr('Đến','To'),range.to],[tr('Lượt báo','Reports'),Number(summary.reports||0)],[tr('Đợt SKU','SKU episodes'),Number(summary.issues||0)],[tr('Đã có hàng','Available'),Number(summary.available||0)],[tr('Đã bỏ qua','Skipped'),Number(summary.skipped||0)],[tr('Picker thu hồi','Picker withdrawal'),Number(summary.withdrawn||0)],[tr('Tự động bỏ qua','Auto-skipped'),Number(summary.auto_skip_count||0)],[tr('Quá mốc Inventory','Inventory overdue'),Number(summary.inventory_overdue_count||0)],[tr('Picker ACK trễ','Late picker ACK'),Number(summary.picker_ack_late_count||0)],[tr('Median xử lý (phút)','Median handling (min)'),summary.median_resolution_minutes??''],[tr('P95 (phút)','P95 (min)'),summary.p95_resolution_minutes??'']].forEach((r)=>s.addRow(r));s.columns=[{width:36},{width:26}];s.getRow(1).font={bold:true,size:15};const d=book.addWorksheet('Chi tiết');d.columns=[{header:tr('Thời gian báo','Reported at'),key:'reported',width:22},{header:'SKU',key:'sku',width:18},{header:tr('Tên hàng','Item'),key:'name',width:45},{header:tr('Lượt báo','Reports'),key:'reports',width:12},{header:tr('Kết quả','Outcome'),key:'outcome',width:18},{header:tr('Người xử lí','Handled by'),key:'handler',width:28},{header:tr('Thời gian xử lý (phút)','Handling time (min)'),key:'duration',width:22},{header:tr('Ghi chú','Note'),key:'note',width:45}];all.forEach((i)=>d.addRow({reported:formatDateTime(i.reported_at),sku:i.sku,name:i.product_name||'',reports:Number(i.report_count||1),outcome:statusLabel(i.status),handler:i.handled_by_name||'',duration:durationMinutes(i.reported_at,i.resolved_at)??'',note:i.latest_message||''}));d.getRow(1).font={bold:true};d.views=[{state:'frozen',ySplit:1}];d.autoFilter={from:'A1',to:'H1'};const buffer=await book.xlsx.writeBuffer(),blob=new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`Bao_cao_van_hanh_1291_${localDateKey()}.xlsx`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(err){alert(`${tr('Không xuất được Excel:','Unable to export Excel:')} ${err.message}`);}finally{if(button)button.disabled=false;}
}

async function renderTiming() {
  if(!MANAGER_ROLES.has(role())||!routeActive('sla'))return;const content=$('#content');const token=routeToken();if(!content)return;content.dataset.opsRender='timing';content.innerHTML=`<div class="ops-page-heading"><div><h2>${esc(tr('Thời gian nghiệp vụ','Operating times'))}</h2><p>${esc(tr('Ba mốc thời gian duy nhất của luồng báo hàng.','The three timing controls used by the shortage workflow.'))}</p></div></div><div class="ops-loading">${esc(tr('Đang tải cấu hình…','Loading settings…'))}</div>`;
  try{const c=await api('get-operational-config');if(!stillActive('sla',token))return;const inventory=Number(c.inventory_reminder_minutes??c.reminder_minutes??5),picker=Number(c.picker_ack_reminder_minutes??3),autoAfter=Number(c.auto_skip_after_minutes??120);content.innerHTML=`<div class="ops-page-heading"><div><h2>${esc(tr('Thời gian nghiệp vụ','Operating times'))}</h2><p>${esc(tr('Ba mốc thời gian duy nhất của luồng báo hàng.','The three timing controls used by the shortage workflow.'))}</p></div></div><form id="wv3TimingForm"><div class="ops-settings-grid wv3-settings-three"><article class="ops-setting-card"><span class="ops-step">01</span><h3>${esc(tr('Tự động cho phép bỏ qua','Automatic skip permission'))}</h3><p>${esc(tr('Nếu bật, SKU tự chuyển sang Đã bỏ qua khi hết thời hạn Inventory xử lý và Picker nhận cảnh báo toàn màn hình.','When enabled, the SKU automatically moves to Skipped after the Inventory deadline and the picker gets a full-screen alert.'))}</p><label class="ops-check"><input type="checkbox" name="auto_skip_enabled" ${c.auto_skip_enabled?'checked':''}> ${esc(tr('Bật tự động cho phép bỏ qua','Enable automatic skip permission'))}</label><label>${esc(tr('Tự động cho phép bỏ qua sau (phút)','Automatically allow skip after (min)'))}<input type="number" name="auto_skip_after_minutes" min="15" max="4320" value="${autoAfter}"></label></article><article class="ops-setting-card"><span class="ops-step">02</span><h3>${esc(tr('Nhắc team Inventory xử lý','Remind Inventory team'))}</h3><p>${esc(tr('Sau XX phút kể từ lúc báo thiếu, cảnh báo Người báo hàng và Admin Inventory; lặp lại mỗi XX phút tới khi SKU có kết quả.','After XX minutes from the shortage report, alert shortage handlers and Inventory Admins; repeat every XX minutes until resolved.'))}</p><label>${esc(tr('Thời gian nhắc Inventory (phút)','Inventory reminder time (min)'))}<input type="number" name="inventory_reminder_minutes" min="1" max="480" value="${inventory}"></label></article><article class="ops-setting-card"><span class="ops-step">03</span><h3>${esc(tr('Nhắc Picker xác nhận','Remind picker to acknowledge'))}</h3><p>${esc(tr('Sau khi Đã có hàng hoặc Đã bỏ qua, nếu Picker chưa xác nhận thì cảnh báo toàn màn hình lặp lại mỗi XX phút.','After Available or Skipped, repeat the full-screen alert every XX minutes until the picker acknowledges it.'))}</p><label>${esc(tr('Thời gian nhắc Picker (phút)','Picker reminder time (min)'))}<input type="number" name="picker_ack_reminder_minutes" min="1" max="60" value="${picker}"></label></article></div><div class="ops-save-bar"><div><b>${esc(tr('Áp dụng đồng bộ','Apply everywhere'))}</b><span>${esc(tr('Thay đổi phát realtime tới Web/App đang hoạt động.','Changes are sent in realtime to active Web/App clients.'))}</span></div><button class="primary" type="submit">${esc(tr('Lưu thời gian nghiệp vụ','Save operating times'))}</button></div></form>`;$('#wv3TimingForm').onsubmit=async(e)=>{e.preventDefault();const f=new FormData(e.currentTarget),inv=Number(f.get('inventory_reminder_minutes')),pick=Number(f.get('picker_ack_reminder_minutes'));const btn=e.submitter;if(btn)btn.disabled=true;try{await api('save-operational-config',{acknowledge_minutes:inv,reminder_minutes:inv,replenish_minutes:inv,picker_ack_reminder_minutes:pick,found_item_reminder_minutes:pick,auto_skip_enabled:f.get('auto_skip_enabled')==='on',auto_skip_after_minutes:Number(f.get('auto_skip_after_minutes'))});alert(tr('Đã lưu thời gian nghiệp vụ.','Operating times saved.'));}catch(err){alert(err.message);}finally{if(btn)btn.disabled=false;}};
  }catch(err){if(stillActive('sla',token))content.innerHTML=`<div class="message" data-type="error">${esc(err.message)}</div>`;}
}

async function renderConfig() {
  if(!MANAGER_ROLES.has(role())||!routeActive('config'))return;const content=$('#content');const token=routeToken();if(!content)return;content.dataset.opsRender='config';content.innerHTML=`<div class="ops-page-heading"><div><h2>${esc(tr('Cấu hình hệ thống','System settings'))}</h2><p>${esc(tr('Thiết lập lưu trữ và đồng bộ; mốc thời gian nghiệp vụ được quản lý riêng.','Storage and sync settings; operating times are managed separately.'))}</p></div></div><div class="ops-loading">${esc(tr('Đang tải cấu hình…','Loading settings…'))}</div>`;
  try{const c=await api('get-config');if(!stillActive('config',token))return;content.innerHTML=`<div class="ops-page-heading"><div><h2>${esc(tr('Cấu hình hệ thống','System settings'))}</h2><p>${esc(tr('Thiết lập lưu trữ và đồng bộ; không lặp lại cấu hình SLA tại đây.','Storage and sync settings; SLA controls are not duplicated here.'))}</p></div></div><form id="wv3ConfigForm"><div class="ops-settings-grid"><article class="ops-setting-card"><h3>${esc(tr('Lưu trữ nghiệp vụ','Operational retention'))}</h3><label>${esc(tr('Lưu lịch sử nghiệp vụ (ngày)','Operational history retention (days)'))}<input type="number" name="retention_days" min="7" max="365" value="${Number(c.retention_days||60)}"></label><label>${esc(tr('Lưu log chẩn đoán (ngày)','Diagnostic log retention (days)'))}<input type="number" name="diagnostic_log_retention_days" min="1" max="60" value="${Number(c.diagnostic_log_retention_days||14)}"></label></article><article class="ops-setting-card"><h3>${esc(tr('Đồng bộ nhân sự','Staff synchronization'))}</h3><label class="ops-check"><input type="checkbox" name="staff_auto_sync_enabled" ${c.staff_auto_sync_enabled?'checked':''}> ${esc(tr('Tự động đồng bộ DANH MỤC NHÂN SỰ','Automatically sync STAFF LIST'))}</label><label>${esc(tr('Chu kỳ đồng bộ nhân sự (phút)','Staff sync interval (minutes)'))}<input type="number" name="staff_sync_interval_minutes" min="15" max="1440" value="${Number(c.staff_sync_interval_minutes||60)}"></label></article></div><div class="ops-save-bar"><div><b>${esc(tr('Cấu hình hệ thống','System settings'))}</b><span>${esc(tr('Không thay đổi các mốc thời gian nghiệp vụ tại trang này.','Operating-time settings are not changed on this page.'))}</span></div><button class="primary" type="submit">${esc(tr('Lưu cấu hình','Save settings'))}</button></div></form>`;$('#wv3ConfigForm').onsubmit=async(e)=>{e.preventDefault();const f=new FormData(e.currentTarget),btn=e.submitter;if(btn)btn.disabled=true;try{await api('save-config',{...c,retention_days:Number(f.get('retention_days')),diagnostic_log_retention_days:Number(f.get('diagnostic_log_retention_days')),staff_auto_sync_enabled:f.get('staff_auto_sync_enabled')==='on',staff_sync_interval_minutes:Number(f.get('staff_sync_interval_minutes'))});alert(tr('Đã lưu cấu hình hệ thống.','System settings saved.'));}catch(err){alert(err.message);}finally{if(btn)btn.disabled=false;}};
  }catch(err){if(stillActive('config',token))content.innerHTML=`<div class="message" data-type="error">${esc(err.message)}</div>`;}
}

const logPages=new WeakMap();
function enhanceLogContainer(id) {
  const root=$(id);if(!root)return;const rows=$$(':scope > article.card',root);if(!rows.length){root.querySelector(':scope > .wv3-log-pager')?.remove();return;}let state=logPages.get(root)||{page:0,size:25};const total=rows.length,pages=Math.max(1,Math.ceil(total/state.size));state.page=Math.min(state.page,pages-1);rows.forEach((x,n)=>x.hidden=!(n>=state.page*state.size&&n<(state.page+1)*state.size));let pager=root.querySelector(':scope > .wv3-log-pager');if(!pager){pager=document.createElement('div');pager.className='wv3-log-pager';root.appendChild(pager);}pager.innerHTML=`<span>${esc(tr('Tổng','Total'))}: <b>${total}</b> · ${esc(tr('Trang','Page'))} ${state.page+1}/${pages}</span><div><select aria-label="${esc(tr('Số dòng mỗi trang','Rows per page'))}">${[25,50,100].map((n)=>`<option value="${n}" ${state.size===n?'selected':''}>${n}</option>`).join('')}</select><button class="secondary" data-first ${state.page===0?'disabled':''}>«</button><button class="secondary" data-prev ${state.page===0?'disabled':''}>‹</button><button class="secondary" data-next ${state.page>=pages-1?'disabled':''}>›</button><button class="secondary" data-last ${state.page>=pages-1?'disabled':''}>»</button></div>`;const apply=()=>{logPages.set(root,state);enhanceLogContainer(id);};pager.querySelector('select').onchange=(e)=>{state.size=Number(e.target.value);state.page=0;apply();};pager.querySelector('[data-first]').onclick=()=>{state.page=0;apply();};pager.querySelector('[data-prev]').onclick=()=>{state.page--;apply();};pager.querySelector('[data-next]').onclick=()=>{state.page++;apply();};pager.querySelector('[data-last]').onclick=()=>{state.page=pages-1;apply();};logPages.set(root,state);
}
let logEnhanceQueued=false;
function queueLogEnhance(){if(logEnhanceQueued)return;logEnhanceQueued=true;queueMicrotask(()=>{logEnhanceQueued=false;if(!routeActive('logs'))return;enhanceLogContainer('#webLogs');enhanceLogContainer('#logs');enhanceLogContainer('#audit');});}
const logObserver=new MutationObserver((mutations)=>{if(!routeActive('logs'))return;const relevant=mutations.some((m)=>{if(m.type!=='childList'||!m.addedNodes.length)return false;const target=m.target instanceof Element?m.target:null;if(target?.closest?.('.wv3-log-pager'))return false;if(target&&['webLogs','logs','audit'].includes(target.id))return true;return [...m.addedNodes].some((n)=>n instanceof Element&&(['webLogs','logs','audit'].includes(n.id)||n.matches?.('article.card')));});if(relevant)queueLogEnhance();});
function startLogObserver(){if(document.documentElement)logObserver.observe(document.documentElement,{subtree:true,childList:true});}

function protectedRegistry(name, protectedFns) {
  const target={}; const proxy=new Proxy(target,{set(obj,key,value){if(Object.prototype.hasOwnProperty.call(protectedFns,key)){obj[key]=protectedFns[key];return true;}obj[key]=value;return true;},defineProperty(obj,key,desc){if(Object.prototype.hasOwnProperty.call(protectedFns,key)){Object.defineProperty(obj,key,{value:protectedFns[key],writable:true,enumerable:true,configurable:true});return true;}Object.defineProperty(obj,key,desc);return true;}});Object.assign(target,protectedFns);
  Object.defineProperty(globalThis,name,{configurable:false,enumerable:true,get(){return proxy;},set(value){if(value&&typeof value==='object'){for(const [k,v] of Object.entries(value))proxy[k]=v;}Object.assign(target,protectedFns);}});
  return proxy;
}
protectedRegistry('__BH_WV2_RENDER__',{events:renderEvents,overview:renderOverview,reports:renderReports});
protectedRegistry('__BH_OPS_RENDER__',{sla:renderTiming,config:renderConfig});
Object.defineProperty(globalThis,'__BH_FAST_ISSUE_SIGNAL__',{configurable:false,get:()=>applyIssueSignal,set:()=>{}});
Object.defineProperty(globalThis,'__BH_FAST_REFRESH__',{configurable:false,get:()=>()=>routeActive('events')?loadEventsBoard(true):Promise.resolve(),set:()=>{}});

window.addEventListener('bh:languagechange',()=>setTimeout(()=>{if(routeActive('events')){const c=$('#content');if(c)c.innerHTML='';void renderEvents();}else if(routeActive('overview'))void renderOverview();else if(routeActive('reports'))void renderReports();else if(routeActive('sla'))void renderTiming();else if(routeActive('config'))void renderConfig();else if(routeActive('logs'))queueLogEnhance();},0));
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',startLogObserver,{once:true});else startLogObserver();
