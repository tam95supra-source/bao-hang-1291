import './workflow-v4-ux.css';
import { getLocale, t } from './i18n.js';

const BACKEND = 'https://backend.bao-hang-1291.invalid';
const SESSION_KEY = 'bao-hang-1291-web-session';
const PAGE_SIZES = new Set([25, 50, 100]);
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
function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString(getLocale(), { hour12:false });
}
function minLabel(value) { return value == null ? '—' : `${Number(value).toLocaleString(getLocale(), {maximumFractionDigits:1})} ${tr('phút','min')}`; }
function pct(n, d) { return Number(d || 0) > 0 ? `${(Number(n || 0) / Number(d) * 100).toLocaleString(getLocale(), {maximumFractionDigits:1})}%` : '0%'; }
function statusLabel(status) {
  return ({OPEN:tr('Đang xử lý','In progress'),AVAILABLE:tr('Đã có hàng','Available'),SKIP_ALLOWED:tr('Đã bỏ qua','Skipped'),WITHDRAWN:tr('Picker thu hồi','Picker withdrawal')})[String(status||'').toUpperCase()] || String(status || '—');
}

const reportState = { preset:'30', from:'', to:'', status:'', page:0, size:25, seq:0, summaryCache:new Map(), pageCache:new Map() };
function reportRange() {
  if (reportState.preset === 'custom' && reportState.from && reportState.to) return {from:dayStart(reportState.from), to:dayAfter(reportState.to)};
  const days = reportState.preset === 'today' ? 1 : Number(reportState.preset || 30);
  const endKey = localDateKey();
  const start = new Date(`${endKey}T00:00:00+07:00`);
  start.setUTCDate(start.getUTCDate() - Math.max(0, days - 1));
  return {from:dayStart(localDateKey(start)), to:new Date().toISOString()};
}
function rangeCaption() {
  if (reportState.preset === 'today') return tr('Hôm nay','Today');
  if (reportState.preset === 'custom' && reportState.from && reportState.to) return `${reportState.from} → ${reportState.to}`;
  return `${reportState.preset} ${tr('ngày gần nhất','recent days')}`;
}
function cacheRead(map, key, ttl = 60000) {
  const hit = map.get(key);
  return hit && Date.now() - hit.at < ttl ? hit.value : null;
}
function cacheWrite(map, key, value) { map.set(key, {at:Date.now(), value}); return value; }
function summaryKey(range) { return `${range.from}|${range.to}`; }
function pageKey(range) { return `${range.from}|${range.to}|${reportState.status}|${reportState.page}|${reportState.size}`; }
async function loadSummary(range) {
  const key = summaryKey(range), cached = cacheRead(reportState.summaryCache, key);
  if (cached) return cached;
  return cacheWrite(reportState.summaryCache, key, await rpc('api_reports_summary_v2_rpc', {p_from:range.from,p_to:range.to}));
}
async function loadPage(range) {
  const key = pageKey(range), cached = cacheRead(reportState.pageCache, key, 30000);
  if (cached) return cached;
  return cacheWrite(reportState.pageCache, key, await rpc('api_issue_history_page_rpc', {
    p_from:range.from,p_to:range.to,p_status:reportState.status || null,p_limit:reportState.size,p_offset:reportState.page*reportState.size,
  }));
}
function primaryCard(label, value, hint = '', tone = '') {
  return `<article class="v4-kpi ${tone}"><span>${esc(label)}</span><strong>${esc(value)}</strong>${hint?`<small>${esc(hint)}</small>`:''}</article>`;
}
function attentionRow(label, value, note, tone='') {
  return `<div class="v4-attention ${tone}"><div><b>${esc(label)}</b><small>${esc(note)}</small></div><strong>${esc(value)}</strong></div>`;
}
function dailyBars(rows = []) {
  if (!rows.length) return `<div class="v4-empty">${esc(tr('Chưa có dữ liệu trong khoảng này.','No data in this range.'))}</div>`;
  const max = Math.max(1, ...rows.map((x)=>Number(x.reports || 0)));
  return `<div class="v4-trend">${rows.map((x)=>{
    const n=Number(x.reports||0), width=Math.max(3,Math.round(n/max*100));
    return `<div class="v4-trend-row"><span>${esc(String(x.day).slice(5))}</span><div><i style="width:${width}%"></i></div><b>${n}</b></div>`;
  }).join('')}</div>`;
}
function topSkuTable(rows = []) {
  const body = rows.slice(0,8).map((x,n)=>`<tr><td>${n+1}</td><td><b>${esc(x.sku)}</b></td><td>${esc(x.product_name||'—')}</td><td class="num">${Number(x.reports||0)}</td></tr>`).join('');
  return `<div class="v4-table-wrap"><table class="v4-table"><thead><tr><th>#</th><th>SKU</th><th>${esc(tr('Tên hàng','Item'))}</th><th>${esc(tr('Lượt báo','Reports'))}</th></tr></thead><tbody>${body||`<tr><td colspan="4">${esc(tr('Chưa có dữ liệu.','No data yet.'))}</td></tr>`}</tbody></table></div>`;
}
function renderSummary(summary) {
  const issues=Number(summary.issues||0), reports=Number(summary.reports||0), available=Number(summary.available||0), skipped=Number(summary.skipped||0), withdrawn=Number(summary.withdrawn||0);
  const outcome=Math.max(1,available+skipped+withdrawn);
  $('#v4Primary')?.replaceChildren();
  const primary=$('#v4Primary'); if(primary) primary.innerHTML =
    primaryCard(tr('Lượt báo thiếu','Shortage reports'), reports, `${issues} ${tr('đợt SKU','SKU episodes')}`) +
    primaryCard(tr('Đã có hàng','Available'), available, pct(available,outcome), 'good') +
    primaryCard(tr('Đã bỏ qua','Skipped'), skipped, pct(skipped,outcome), skipped?'danger':'') +
    primaryCard(tr('Picker đang chờ xác nhận','Picker awaiting ACK'), Number(summary.picker_waiting_ack_now||0), tr('cần xử lý ngay','needs attention'), Number(summary.picker_waiting_ack_now||0)?'warn':'');
  const attention=$('#v4Attention'); if(attention) attention.innerHTML =
    attentionRow(tr('Thời gian xử lý điển hình','Typical handling time'), minLabel(summary.median_resolution_minutes), tr('50% yêu cầu hoàn tất nhanh hơn mốc này.','50% of requests finish within this time.')) +
    attentionRow(tr('95% yêu cầu hoàn tất trong','95% completed within'), minLabel(summary.p95_resolution_minutes), tr('Dùng để nhìn các ca xử lý chậm bất thường.','Highlights unusually slow handling.')) +
    attentionRow(tr('Quá mốc nhắc Inventory','Past Inventory reminder'), `${Number(summary.inventory_overdue_count||0)} · ${pct(summary.inventory_overdue_count,issues)}`, tr('Tính trên số đợt SKU trong kỳ.','Based on SKU episodes in the period.'), Number(summary.inventory_overdue_count||0)?'danger':'') +
    attentionRow(tr('Picker xác nhận trễ','Late Picker ACK'), `${Number(summary.picker_ack_late_count||0)} · ${pct(summary.picker_ack_late_count,summary.picker_alert_count)}`, tr('Tính trên số cảnh báo cần Picker xác nhận.','Based on alerts requiring Picker acknowledgement.'), Number(summary.picker_ack_late_count||0)?'warn':'');
  const outcomeEl=$('#v4Outcome'); if(outcomeEl) outcomeEl.innerHTML = `<div class="v4-outcome-row good"><span>${esc(tr('Đã có hàng','Available'))}</span><b>${available}</b><small>${pct(available,outcome)}</small></div><div class="v4-outcome-row danger"><span>${esc(tr('Đã bỏ qua','Skipped'))}</span><b>${skipped}</b><small>${pct(skipped,outcome)}</small></div><div class="v4-outcome-row"><span>${esc(tr('Picker thu hồi','Picker withdrawal'))}</span><b>${withdrawn}</b><small>${pct(withdrawn,outcome)}</small></div><div class="v4-outcome-row muted"><span>${esc(tr('Tự động bỏ qua','Auto-skipped'))}</span><b>${Number(summary.auto_skip_count||0)}</b><small>${esc(tr('trong số đã bỏ qua','of skipped'))}</small></div>`;
  const trend=$('#v4Trend'); if(trend) trend.innerHTML=dailyBars(summary.daily_reports||[]);
  const top=$('#v4TopSku'); if(top) top.innerHTML=topSkuTable(summary.top_skus||[]);
}
function detailRows(items=[]) {
  if (!items.length) return `<tr><td colspan="7">${esc(tr('Không có dữ liệu phù hợp bộ lọc.','No data matches the filter.'))}</td></tr>`;
  return items.map((i)=>`<tr><td>${esc(formatDateTime(i.reported_at))}</td><td><b>${esc(i.sku)}</b><small>${esc(i.product_name||'')}</small></td><td class="num">${Number(i.report_count||1)}</td><td><span class="v4-status ${String(i.status||'').toLowerCase()}">${esc(statusLabel(i.status))}</span></td><td>${esc(i.handled_by_name||'—')}</td><td>${i.resolved_at?esc(minLabel(Math.max(0,Math.round((new Date(i.resolved_at)-new Date(i.reported_at))/60000)))):'—'}</td><td>${esc(i.latest_message||'—')}</td></tr>`).join('');
}
function renderDetail(page) {
  const total=Number(page.total||0), pages=Math.max(1,Math.ceil(total/reportState.size));
  if(reportState.page>pages-1) reportState.page=pages-1;
  const rows=$('#v4DetailRows'); if(rows) rows.innerHTML=detailRows(page.items||[]);
  const meta=$('#v4PageMeta'); if(meta) meta.textContent=`${tr('Trang','Page')} ${reportState.page+1}/${pages} · ${tr('Tổng','Total')} ${total}`;
  const prev=$('#v4Prev'), next=$('#v4Next'); if(prev) prev.disabled=reportState.page<=0; if(next) next.disabled=reportState.page>=pages-1;
}
async function refreshDetail(seq, range) {
  const body=$('#v4DetailRows'); if(body) body.innerHTML=`<tr><td colspan="7" class="v4-loading">${esc(tr('Đang tải chi tiết…','Loading details…'))}</td></tr>`;
  try { const page=await loadPage(range); if(seq===reportState.seq&&routeActive('reports')) renderDetail(page); }
  catch(error){ if(seq===reportState.seq&&body) body.innerHTML=`<tr><td colspan="7"><div class="message" data-type="error">${esc(error.message)}</div></td></tr>`; }
}
function bindReportControls(seq, range) {
  document.querySelectorAll('[data-v4-range]').forEach((b)=>b.onclick=()=>{reportState.preset=b.dataset.v4Range;reportState.page=0;if(reportState.preset==='custom'&&(!reportState.from||!reportState.to)){reportState.from=localDateKey(new Date(Date.now()-6*86400000));reportState.to=localDateKey();}void renderReportV4();});
  $('#v4From').onchange=(e)=>{reportState.from=e.target.value;reportState.preset='custom';reportState.page=0;if(reportState.to)void renderReportV4();};
  $('#v4To').onchange=(e)=>{reportState.to=e.target.value;reportState.preset='custom';reportState.page=0;if(reportState.from)void renderReportV4();};
  $('#v4Status').onchange=(e)=>{reportState.status=e.target.value;reportState.page=0;void refreshDetail(seq,range);};
  $('#v4Size').onchange=(e)=>{const n=Number(e.target.value);reportState.size=PAGE_SIZES.has(n)?n:25;reportState.page=0;void refreshDetail(seq,range);};
  $('#v4Prev').onclick=()=>{if(reportState.page<=0)return;reportState.page--;void refreshDetail(seq,range);};
  $('#v4Next').onclick=()=>{reportState.page++;void refreshDetail(seq,range);};
  $('#v4Export').onclick=()=>void exportReportV4(range);
}
async function exportReportV4(range) {
  const button=$('#v4Export'); if(button)button.disabled=true;
  try {
    const summary=await loadSummary(range), all=[]; let offset=0,total=1;
    while(offset<total){const page=await rpc('api_issue_history_page_rpc',{p_from:range.from,p_to:range.to,p_status:null,p_limit:100,p_offset:offset});const items=page.items||[];all.push(...items);total=Number(page.total||0);if(!items.length)break;offset+=items.length;}
    const module=await import('exceljs'), ExcelJS=module.default??module, book=new ExcelJS.Workbook();
    const s=book.addWorksheet(tr('Tổng hợp','Summary'));
    [[tr('Báo cáo vận hành 1291','1291 Operations report'),''],[tr('Khoảng thời gian','Period'),rangeCaption()],[tr('Lượt báo','Reports'),Number(summary.reports||0)],[tr('Đợt SKU','SKU episodes'),Number(summary.issues||0)],[tr('Đã có hàng','Available'),Number(summary.available||0)],[tr('Đã bỏ qua','Skipped'),Number(summary.skipped||0)],[tr('Picker thu hồi','Picker withdrawal'),Number(summary.withdrawn||0)],[tr('Median xử lý (phút)','Median handling (min)'),summary.median_resolution_minutes??''],[tr('P95 xử lý (phút)','P95 handling (min)'),summary.p95_resolution_minutes??'']].forEach((r)=>s.addRow(r));
    s.columns=[{width:34},{width:26}];s.getRow(1).font={bold:true,size:15};
    const d=book.addWorksheet(tr('Chi tiết','Details'));d.columns=[{header:tr('Thời gian','Time'),key:'time',width:22},{header:'SKU',key:'sku',width:16},{header:tr('Tên hàng','Item'),key:'name',width:42},{header:tr('Lượt báo','Reports'),key:'reports',width:12},{header:tr('Kết quả','Outcome'),key:'outcome',width:18},{header:tr('Người xử lý','Handler'),key:'handler',width:25},{header:tr('Ghi chú','Note'),key:'note',width:42}];
    all.forEach((i)=>d.addRow({time:formatDateTime(i.reported_at),sku:i.sku,name:i.product_name||'',reports:Number(i.report_count||1),outcome:statusLabel(i.status),handler:i.handled_by_name||'',note:i.latest_message||''}));d.getRow(1).font={bold:true};d.views=[{state:'frozen',ySplit:1}];d.autoFilter={from:'A1',to:'G1'};
    const buffer=await book.xlsx.writeBuffer(), url=URL.createObjectURL(new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})), a=document.createElement('a');a.href=url;a.download=`Bao_cao_van_hanh_1291_${localDateKey()}.xlsx`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  } catch(error) { alert(`${tr('Không xuất được Excel:','Unable to export Excel:')} ${error.message}`); }
  finally { if(button)button.disabled=false; }
}
async function renderReportV4() {
  if(!routeActive('reports'))return;
  const content=$('#content'); if(!content)return;
  const seq=++reportState.seq, range=reportRange();
  content.innerHTML=`<div class="v4-report">
    <div class="v4-heading"><div><h2>${esc(tr('Báo cáo vận hành','Operations report'))}</h2><p>${esc(tr('Nhìn nhanh kết quả, điểm chậm và SKU cần chú ý.','See outcomes, delays, and SKUs needing attention at a glance.'))}</p></div><div><small>${esc(rangeCaption())}</small><button class="primary" id="v4Export">${esc(tr('Xuất Excel','Export Excel'))}</button></div></div>
    <div class="v4-filter"><div class="v4-presets"><button data-v4-range="today" class="${reportState.preset==='today'?'active':''}">${esc(tr('Hôm nay','Today'))}</button><button data-v4-range="7" class="${reportState.preset==='7'?'active':''}">7 ${esc(tr('ngày','days'))}</button><button data-v4-range="30" class="${reportState.preset==='30'?'active':''}">30 ${esc(tr('ngày','days'))}</button><button data-v4-range="custom" class="${reportState.preset==='custom'?'active':''}">${esc(tr('Tùy chọn','Custom'))}</button></div><label>${esc(tr('Từ','From'))}<input id="v4From" type="date" value="${esc(reportState.from)}"></label><label>${esc(tr('Đến','To'))}<input id="v4To" type="date" value="${esc(reportState.to)}"></label></div>
    <section><div class="v4-section-title"><div><h3>${esc(tr('Kết quả chính','Key results'))}</h3><p>${esc(tr('Bốn con số cần nhìn đầu tiên.','The four numbers to check first.'))}</p></div></div><div id="v4Primary" class="v4-primary"><div class="v4-loading-card">${esc(tr('Đang tổng hợp…','Compiling…'))}</div></div></section>
    <div class="v4-two"><section class="v4-panel"><div class="v4-section-title"><div><h3>${esc(tr('Điểm cần chú ý','Needs attention'))}</h3><p>${esc(tr('Diễn giải theo nghiệp vụ, không chỉ hiển thị thuật ngữ thống kê.','Business-readable explanations instead of raw statistical terms.'))}</p></div></div><div id="v4Attention"><div class="v4-loading-card">${esc(tr('Đang tải…','Loading…'))}</div></div></section><section class="v4-panel"><div class="v4-section-title"><div><h3>${esc(tr('Kết quả xử lý','Outcomes'))}</h3><p>${esc(tr('Tỷ trọng các kết quả đã hoàn tất.','Share of completed outcomes.'))}</p></div></div><div id="v4Outcome" class="v4-outcomes"><div class="v4-loading-card">${esc(tr('Đang tải…','Loading…'))}</div></div></section></div>
    <div class="v4-two"><section class="v4-panel"><div class="v4-section-title"><div><h3>${esc(tr('Lượt báo theo ngày','Reports by day'))}</h3><p>${esc(tr('Thanh dài hơn = phát sinh nhiều hơn trong kỳ đang xem.','Longer bar = more reports in the selected period.'))}</p></div></div><div id="v4Trend"><div class="v4-loading-card">${esc(tr('Đang tải…','Loading…'))}</div></div></section><section class="v4-panel"><div class="v4-section-title"><div><h3>${esc(tr('SKU phát sinh nhiều','Frequently reported SKUs'))}</h3><p>${esc(tr('Ưu tiên kiểm tra các SKU lặp lại nhiều lần.','Prioritize SKUs reported repeatedly.'))}</p></div></div><div id="v4TopSku"><div class="v4-loading-card">${esc(tr('Đang tải…','Loading…'))}</div></div></section></div>
    <section class="v4-panel v4-detail"><div class="v4-section-title v4-detail-head"><div><h3>${esc(tr('Chi tiết báo thiếu','Shortage details'))}</h3><p>${esc(tr('Phân trang máy chủ; thay bộ lọc chỉ tải phần bảng này.','Server pagination; changing this filter reloads only the table.'))}</p></div><div class="v4-detail-tools"><label>${esc(tr('Kết quả','Outcome'))}<select id="v4Status"><option value="">${esc(tr('Tất cả','All'))}</option><option value="OPEN" ${reportState.status==='OPEN'?'selected':''}>${esc(tr('Đang xử lý','In progress'))}</option><option value="AVAILABLE" ${reportState.status==='AVAILABLE'?'selected':''}>${esc(tr('Đã có hàng','Available'))}</option><option value="SKIP_ALLOWED" ${reportState.status==='SKIP_ALLOWED'?'selected':''}>${esc(tr('Đã bỏ qua','Skipped'))}</option></select></label><label>${esc(tr('Số dòng','Rows'))}<select id="v4Size">${[25,50,100].map((n)=>`<option value="${n}" ${n===reportState.size?'selected':''}>${n}</option>`).join('')}</select></label></div></div><div class="v4-table-wrap"><table class="v4-table v4-detail-table"><thead><tr><th>${esc(tr('Thời gian','Time'))}</th><th>SKU / ${esc(tr('Tên hàng','Item'))}</th><th>${esc(tr('Lượt','Reports'))}</th><th>${esc(tr('Kết quả','Outcome'))}</th><th>${esc(tr('Người xử lý','Handler'))}</th><th>${esc(tr('Thời gian xử lý','Handling time'))}</th><th>${esc(tr('Ghi chú','Note'))}</th></tr></thead><tbody id="v4DetailRows"><tr><td colspan="7" class="v4-loading">${esc(tr('Đang tải chi tiết…','Loading details…'))}</td></tr></tbody></table></div><div class="v4-pager"><span id="v4PageMeta">—</span><div><button class="secondary" id="v4Prev">‹ ${esc(tr('Trước','Previous'))}</button><button class="secondary" id="v4Next">${esc(tr('Sau','Next'))} ›</button></div></div></section>
  </div>`;
  bindReportControls(seq, range);
  const summaryPromise=loadSummary(range), pagePromise=loadPage(range);
  summaryPromise.then((s)=>{if(seq===reportState.seq&&routeActive('reports'))renderSummary(s);}).catch((e)=>{const root=$('#v4Primary');if(root&&seq===reportState.seq)root.innerHTML=`<div class="message" data-type="error">${esc(e.message)}</div>`;});
  pagePromise.then((p)=>{if(seq===reportState.seq&&routeActive('reports'))renderDetail(p);}).catch((e)=>{const root=$('#v4DetailRows');if(root&&seq===reportState.seq)root.innerHTML=`<tr><td colspan="7"><div class="message" data-type="error">${esc(e.message)}</div></td></tr>`;});
}

