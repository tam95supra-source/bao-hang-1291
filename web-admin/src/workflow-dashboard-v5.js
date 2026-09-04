import './workflow-dashboard-v5.css';
import { getLocale, t } from './i18n.js';

const BACKEND = 'https://backend.bao-hang-1291.invalid';
const SESSION_KEY = 'bao-hang-1291-web-session';
const PAGE_SIZES = new Set([25, 50, 100]);
const ACTIVE = new Set(['OPEN','CLAIMED','SEARCHING','REPLENISHING']);
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>\'\"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const tr = (vi, en) => t(vi, en);

function session() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
}
function testRole() {
  const value = String(document.body?.dataset?.testRole || '').trim().toUpperCase();
  return ['ADMIN_INVENT','INVENT','PICKER'].includes(value) ? value : null;
}
function routeActive(tab) {
  if (typeof globalThis.__BH_ROUTE_ACTIVE__ === 'function') return globalThis.__BH_ROUTE_ACTIVE__(tab);
  return Boolean($(`.tabs [data-tab="${tab}"].active`));
}
async function parseResponse(response) {
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error:text }; }
  if (!response.ok || data?.ok === false) throw new Error(data?.error || data?.message || `${tr('Lỗi máy chủ','Server error')} ${response.status}`);
  return data;
}
async function authFetch(url, init = {}) {
  if (typeof globalThis.__BH_AUTH_FETCH__ === 'function') return globalThis.__BH_AUTH_FETCH__(url, init);
  const current = session();
  if (!current?.access_token) throw new Error(tr('Phiên đăng nhập không tồn tại.','No active login session.'));
  const headers = new Headers(init.headers || {});
  headers.set('authorization', `Bearer ${current.access_token}`);
  return fetch(url, { ...init, headers });
}
async function rpc(name, payload = {}) {
  return parseResponse(await authFetch(`${BACKEND}/data/rpc/${encodeURIComponent(name)}`, {
    method:'POST', headers:{'content-type':'application/json'},
    body:JSON.stringify({ ...payload, p_test_role:testRole() }),
  }));
}
async function api(action, payload = {}) {
  return parseResponse(await authFetch(`${BACKEND}/api/web-api/${encodeURIComponent(action)}`, {
    method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(payload),
  }));
}
function localDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Bangkok', year:'numeric', month:'2-digit', day:'2-digit' }).format(date);
}
function dayStart(key) { return new Date(`${key}T00:00:00+07:00`).toISOString(); }
function dayAfter(key) { const d = new Date(`${key}T00:00:00+07:00`); d.setUTCDate(d.getUTCDate()+1); return d.toISOString(); }
function formatClock(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString(getLocale(), { hour:'2-digit', minute:'2-digit', hour12:false });
}
function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString(getLocale(), { hour12:false });
}
function ageMinutes(value) {
  const ms = Date.now() - new Date(value || 0).getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 60000)) : 0;
}
function ageLabel(value) {
  const n = ageMinutes(value);
  if (n < 60) return `${n} ${tr('phút','min')}`;
  return `${Math.floor(n/60)}${tr('g','h')} ${n%60}${tr('p','m')}`;
}
function minLabel(value) {
  return value == null ? '—' : `${Number(value).toLocaleString(getLocale(), {maximumFractionDigits:1})} ${tr('phút','min')}`;
}
function pct(n, d) {
  return Number(d || 0) > 0 ? `${(Number(n || 0) / Number(d) * 100).toLocaleString(getLocale(), {maximumFractionDigits:1})}%` : '0%';
}
function statusLabel(status) {
  return ({OPEN:tr('Đang xử lý','In progress'),CLAIMED:tr('Đang xử lý','In progress'),SEARCHING:tr('Đang xử lý','In progress'),REPLENISHING:tr('Đang xử lý','In progress'),AVAILABLE:tr('Đã có hàng','Available'),SKIP_ALLOWED:tr('Đã bỏ qua','Skipped'),WITHDRAWN:tr('Picker thu hồi','Picker withdrawal')})[String(status||'').toUpperCase()] || String(status || '—');
}
function cacheRead(map, key, ttl) {
  const hit = map.get(key);
  return hit && Date.now() - hit.at < ttl ? hit.value : null;
}
function cacheWrite(map, key, value) { map.set(key, {at:Date.now(), value}); return value; }
function kpi(label, value, sub = '', tone = 'neutral') {
  return `<article class="v5-kpi ${tone}"><span>${esc(label)}</span><strong>${esc(value)}</strong>${sub ? `<small>${esc(sub)}</small>` : ''}</article>`;
}
function compactMetric(label, value, tone='') {
  return `<div class="v5-compact-metric ${tone}"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;
}
function outcomeBar(label, value, total, tone) {
  const width = total > 0 ? Math.max(value > 0 ? 3 : 0, Math.min(100, Number(value || 0) / total * 100)) : 0;
  return `<div class="v5-outcome-line"><div><span>${esc(label)}</span><b>${Number(value||0).toLocaleString(getLocale())}</b></div><div class="v5-track"><i class="${tone}" style="width:${width}%"></i></div><small>${pct(value,total)}</small></div>`;
}
function normalizeActive(board = {}) {
  const map = new Map();
  [...(board.open || []), ...(board.claimed || [])].forEach((x) => { if (x?.id && ACTIVE.has(String(x.status || 'OPEN'))) map.set(String(x.id), x); });
  return [...map.values()].sort((a,b)=>new Date(a.reported_at)-new Date(b.reported_at));
}
function hourlyBars(values = []) {
  const rows = Array.from({length:24}, (_,i)=>Number(values[i]||0));
  const max = Math.max(1, ...rows);
  return `<div class="v5-hourly">${rows.map((v,h)=>`<div class="v5-hour"><i style="height:${Math.max(v?6:2, v/max*100)}%"></i><span>${h%3===0?String(h).padStart(2,'0'):''}</span></div>`).join('')}</div>`;
}
function dailyBars(rows = []) {
  if (!rows.length) return `<div class="v5-empty">${esc(tr('Chưa có dữ liệu.','No data yet.'))}</div>`;
  const max = Math.max(1, ...rows.map((x)=>Number(x.reports||0)));
  return `<div class="v5-daily">${rows.map((x)=>{const v=Number(x.reports||0);return `<div class="v5-daily-row"><span>${esc(String(x.day).slice(5))}</span><div class="v5-track"><i class="blue" style="width:${Math.max(v?3:0,v/max*100)}%"></i></div><b>${v}</b></div>`;}).join('')}</div>`;
}
function topSkuRows(rows = [], limit = 8, valueKey = 'reports') {
  const items = rows.slice(0,limit);
  if (!items.length) return `<div class="v5-empty">${esc(tr('Chưa có dữ liệu.','No data yet.'))}</div>`;
  return `<div class="v5-rank-list">${items.map((x,n)=>`<div class="v5-rank-row"><b>${n+1}</b><div><strong>${esc(x.sku||'—')}</strong><span>${esc(x.product_name||'—')}</span></div><em>${Number(x[valueKey]??x.count??0)}</em></div>`).join('')}</div>`;
}

const overviewCache = new Map();
let overviewSeq = 0;
async function loadOverviewData() {
  const key = localDateKey();
  const cached = cacheRead(overviewCache,key,12000);
  if (cached) return cached;
  const range={from:dayStart(key),to:new Date().toISOString()};
  const [summary,board] = await Promise.all([rpc('api_reports_summary_v2_rpc',{p_from:range.from,p_to:range.to}),api('issue-board')]);
  return cacheWrite(overviewCache,key,{summary,board});
}
function priorityRows(active, summary) {
  if (!active.length) return `<div class="v5-empty v5-empty-good">${esc(tr('Không có SKU đang chờ xử lý.','No SKUs are waiting for action.'))}</div>`;
  const reminder = Number(summary.inventory_reminder_minutes||0);
  const autoEnabled = Boolean(summary.auto_skip_enabled);
  const autoMinutes = Number(summary.auto_skip_after_minutes||0);
  return `<div class="v5-priority-table"><div class="v5-priority-head"><span>SKU</span><span>${esc(tr('Chờ','Wait'))}</span><span>${esc(tr('Lượt','Reports'))}</span><span>${esc(tr('Ưu tiên','Priority'))}</span></div>${active.slice(0,10).map((i)=>{
    const age=ageMinutes(i.reported_at); const overdue=reminder>0&&age>=reminder; let priority=overdue?tr('Quá SLA','Overdue'):tr('Trong SLA','Within SLA'); let tone=overdue?'danger':'ok';
    if(autoEnabled&&autoMinutes>0){const remain=autoMinutes-age;if(remain<=0){priority=tr('Đến hạn tự bỏ qua','Auto-skip due');tone='danger';}else if(remain<=5){priority=`${tr('Tự bỏ qua sau','Auto-skip in')} ${remain} ${tr('phút','min')}`;tone='warn';}}
    return `<div class="v5-priority-row"><div><strong>${esc(i.sku)}</strong><span>${esc(i.product_name||'—')}</span></div><b>${esc(ageLabel(i.reported_at))}</b><b>${Number(i.report_count||1)}</b><span class="v5-pill ${tone}">${esc(priority)}</span></div>`;
  }).join('')}</div>`;
}
async function renderOverviewV5() {
  if(!routeActive('overview'))return;
  const content=$('#content'); if(!content)return;
  const seq=++overviewSeq;
  content.innerHTML=`<div class="v5-root v5-overview"><div class="v5-page-head"><div><h2>${esc(tr('Tổng quan hôm nay','Today overview'))}</h2></div><div class="v5-head-meta"><b>${esc(localDateKey())}</b><span>${esc(formatClock())}</span></div></div><div class="v5-skeleton-grid">${Array.from({length:6},()=>'<div class="v5-skeleton"></div>').join('')}</div></div>`;
  try {
    const {summary,board}=await loadOverviewData();
    if(seq!==overviewSeq||!routeActive('overview'))return;
    const active=normalizeActive(board); const issues=Number(summary.issues||0); const available=Number(summary.available||0); const skipped=Number(summary.skipped||0); const withdrawn=Number(summary.withdrawn||0); const outcomes=Math.max(1,available+skipped+withdrawn);
    content.innerHTML=`<div class="v5-root v5-overview">
      <div class="v5-page-head"><div><h2>${esc(tr('Tổng quan hôm nay','Today overview'))}</h2></div><div class="v5-head-meta"><b>${esc(localDateKey())}</b><span>${esc(tr('Cập nhật','Updated'))} ${esc(formatClock())}</span></div></div>
      <section class="v5-block"><div class="v5-block-head"><h3>${esc(tr('Cần xử lý','Needs action'))}</h3><button class="secondary" id="v5OpenEvents">${esc(tr('Mở xử lý báo thiếu','Open shortage handling'))}</button></div><div class="v5-kpi-grid v5-kpi-grid-3">${kpi(tr('Đang xử lý','In progress'),Number(summary.active_now||active.length),tr('SKU đang mở','open SKUs'),'blue')}${kpi(tr('Quá mốc Inventory','Inventory overdue'),Number(summary.inventory_overdue_now||0),`${Number(summary.inventory_reminder_minutes||0)} ${tr('phút','min')}`,Number(summary.inventory_overdue_now||0)>0?'amber':'neutral')}${kpi(tr('Picker chờ xác nhận','Picker awaiting ACK'),Number(summary.picker_waiting_ack_now||0),`${Number(summary.picker_ack_reminder_minutes||0)} ${tr('phút/lần','min/reminder')}`,Number(summary.picker_waiting_ack_now||0)>0?'amber':'neutral')}</div></section>
      <section class="v5-block"><div class="v5-block-head"><h3>${esc(tr('Kết quả hôm nay','Today results'))}</h3></div><div class="v5-kpi-grid v5-kpi-grid-4">${kpi(tr('Đã có hàng','Available'),available,pct(available,outcomes),'green')}${kpi(tr('Đã bỏ qua','Skipped'),skipped,pct(skipped,outcomes),skipped?'red':'neutral')}${kpi(tr('Picker thu hồi','Picker withdrawal'),withdrawn,pct(withdrawn,outcomes),'neutral')}${kpi(tr('Tự động bỏ qua','Auto-skipped'),Number(summary.auto_skip_count||0),summary.auto_skip_enabled?`${Number(summary.auto_skip_after_minutes||0)} ${tr('phút','min')}`:tr('Đang tắt','Disabled'),'neutral')}</div></section>
      <div class="v5-layout-main"><section class="v5-panel v5-priority-panel"><div class="v5-panel-head"><h3>${esc(tr('SKU ưu tiên','Priority SKUs'))}</h3><span>${active.length} ${esc(tr('SKU đang mở','open SKUs'))}</span></div>${priorityRows(active,summary)}</section><section class="v5-panel"><div class="v5-panel-head"><h3>${esc(tr('Hiệu suất hôm nay','Today performance'))}</h3></div><div class="v5-compact-grid">${compactMetric(tr('Lượt báo','Reports'),Number(summary.reports||0))}${compactMetric(tr('Đợt SKU','SKU episodes'),issues)}${compactMetric(tr('Xử lý trung vị','Median handling'),minLabel(summary.median_resolution_minutes))}${compactMetric('P95',minLabel(summary.p95_resolution_minutes))}${compactMetric(tr('Báo lại ≤30 phút','Repeated ≤30 min'),Number(summary.recurrent_episodes||0),Number(summary.recurrent_episodes||0)>0?'warn':'')}${compactMetric(tr('Picker ACK trễ','Late Picker ACK'),Number(summary.picker_ack_late_count||0),Number(summary.picker_ack_late_count||0)>0?'warn':'')}</div><div class="v5-outcome-bars">${outcomeBar(tr('Đã có hàng','Available'),available,outcomes,'green')}${outcomeBar(tr('Đã bỏ qua','Skipped'),skipped,outcomes,'red')}${outcomeBar(tr('Picker thu hồi','Picker withdrawal'),withdrawn,outcomes,'gray')}</div></section></div>
      <div class="v5-layout-bottom"><section class="v5-panel"><div class="v5-panel-head"><h3>${esc(tr('Phát sinh 24 giờ','24-hour volume'))}</h3></div>${hourlyBars(summary.hourly_reports_24h||[])}</section><section class="v5-panel"><div class="v5-panel-head"><h3>${esc(tr('SKU phát sinh nhiều','Top reported SKUs'))}</h3></div>${topSkuRows(summary.top_skus||[],8,'reports')}</section></div>
    </div>`;
    $('#v5OpenEvents')?.addEventListener('click',()=>{location.hash='#/events';});
  } catch(error) {
    if(seq===overviewSeq&&routeActive('overview')) content.innerHTML=`<div class="v5-root"><div class="message" data-type="error">${esc(error.message)}</div></div>`;
  }
}

const reportState={preset:'30',from:'',to:'',status:'',page:0,size:25,seq:0,summaryCache:new Map(),pageCache:new Map()};
function reportRange(){
  if(reportState.preset==='custom'&&reportState.from&&reportState.to)return{from:dayStart(reportState.from),to:dayAfter(reportState.to)};
  const days=reportState.preset==='today'?1:Number(reportState.preset||30); const endKey=localDateKey(); const d=new Date(`${endKey}T00:00:00+07:00`); d.setUTCDate(d.getUTCDate()-Math.max(0,days-1)); return{from:dayStart(localDateKey(d)),to:new Date().toISOString()};
}
function rangeCaption(){if(reportState.preset==='today')return tr('Hôm nay','Today');if(reportState.preset==='custom'&&reportState.from&&reportState.to)return`${reportState.from} → ${reportState.to}`;return`${reportState.preset} ${tr('ngày','days')}`;}
function reportSummaryKey(r){return`${r.from}|${r.to}`;}function reportPageKey(r){return`${r.from}|${r.to}|${reportState.status}|${reportState.page}|${reportState.size}`;}
async function loadReportSummary(r){const k=reportSummaryKey(r),hit=cacheRead(reportState.summaryCache,k,60000);if(hit)return hit;return cacheWrite(reportState.summaryCache,k,await rpc('api_reports_summary_v2_rpc',{p_from:r.from,p_to:r.to}));}
async function loadReportPage(r){const k=reportPageKey(r),hit=cacheRead(reportState.pageCache,k,30000);if(hit)return hit;return cacheWrite(reportState.pageCache,k,await rpc('api_issue_history_page_rpc',{p_from:r.from,p_to:r.to,p_status:reportState.status||null,p_limit:reportState.size,p_offset:reportState.page*reportState.size}));}
function reportDetailRows(items=[]){if(!items.length)return`<tr><td colspan="7">${esc(tr('Không có dữ liệu.','No data.'))}</td></tr>`;return items.map((i)=>`<tr><td>${esc(formatDateTime(i.reported_at))}</td><td><strong>${esc(i.sku)}</strong><span>${esc(i.product_name||'—')}</span></td><td class="num">${Number(i.report_count||1)}</td><td><span class="v5-status ${String(i.status||'').toLowerCase()}">${esc(statusLabel(i.status))}</span></td><td>${esc(i.handled_by_name||'—')}</td><td>${i.resolved_at?esc(minLabel(Math.max(0,Math.round((new Date(i.resolved_at)-new Date(i.reported_at))/60000)))):'—'}</td><td>${esc(i.latest_message||'—')}</td></tr>`).join('');}
function renderReportPage(page){const total=Number(page.total||0),pages=Math.max(1,Math.ceil(total/reportState.size));if(reportState.page>pages-1)reportState.page=pages-1;const rows=$('#v5ReportRows');if(rows)rows.innerHTML=reportDetailRows(page.items||[]);const meta=$('#v5ReportMeta');if(meta)meta.textContent=`${tr('Trang','Page')} ${reportState.page+1}/${pages} · ${tr('Tổng','Total')} ${total}`;const prev=$('#v5ReportPrev'),next=$('#v5ReportNext');if(prev)prev.disabled=reportState.page<=0;if(next)next.disabled=reportState.page>=pages-1;}
function renderReportSummary(s){
  const issues=Number(s.issues||0),reports=Number(s.reports||0),available=Number(s.available||0),skipped=Number(s.skipped||0),withdrawn=Number(s.withdrawn||0),outcomes=Math.max(1,available+skipped+withdrawn);
  const top=$('#v5ReportKpis');if(top)top.innerHTML=`${kpi(tr('Lượt báo','Reports'),reports,`${issues} ${tr('đợt SKU','SKU episodes')}`,'blue')}${kpi(tr('Đã có hàng','Available'),available,pct(available,outcomes),'green')}${kpi(tr('Đã bỏ qua','Skipped'),skipped,pct(skipped,outcomes),skipped?'red':'neutral')}${kpi(tr('Picker thu hồi','Picker withdrawal'),withdrawn,pct(withdrawn,outcomes),'neutral')}${kpi(tr('Tự động bỏ qua','Auto-skipped'),Number(s.auto_skip_count||0),pct(s.auto_skip_count,issues),'neutral')}${kpi(tr('Báo lại ≤30 phút','Repeated ≤30 min'),Number(s.recurrent_episodes||0),pct(s.recurrent_episodes,issues),Number(s.recurrent_episodes||0)>0?'amber':'neutral')}`;
  const perf=$('#v5ReportPerf');if(perf)perf.innerHTML=`${compactMetric(tr('Trung bình','Average'),minLabel(s.average_resolution_minutes))}${compactMetric(tr('Trung vị','Median'),minLabel(s.median_resolution_minutes))}${compactMetric('P95',minLabel(s.p95_resolution_minutes))}${compactMetric(tr('Quá mốc Inventory','Inventory overdue'),`${Number(s.inventory_overdue_count||0)} · ${pct(s.inventory_overdue_count,issues)}`,Number(s.inventory_overdue_count||0)>0?'warn':'')}${compactMetric(tr('Picker ACK trễ','Late Picker ACK'),`${Number(s.picker_ack_late_count||0)} · ${pct(s.picker_ack_late_count,s.picker_alert_count)}`,Number(s.picker_ack_late_count||0)>0?'warn':'')}${compactMetric(tr('Đang chờ ACK','Awaiting ACK'),Number(s.picker_waiting_ack_now||0),Number(s.picker_waiting_ack_now||0)>0?'warn':'')}`;
  const outcome=$('#v5ReportOutcome');if(outcome)outcome.innerHTML=`${outcomeBar(tr('Đã có hàng','Available'),available,outcomes,'green')}${outcomeBar(tr('Đã bỏ qua','Skipped'),skipped,outcomes,'red')}${outcomeBar(tr('Picker thu hồi','Picker withdrawal'),withdrawn,outcomes,'gray')}`;
  const trend=$('#v5ReportTrend');if(trend)trend.innerHTML=dailyBars(s.daily_reports||[]);
  const sku=$('#v5ReportTopSku');if(sku)sku.innerHTML=topSkuRows(s.top_skus||[],8,'reports');
  const auto=$('#v5ReportAutoSku');if(auto)auto.innerHTML=topSkuRows(s.top_auto_skip_skus||[],8,'count');
}
async function refreshReportTable(seq,range){const body=$('#v5ReportRows');if(body)body.innerHTML=`<tr><td colspan="7" class="v5-loading">${esc(tr('Đang tải…','Loading…'))}</td></tr>`;try{const p=await loadReportPage(range);if(seq===reportState.seq&&routeActive('reports'))renderReportPage(p);}catch(e){if(seq===reportState.seq&&body)body.innerHTML=`<tr><td colspan="7"><div class="message" data-type="error">${esc(e.message)}</div></td></tr>`;}}
function bindReportControls(seq,range){
  document.querySelectorAll('[data-v5-range]').forEach((b)=>b.onclick=()=>{reportState.preset=b.dataset.v5Range;reportState.page=0;if(reportState.preset==='custom'&&(!reportState.from||!reportState.to)){reportState.from=localDateKey(new Date(Date.now()-6*86400000));reportState.to=localDateKey();}void renderReportV5();});
  $('#v5From').onchange=(e)=>{reportState.from=e.target.value;reportState.preset='custom';reportState.page=0;if(reportState.to)void renderReportV5();};$('#v5To').onchange=(e)=>{reportState.to=e.target.value;reportState.preset='custom';reportState.page=0;if(reportState.from)void renderReportV5();};
  $('#v5Status').onchange=(e)=>{reportState.status=e.target.value;reportState.page=0;void refreshReportTable(seq,range);};$('#v5Size').onchange=(e)=>{const n=Number(e.target.value);reportState.size=PAGE_SIZES.has(n)?n:25;reportState.page=0;void refreshReportTable(seq,range);};
  $('#v5ReportPrev').onclick=()=>{if(reportState.page<=0)return;reportState.page--;void refreshReportTable(seq,range);};$('#v5ReportNext').onclick=()=>{reportState.page++;void refreshReportTable(seq,range);};$('#v5Export').onclick=()=>void exportReportV5(range);
}
async function exportReportV5(range){const button=$('#v5Export');if(button)button.disabled=true;try{const summary=await loadReportSummary(range),all=[];let offset=0,total=1;while(offset<total){const page=await rpc('api_issue_history_page_rpc',{p_from:range.from,p_to:range.to,p_status:reportState.status||null,p_limit:100,p_offset:offset});const items=page.items||[];all.push(...items);total=Number(page.total||0);if(!items.length)break;offset+=items.length;}const module=await import('exceljs'),ExcelJS=module.default??module,book=new ExcelJS.Workbook();const s=book.addWorksheet(tr('Tổng hợp','Summary'));[[tr('Báo cáo vận hành 1291','1291 Operations report'),''],[tr('Khoảng thời gian','Period'),rangeCaption()],[tr('Bộ lọc kết quả','Outcome filter'),reportState.status?statusLabel(reportState.status):tr('Tất cả','All')],[tr('Lượt báo','Reports'),Number(summary.reports||0)],[tr('Đợt SKU','SKU episodes'),Number(summary.issues||0)],[tr('Đã có hàng','Available'),Number(summary.available||0)],[tr('Đã bỏ qua','Skipped'),Number(summary.skipped||0)],[tr('Picker thu hồi','Picker withdrawal'),Number(summary.withdrawn||0)],[tr('Tự động bỏ qua','Auto-skipped'),Number(summary.auto_skip_count||0)],[tr('Trung bình xử lý (phút)','Average handling (min)'),summary.average_resolution_minutes??''],[tr('Trung vị xử lý (phút)','Median handling (min)'),summary.median_resolution_minutes??''],['P95',summary.p95_resolution_minutes??''],[tr('Quá mốc Inventory','Inventory overdue'),Number(summary.inventory_overdue_count||0)],[tr('Picker ACK trễ','Late Picker ACK'),Number(summary.picker_ack_late_count||0)]].forEach((r)=>s.addRow(r));s.columns=[{width:34},{width:26}];s.getRow(1).font={bold:true,size:15};const d=book.addWorksheet(tr('Chi tiết','Details'));d.columns=[{header:tr('Thời gian','Time'),key:'time',width:22},{header:'SKU',key:'sku',width:16},{header:tr('Tên hàng','Item'),key:'name',width:42},{header:tr('Lượt báo','Reports'),key:'reports',width:12},{header:tr('Kết quả','Outcome'),key:'outcome',width:18},{header:tr('Người xử lý','Handler'),key:'handler',width:25},{header:tr('Thời gian xử lý','Handling time'),key:'duration',width:18},{header:tr('Ghi chú','Note'),key:'note',width:42}];all.forEach((i)=>d.addRow({time:formatDateTime(i.reported_at),sku:i.sku,name:i.product_name||'',reports:Number(i.report_count||1),outcome:statusLabel(i.status),handler:i.handled_by_name||'',duration:i.resolved_at?Math.max(0,Math.round((new Date(i.resolved_at)-new Date(i.reported_at))/60000)):'',note:i.latest_message||''}));d.getRow(1).font={bold:true};d.views=[{state:'frozen',ySplit:1}];d.autoFilter={from:'A1',to:'H1'};const buffer=await book.xlsx.writeBuffer(),url=URL.createObjectURL(new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),a=document.createElement('a');a.href=url;a.download=`Bao_cao_van_hanh_1291_${localDateKey()}.xlsx`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){alert(`${tr('Không xuất được Excel:','Unable to export Excel:')} ${e.message}`);}finally{if(button)button.disabled=false;}}
async function renderReportV5(){
  if(!routeActive('reports'))return;const content=$('#content');if(!content)return;const seq=++reportState.seq,range=reportRange();
  content.innerHTML=`<div class="v5-root v5-report"><div class="v5-page-head"><div><h2>${esc(tr('Báo cáo vận hành','Operations report'))}</h2></div><div class="v5-head-actions"><span>${esc(rangeCaption())}</span><button class="primary" id="v5Export">${esc(tr('Xuất Excel','Export Excel'))}</button></div></div>
  <div class="v5-filter"><div class="v5-presets"><button data-v5-range="today" class="${reportState.preset==='today'?'active':''}">${esc(tr('Hôm nay','Today'))}</button><button data-v5-range="7" class="${reportState.preset==='7'?'active':''}">7 ${esc(tr('ngày','days'))}</button><button data-v5-range="30" class="${reportState.preset==='30'?'active':''}">30 ${esc(tr('ngày','days'))}</button><button data-v5-range="custom" class="${reportState.preset==='custom'?'active':''}">${esc(tr('Tùy chọn','Custom'))}</button></div><label>${esc(tr('Từ','From'))}<input id="v5From" type="date" value="${esc(reportState.from)}"></label><label>${esc(tr('Đến','To'))}<input id="v5To" type="date" value="${esc(reportState.to)}"></label></div>
  <section class="v5-block"><div class="v5-block-head"><h3>${esc(tr('Tổng hợp','Summary'))}</h3></div><div id="v5ReportKpis" class="v5-kpi-grid v5-kpi-grid-6"><div class="v5-skeleton"></div></div></section>
  <div class="v5-report-insights"><section class="v5-panel"><div class="v5-panel-head"><h3>${esc(tr('Tốc độ & SLA','Speed & SLA'))}</h3></div><div id="v5ReportPerf" class="v5-compact-grid"><div class="v5-skeleton"></div></div></section><section class="v5-panel"><div class="v5-panel-head"><h3>${esc(tr('Cơ cấu kết quả','Outcome mix'))}</h3></div><div id="v5ReportOutcome" class="v5-outcome-bars"><div class="v5-skeleton"></div></div></section></div>
  <div class="v5-report-analytics"><section class="v5-panel"><div class="v5-panel-head"><h3>${esc(tr('Xu hướng theo ngày','Daily trend'))}</h3></div><div id="v5ReportTrend"><div class="v5-skeleton"></div></div></section><section class="v5-panel"><div class="v5-panel-head"><h3>${esc(tr('SKU phát sinh nhiều','Top reported SKUs'))}</h3></div><div id="v5ReportTopSku"><div class="v5-skeleton"></div></div></section><section class="v5-panel"><div class="v5-panel-head"><h3>${esc(tr('SKU tự động bỏ qua nhiều','Top auto-skipped SKUs'))}</h3></div><div id="v5ReportAutoSku"><div class="v5-skeleton"></div></div></section></div>
  <section class="v5-panel v5-detail"><div class="v5-detail-head"><div><h3>${esc(tr('Chi tiết báo thiếu','Shortage details'))}</h3></div><div class="v5-detail-tools"><label>${esc(tr('Kết quả','Outcome'))}<select id="v5Status"><option value="">${esc(tr('Tất cả','All'))}</option><option value="OPEN" ${reportState.status==='OPEN'?'selected':''}>${esc(tr('Đang xử lý','In progress'))}</option><option value="AVAILABLE" ${reportState.status==='AVAILABLE'?'selected':''}>${esc(tr('Đã có hàng','Available'))}</option><option value="SKIP_ALLOWED" ${reportState.status==='SKIP_ALLOWED'?'selected':''}>${esc(tr('Đã bỏ qua','Skipped'))}</option><option value="WITHDRAWN" ${reportState.status==='WITHDRAWN'?'selected':''}>${esc(tr('Picker thu hồi','Picker withdrawal'))}</option></select></label><label>${esc(tr('Số dòng','Rows'))}<select id="v5Size">${[25,50,100].map((n)=>`<option value="${n}" ${n===reportState.size?'selected':''}>${n}</option>`).join('')}</select></label></div></div><div class="v5-table-wrap"><table class="v5-table v5-detail-table"><thead><tr><th>${esc(tr('Thời gian','Time'))}</th><th>SKU / ${esc(tr('Tên hàng','Item'))}</th><th>${esc(tr('Lượt','Reports'))}</th><th>${esc(tr('Kết quả','Outcome'))}</th><th>${esc(tr('Người xử lý','Handler'))}</th><th>${esc(tr('Thời gian xử lý','Handling time'))}</th><th>${esc(tr('Ghi chú','Note'))}</th></tr></thead><tbody id="v5ReportRows"><tr><td colspan="7" class="v5-loading">${esc(tr('Đang tải…','Loading…'))}</td></tr></tbody></table></div><div class="v5-pager"><span id="v5ReportMeta">—</span><div><button class="secondary" id="v5ReportPrev">‹ ${esc(tr('Trước','Previous'))}</button><button class="secondary" id="v5ReportNext">${esc(tr('Sau','Next'))} ›</button></div></div></section></div>`;
  bindReportControls(seq,range);const sp=loadReportSummary(range),pp=loadReportPage(range);sp.then((s)=>{if(seq===reportState.seq&&routeActive('reports'))renderReportSummary(s);}).catch((e)=>{const r=$('#v5ReportKpis');if(r&&seq===reportState.seq)r.innerHTML=`<div class="message" data-type="error">${esc(e.message)}</div>`;});pp.then((p)=>{if(seq===reportState.seq&&routeActive('reports'))renderReportPage(p);}).catch((e)=>{const r=$('#v5ReportRows');if(r&&seq===reportState.seq)r.innerHTML=`<tr><td colspan="7"><div class="message" data-type="error">${esc(e.message)}</div></td></tr>`;});
}

globalThis.__BH_OVERVIEW_V5_RENDER__=renderOverviewV5;
globalThis.__BH_REPORT_V5_RENDER__=renderReportV5;
globalThis.__BH_DASHBOARD_V5__=Object.freeze({version:'v5-compact-ops',overview:true,reports:true,verboseCopy:false});