async function renderDevicesV4() {
  if(!routeActive('devices'))return;
  const content=$('#content'); if(!content)return;
  content.innerHTML=`<div class="v4-devices"><div class="v4-heading"><div><h2>${esc(tr('Thiết bị & thông báo','Devices & notifications'))}</h2><p>${esc(tr('Theo dõi khả năng nhận thông báo mà không phải chờ Google Drive.','Check notification readiness without waiting for Google Drive.'))}</p></div><button class="secondary" id="v4OpenLogs">${esc(tr('Mở log thiết bị','Open device logs'))}</button></div><div id="v4DeviceBody"><div class="v4-primary"><div class="v4-loading-card">${esc(tr('Đang đọc trạng thái hệ thống…','Loading system status…'))}</div></div></div></div>`;
  $('#v4OpenLogs').onclick=()=>{location.hash='#/logs';};
  try {
    const data=await api('service-metrics'); if(!routeActive('devices'))return; const u=data.usage||{};
    $('#v4DeviceBody').innerHTML=`<div class="v4-primary v4-device-kpis">${primaryCard(tr('Thiết bị đang đăng ký FCM','Active FCM devices'),Number(u.active_device_tokens||0),tr('đang sẵn sàng nhận push','ready for push'),'good')}${primaryCard(tr('Sự kiện thông báo','Notification events'),Number(u.notification_events||0).toLocaleString(getLocale()),tr('tổng số đã ghi nhận','recorded total'))}${primaryCard(tr('Dữ liệu chờ Google Sheet','Pending Google Sheet rows'),Number(u.sheet_pending||0),tr('không ảnh hưởng màn thiết bị','does not block this page'),Number(u.sheet_pending||0)?'warn':'')}${primaryCard(tr('Log chẩn đoán','Diagnostic logs'),tr('Google Drive','Google Drive'),tr('chỉ tải khi mở Nhật ký','loaded only from Logs'))}</div><div class="v4-two"><section class="v4-panel"><div class="v4-section-title"><div><h3>${esc(tr('Hiểu đúng trạng thái thông báo','How notification states work'))}</h3></div></div><div class="v4-explain"><p><b>FCM accepted</b><span>${esc(tr('Firebase đã nhận yêu cầu gửi; chưa chứng minh thiết bị đã hiển thị thông báo.','Firebase accepted the send request; it does not prove the device displayed it.'))}</span></p><p><b>Client received</b><span>${esc(tr('Ứng dụng trên thiết bị đã nhận payload.','The device app received the payload.'))}</span></p><p><b>ACK</b><span>${esc(tr('Người dùng đã xác nhận cảnh báo trong ứng dụng.','The user acknowledged the alert in the app.'))}</span></p></div></section><section class="v4-panel"><div class="v4-section-title"><div><h3>${esc(tr('Log thiết bị để chẩn đoán','Device logs for diagnostics'))}</h3><p>${esc(tr('Log nằm trên Google Drive nên không được dùng làm dữ liệu chính của màn này.','Logs live on Google Drive, so they are not the primary data source for this page.'))}</p></div></div><p>${esc(tr('Khi cần xem file log cụ thể, mở Nhật ký hệ thống. Việc Drive phản hồi chậm sẽ không còn làm màn Thiết bị bị trắng.','Open System logs only when a specific diagnostic file is needed. Slow Drive responses no longer blank the Devices page.'))}</p><button class="secondary" id="v4OpenLogs2">${esc(tr('Đi tới Nhật ký hệ thống','Go to System logs'))}</button></section></div>`;
    $('#v4OpenLogs2').onclick=()=>{location.hash='#/logs';};
  } catch(error) { if(routeActive('devices')) $('#v4DeviceBody').innerHTML=`<div class="message" data-type="error">${esc(error.message)}</div>`; }
}

globalThis.__BH_REPORT_V4_RENDER__ = renderReportV4;
globalThis.__BH_DEVICE_V4_RENDER__ = renderDevicesV4;
globalThis.__BH_WORKFLOW_V4_LOG_PAGER_PENDING__ = true;
globalThis.__BH_WORKFLOW_V4_UX__ = Object.freeze({version:'v4-business-first', report:true, devices:true, logPagerSingleOwner:true});
