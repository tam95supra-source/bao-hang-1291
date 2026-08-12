from pathlib import Path
import re
ROOT=Path('.')
def read(p): return (ROOT/p).read_text(encoding='utf-8')
def write(p,s): (ROOT/p).write_text(s,encoding='utf-8')
def once(s,old,new,label):
    if s.count(old)!=1: raise SystemExit(f'{label}: {s.count(old)} anchors')
    return s.replace(old,new,1)
def between(s,start,end,new,label):
    i=s.find(start);j=s.find(end,i+len(start)) if i>=0 else -1
    if i<0 or j<0: raise SystemExit(f'{label}: anchor missing')
    return s[:i]+new+s[j:]
def brace_end(s,o):
    d=0;q=None;e=False;line=False;block=False;i=o
    while i<len(s):
        c=s[i];n=s[i+1] if i+1<len(s) else ''
        if line:
            if c=='\n': line=False
            i+=1;continue
        if block:
            if c=='*' and n=='/': block=False;i+=2;continue
            i+=1;continue
        if q:
            if e:e=False
            elif c=='\\':e=True
            elif c==q:q=None
            i+=1;continue
        if c=='/' and n=='/':line=True;i+=2;continue
        if c=='/' and n=='*':block=True;i+=2;continue
        if c in ("'",'"','`'):q=c;i+=1;continue
        if c=='{':d+=1
        elif c=='}':
            d-=1
            if d==0:return i+1
        i+=1
    raise SystemExit('brace error')
def replfn(s,name,new):
    starts=[s.find(f'async function {name}('),s.find(f'function {name}(')];starts=[x for x in starts if x>=0]
    if not starts: raise SystemExit(f'missing {name}')
    st=min(starts);o=s.find('{',st);en=brace_end(s,o);return s[:st]+new+s[en:]

p=Path('supabase/functions/web-api/index.ts');s=read(p)
new_forward='''const forwardedActions = new Set([
  "session-profile", "search-skus", "report-shortage", "active-issues", "issue-board", "my-issues", "issue-detail",
  "claim-issue", "reassign-issue", "update-issue", "pending-alerts", "mark-alert-received", "mark-alert-displayed", "ack-alert",
  "get-operational-config", "save-operational-config", "get-config", "save-config",
  "import-skus", "replace-catalog", "import-users", "list-users", "update-user", "delete-user",
  "staff-sync-now", "staff-sync-status", "service-metrics",
  "sync-google-sheet", "reports-summary", "issue-history", "audit-history", "upload-log", "list-logs", "download-log"
]);'''
s=between(s,'const forwardedActions = new Set([',']);\nfunction isAllowedOrigin',new_forward+'\nfunction isAllowedOrigin','forward set')
s=replfn(s,'adminSummary',r'''async function adminSummary(req: Request) {
  const ctx=await requireWebUser(req);if(!["ADMIN","ADMIN_INVENT"].includes(ctx.effectiveRole))throw new HttpError(403,"Bạn không có quyền xem tổng quan quản trị");
  const [sku,profiles,activeUsers,openIssues,claimedIssues,pendingSheet,logs,staffRun]=await Promise.all([
    admin.from("sku_catalog").select("sku",{count:"exact",head:true}).eq("active",true),admin.from("profiles").select("id",{count:"exact",head:true}),admin.from("profiles").select("id",{count:"exact",head:true}).eq("active",true),admin.from("issues").select("id",{count:"exact",head:true}).eq("status","OPEN"),admin.from("issues").select("id",{count:"exact",head:true}).in("status",["CLAIMED","SEARCHING","REPLENISHING"]),admin.from("sheet_export_queue").select("id",{count:"exact",head:true}).is("exported_at",null),admin.from("diagnostic_logs").select("id",{count:"exact",head:true}),admin.from("staff_sync_runs").select("status,finished_at,eligible_rows,failed_count").order("started_at",{ascending:false}).limit(1).maybeSingle()]);
  for(const r of [sku,profiles,activeUsers,openIssues,claimedIssues,pendingSheet,logs,staffRun])if(r.error)throw r.error;
  return {sku_count:sku.count??0,profile_count:profiles.count??0,active_user_count:activeUsers.count??0,open_issue_count:openIssues.count??0,claimed_issue_count:claimedIssues.count??0,active_issue_count:(openIssues.count??0)+(claimedIssues.count??0),pending_sheet_count:pendingSheet.count??0,diagnostic_log_count:logs.count??0,staff_sync:staffRun.data??null};
}''')
write(p,s)

p=Path('web-admin/src/main.js');s=read(p)
s=s.replace('  inventoryChannel: null,','  catalogChannel: null,\n  staffChannel: null,')
s=s.replace('const channels = [state.issueChannel, state.inventoryChannel].filter(Boolean);','const channels = [state.issueChannel, state.catalogChannel, state.staffChannel].filter(Boolean);')
s=s.replace('  state.inventoryChannel = null;','  state.catalogChannel = null;\n  state.staffChannel = null;')
s=replfn(s,'tabsForRole',r'''function tabsForRole(currentRole) {
  if(currentRole==='ADMIN')return [['overview','Tổng quan'],['events','Sự kiện'],['sku','Danh mục SKU'],['reports','Báo cáo'],['users','Nhân sự & quyền'],['devices','Thiết bị'],['services','Hệ thống & dung lượng'],['logs','Log & audit'],['config','Cấu hình'],['versions','Phiên bản']];
  if(currentRole==='ADMIN_INVENT')return [['overview','Tổng quan'],['events','Sự kiện'],['sku','Danh mục SKU'],['reports','Báo cáo'],['users','Nhân sự'],['logs','Log'],['sla','Mốc thời gian']];
  if(currentRole==='INVENT')return [['events','Sự kiện'],['sku','Danh mục SKU']];return [['picker','Picker']];
}''')
s=s.replace("${healthChip('SERVICE','ONLINE','good')}${healthChip('REALTIME','ĐANG NỐI')}${healthChip('SHEET','—')}${healthChip('TỒN BIN','—')}","${healthChip('SERVICE','ONLINE','good')}${healthChip('REALTIME','ĐANG NỐI')}${healthChip('SHEET','—')}${healthChip('FREE TIER','GIÁM SÁT')}")
s=s.replace('overview: renderOverview, events: renderEvents, picker: renderPicker, inventory: renderInventory, reports: renderReports,\n    sku: renderSku, users: renderUsers, devices: renderDevices, integrations: renderIntegrations, logs: renderLogs,','overview: renderOverview, events: renderEvents, picker: renderPicker, reports: renderReports,\n    sku: renderSku, users: renderUsers, devices: renderDevices, services: renderIntegrations, logs: renderLogs,')
s=s.replace("if (kind === 'inventory' && ['inventory','overview'].includes(state.activeTab)) renderTab();","if (kind === 'catalog' && ['sku','overview','picker'].includes(state.activeTab)) renderTab();\n    if (kind === 'staff' && ['users','overview'].includes(state.activeTab)) renderTab();")
old="""  state.inventoryChannel = realtimeClient.channel('site:1291:inventory', { config: { private: true } })
    .on('broadcast', { event: 'snapshot_published' }, () => scheduleLiveRefresh('inventory'))
    .subscribe(subscribeStatus);"""
new="""  state.catalogChannel = realtimeClient.channel('site:1291:catalog', { config: { private: true } })
    .on('broadcast', { event: 'catalog_changed' }, () => scheduleLiveRefresh('catalog')).subscribe(subscribeStatus);
  state.staffChannel = realtimeClient.channel('site:1291:staff', { config: { private: true } })
    .on('broadcast', { event: 'staff_changed' }, () => scheduleLiveRefresh('staff')).subscribe(subscribeStatus);"""
s=once(s,old,new,'realtime')
s=s.replace("if (['events','picker','inventory','overview'].includes(state.activeTab)) renderTab();","if (['events','picker','sku','overview','users'].includes(state.activeTab)) renderTab();")

s=replfn(s,'renderOverview',r'''async function renderOverview(){
  $('#content').innerHTML=`<div class="heading"><div><p class="eyebrow">LIVE</p><h2>Tổng quan vận hành kho</h2></div></div><div id="metrics" class="metrics"></div><div id="overviewStatus"></div>`;
  try{const [d,r,svc]=await Promise.all([api('admin-summary'),api('reports-summary'),api('service-metrics')]);$('#metrics').innerHTML=[['Chờ nhận',d.open_issue_count],['Đang xử lý',d.claimed_issue_count],['SKU đang dùng',d.sku_count],['Nhân sự hoạt động',d.active_user_count],['Báo 24 giờ',r.last_24h?.reports],['Quá mốc phản hồi',r.overdue_now]].map(([l,v])=>`<article class="metric"><span>${l}</span><strong>${Number(v||0).toLocaleString('vi-VN')}</strong></article>`).join('');const db=Number(svc.usage?.database_bytes||0),lim=Number(svc.free_limits?.database_bytes||1),pct=Math.min(100,db/lim*100);$('#overviewStatus').innerHTML=`<div class="panel-grid"><article class="card"><h3>Hiệu suất 24 giờ</h3><p>Ticket phát sinh: <b>${Number(r.last_24h?.issues||0)}</b> · Đã xử lý: <b>${Number(r.last_24h?.resolved||0)}</b></p><p>Có hàng/châm bù: <b>${Number(r.last_24h?.available||0)}</b> · Cho SKIP: <b>${Number(r.last_24h?.skipped||0)}</b></p><p>Trung vị nhận: <b>${r.median_claim_minutes??'—'} phút</b> · Trung vị hoàn tất: <b>${r.median_resolution_minutes??'—'} phút</b></p></article><article class="card"><h3>Nhân sự nguồn</h3><p>${d.staff_sync?`${escapeHtml(d.staff_sync.status)} · ${formatTime(d.staff_sync.finished_at)} · ${Number(d.staff_sync.eligible_rows||0)} nhân sự`:'Chưa đồng bộ.'}</p></article><article class="card"><h3>Kiểm soát free tier</h3><p>Database: <b>${(db/1048576).toFixed(1)} MB / ${(lim/1048576).toFixed(0)} MB (${pct.toFixed(1)}%)</b></p><p>Thiết bị FCM: ${Number(svc.usage?.active_device_tokens||0)} · Log: ${(Number(svc.usage?.diagnostic_log_bytes||0)/1048576).toFixed(2)} MB · Sheet chờ: ${Number(svc.usage?.sheet_pending||0)}</p><p class="muted">Không tự bật Billing hoặc dịch vụ trả phí.</p></article></div>`;const sheet=$('[data-health="SHEET"]');if(sheet){$('em',sheet).textContent=d.pending_sheet_count?`${d.pending_sheet_count} CHỜ`:'OK';sheet.className=`health-chip ${d.pending_sheet_count?'warn':'good'}`;}const free=$('[data-health="FREE TIER"]');if(free){$('em',free).textContent=`DB ${pct.toFixed(1)}%`;free.className=`health-chip ${pct>=80?'warn':'good'}`;}}
  catch(e){$('#metrics').innerHTML=`<div class="message" data-type="error">${escapeHtml(safeMessage(e))}</div>`;}
}''')
s=s.replace('<div id="selectedSku" class="selected muted">Chưa chọn SKU</div><div id="stockHint"></div><button','<div id="selectedSku" class="selected muted">Chưa chọn SKU</div><button')
s=replfn(s,'selectSku',r'''async function selectSku(item){state.selectedSku=item;$('#selectedSku').classList.remove('muted');$('#selectedSku').innerHTML=`<strong>SKU ${escapeHtml(item.sku)}</strong><span>${escapeHtml(item.product_name)}</span>`;$('#reportShortage').disabled=false;$('#skuResults').innerHTML='';}''')
s=s.replace("    $('#stockHint').innerHTML = '';\n",'')

catalog=r'''async function renderSku(){
 const can=elevated();$('#content').innerHTML=`<div class="heading"><div><p class="eyebrow">CATALOG</p><h2>Danh mục SKU / tên hàng</h2></div></div><article class="card"><p class="muted">Chỉ lưu <b>SKU và tên sản phẩm</b>; không lưu số tồn, bin, số lượng chờ xuất hoặc vị trí.</p>${can?`<input id="catalogFile" type="file" accept=".xlsx"><button id="replaceCatalog" class="primary">CẬP NHẬT TỪ FILE TỒN BIN</button><div id="catalogMsg" class="message" hidden></div>`:''}<label>Tìm SKU / tên hàng<input id="catalogSearch" placeholder="Nhập SKU hoặc tên sản phẩm"></label><button id="catalogSearchBtn" class="secondary">TÌM</button><div id="catalogRows"></div></article>`;
 const load=async()=>{try{const q=$('#catalogSearch').value.trim();if(!q){$('#catalogRows').innerHTML='<p class="muted">Nhập từ khóa để tra cứu.</p>';return;}const d=await api('search-skus',{query:q,limit:100});$('#catalogRows').innerHTML=`<div class="table-wrap"><table><thead><tr><th>SKU</th><th>Tên sản phẩm</th></tr></thead><tbody>${d.items.map(i=>`<tr><td><b>${escapeHtml(i.sku)}</b></td><td>${escapeHtml(i.product_name)}</td></tr>`).join('')}</tbody></table></div>`;}catch(e){$('#catalogRows').innerHTML=`<div class="message" data-type="error">${escapeHtml(safeMessage(e))}</div>`;}};$('#catalogSearchBtn').onclick=load;$('#catalogSearch').addEventListener('keydown',e=>{if(e.key==='Enter')load();});
 if(can)$('#replaceCatalog').onclick=async()=>{const f=$('#catalogFile').files?.[0];if(!f)return message('#catalogMsg','Chọn file XLSX trước.','error');if(f.size>MAX_FILE_BYTES)return message('#catalogMsg','File vượt giới hạn 20 MB.','error');try{setBusy(true,'Đang đọc SKU và tên sản phẩm…');const X=await getExcelJS(),wb=new X.Workbook();await wb.xlsx.load(await f.arrayBuffer());const sh=wb.worksheets[0];if(!sh)throw new Error('File không có worksheet.');const h=new Map();sh.getRow(1).eachCell((c,col)=>h.set(normalize(c.text),col));const find=a=>a.map(normalize).map(x=>h.get(x)).find(Boolean),sc=find(['sku','mã sku','ma sku']),nc=find(['tên sku','ten sku','tên sản phẩm','ten san pham','tên hàng','ten hang','product name','sku name']);if(!sc||!nc)throw new Error('File phải có cột SKU và Tên SKU/Tên sản phẩm.');const m=new Map();for(let r=2;r<=sh.rowCount;r++){const sku=String(sh.getRow(r).getCell(sc).text||'').trim(),name=String(sh.getRow(r).getCell(nc).text||'').trim();if(!sku&&!name)continue;if(!sku||!name)throw new Error(`Dòng ${r}: thiếu SKU hoặc tên sản phẩm`);if(m.has(sku)&&m.get(sku)!==name)throw new Error(`SKU ${sku} có nhiều tên khác nhau`);m.set(sku,name);}if(!m.size)throw new Error('Không tìm thấy SKU hợp lệ.');const items=[...m].map(([sku,product_name])=>({sku,product_name})),res=await api('replace-catalog',{items,source_name:f.name});message('#catalogMsg',`Đã cập nhật ${Number(res.active_count||items.length).toLocaleString('vi-VN')} SKU · phiên ${res.revision}.`,'good');}catch(e){message('#catalogMsg',safeMessage(e),'error');}finally{setBusy(false);}};
}'''
try:s=replfn(s,'renderSku',catalog)
except SystemExit:s+='\n'+catalog+'\n'
try:s=replfn(s,'renderInventory','async function renderInventory(){return renderSku();}')
except SystemExit:pass

s=replfn(s,'renderIntegrations',r'''async function renderIntegrations(){
 $('#content').innerHTML=`<div class="heading"><div><p class="eyebrow">SYSTEM</p><h2>Hệ thống & dung lượng</h2></div></div><div id="serviceBody"></div>`;try{const d=await api('service-metrics'),u=d.usage||{},l=d.free_limits||{},db=Number(u.database_bytes||0),lim=Number(l.database_bytes||1);$('#serviceBody').innerHTML=`<div class="metrics"><article class="metric"><span>Database</span><strong>${(db/1048576).toFixed(1)} MB</strong></article><article class="metric"><span>SKU hoạt động</span><strong>${Number(u.sku_active||0).toLocaleString('vi-VN')}</strong></article><article class="metric"><span>Nhân sự hoạt động</span><strong>${Number(u.profiles_active||0)}</strong></article><article class="metric"><span>Thiết bị FCM</span><strong>${Number(u.active_device_tokens||0)}</strong></article></div><div class="panel-grid"><article class="card"><h3>Ngưỡng kiểm soát 0 đồng</h3><p>Database: ${(db/lim*100).toFixed(1)}% / 500 MB</p><p>Storage: 1 GB · Edge Functions: 500.000 lượt/tháng · Realtime: 2.000.000 message/tháng · 200 kết nối đồng thời.</p><p class="muted">Thông tin dùng để cảnh báo vận hành; hệ thống không tự bật Billing.</p></article><article class="card"><h3>Dữ liệu kỹ thuật</h3><p>Notification events: ${Number(u.notification_events||0).toLocaleString('vi-VN')}</p><p>Diagnostic log: ${(Number(u.diagnostic_log_bytes||0)/1048576).toFixed(2)} MB</p><p>Google Sheet chờ: ${Number(u.sheet_pending||0)}</p><p>Catalog revision: ${Number(u.catalog_revision||0)}</p></article></div>`;}catch(e){$('#serviceBody').innerHTML=`<div class="message" data-type="error">${escapeHtml(safeMessage(e))}</div>`;}
}''')

s=replfn(s,'renderUsers',r'''async function renderUsers(){
 $('#content').innerHTML=`<div class="heading"><div><p class="eyebrow">STAFF</p><h2>Nhân sự & quyền</h2></div><button id="staffSync" class="secondary">ĐỒNG BỘ NGUỒN NGAY</button></div><div id="staffStatus"></div><div id="usersBody"></div>`;
 const load=async()=>{try{const [d,st]=await Promise.all([api('list-users'),api('staff-sync-status')]);state.managedUsers=d.users||[];const last=st.runs?.[0];$('#staffStatus').innerHTML=`<article class="card"><b>Nguồn DANH MỤC NHÂN SỰ</b><p>${last?`${escapeHtml(last.status)} · ${formatTime(last.finished_at)} · ${Number(last.eligible_rows||0)} nhân sự hợp lệ`:'Chưa đồng bộ.'}</p><p class="muted">Site 1291 / Kho HY1. Chuyên viên, Trưởng nhóm, Trưởng kho → Admin Event; còn lại → Picker. 6281280 được bảo vệ tuyệt đối. Nhân sự mất khỏi nguồn chỉ ngừng hoạt động, lịch sử vẫn giữ.</p></article>`;$('#usersBody').innerHTML=`<div class="table-wrap"><table><thead><tr><th>User</th><th>Họ tên</th><th>Vị trí</th><th>Quyền</th><th>Nguồn</th><th>Trạng thái</th></tr></thead><tbody>${state.managedUsers.map(u=>`<tr><td><b>${escapeHtml(u.employee_code)}</b>${u.protected_account?' 🔒':''}</td><td>${escapeHtml(u.full_name)}</td><td>${escapeHtml(u.source_position||'—')}</td><td>${escapeHtml(ROLES[u.role]||u.role)}</td><td>${u.source_kind==='GSHEET'?'Google Sheet':'Tạo thêm'}</td><td>${u.active?'Hoạt động':'Ngừng'}</td></tr>`).join('')}</tbody></table></div><article class="card"><h3>Tạo thêm tài khoản ngoài danh sách nguồn</h3><p class="muted">${role()==='ADMIN_INVENT'?'Admin Event chỉ được tạo thêm Picker.':'Admin hệ thống được tạo Admin Event, Người báo hàng hoặc Picker.'} Nếu bỏ trống mật khẩu, server dùng mật khẩu mặc định lưu an toàn.</p><div class="form-grid"><label>Mã nhân viên<input id="newCode"></label><label>Họ tên<input id="newName"></label><label>Nhà thầu<input id="newContractor"></label><label>Quyền<select id="newRole">${(role()==='ADMIN'?['ADMIN_INVENT','INVENT','PICKER']:['PICKER']).map(r=>`<option value="${r}">${ROLES[r]}</option>`).join('')}</select></label><label>Mật khẩu riêng (không bắt buộc)<input id="newPassword" type="password" autocomplete="new-password"></label></div><button id="createExtraUser" class="primary">TẠO TÀI KHOẢN</button><div id="userMsg" class="message" hidden></div></article>`;$('#createExtraUser').onclick=async()=>{try{const item={employee_code:$('#newCode').value.trim(),full_name:$('#newName').value.trim(),contractor:$('#newContractor').value.trim(),role:$('#newRole').value,active:true,initial_password:$('#newPassword').value},r=await api('import-users',{items:[item]});if(r.failed)throw new Error(r.errors?.[0]||'Không tạo được tài khoản');message('#userMsg','Đã tạo tài khoản.','good');await load();}catch(e){message('#userMsg',safeMessage(e),'error');}};}catch(e){$('#usersBody').innerHTML=`<div class="message" data-type="error">${escapeHtml(safeMessage(e))}</div>`;}};
 $('#staffSync').onclick=async()=>{try{setBusy(true,'Đang đồng bộ DANH MỤC NHÂN SỰ…');const r=await api('staff-sync-now');alert(`Đồng bộ ${r.status}: tạo ${r.created||0}, cập nhật ${r.updated||0}, ngừng ${r.deactivated||0}, lỗi ${r.failed||0}.`);await load();}catch(e){alert(safeMessage(e));}finally{setBusy(false);}};load();
}''')

s=replfn(s,'renderSla',r'''async function renderSla(){
 $('#content').innerHTML=`<div class="heading"><div><p class="eyebrow">SLA</p><h2>Mốc thời gian vận hành</h2></div></div><div id="slaBody"></div>`;try{const c=await api('get-operational-config');$('#slaBody').innerHTML=`<article class="card"><div class="form-grid"><label>Thời gian nhận xử lý (phút)<input id="ackMin" type="number" min="1" max="480" value="${c.acknowledge_minutes}"><small>Từ lúc Picker báo đến khi Người báo hàng nhận xử lý.</small></label><label>Chu kỳ nhắc xử lý (phút)<input id="reminderMin" type="number" min="1" max="480" value="${c.reminder_minutes}"><small>Khoảng cách giữa các lần nhắc khi ticket còn mở.</small></label><label>Thời gian châm hàng (phút)<input id="replenishMin" type="number" min="1" max="480" value="${c.replenish_minutes}"><small>Mốc theo dõi sau khi đã nhận ticket.</small></label><label>Nhắc Picker xác nhận (phút)<input id="pickerAckMin" type="number" min="1" max="60" value="${c.picker_ack_reminder_minutes}"><small>Chỉ cho cảnh báo ĐÃ CÓ HÀNG hoặc CHO PHÉP SKIP.</small></label><label class="check"><input id="autoSkipEnabled" type="checkbox" ${c.auto_skip_enabled?'checked':''}> Tự động cho phép SKIP khi quá thời gian</label><label>Mốc tự động SKIP (phút)<input id="autoSkipAfter" type="number" min="15" max="4320" value="${c.auto_skip_after_minutes||120}"><small>120 phút = 2 giờ. Có thể tắt hoàn toàn.</small></label></div><button id="saveSla" class="primary">LƯU MỐC THỜI GIAN</button><div id="slaMsg" class="message" hidden></div></article>`;$('#saveSla').onclick=async()=>{try{await api('save-operational-config',{acknowledge_minutes:Number($('#ackMin').value),reminder_minutes:Number($('#reminderMin').value),replenish_minutes:Number($('#replenishMin').value),picker_ack_reminder_minutes:Number($('#pickerAckMin').value),auto_skip_enabled:$('#autoSkipEnabled').checked,auto_skip_after_minutes:Number($('#autoSkipAfter').value)});message('#slaMsg','Đã lưu cấu hình vận hành.','good');}catch(e){message('#slaMsg',safeMessage(e),'error');}};}catch(e){$('#slaBody').innerHTML=`<div class="message" data-type="error">${escapeHtml(safeMessage(e))}</div>`;}
}''')

s=replfn(s,'renderConfig',r'''async function renderConfig(){
 $('#content').innerHTML=`<div class="heading"><div><p class="eyebrow">CONFIG</p><h2>Cấu hình hệ thống</h2></div></div><div id="configBody"></div>`;try{const c=await api('get-config');$('#configBody').innerHTML=`<article class="card"><div class="form-grid"><label>Lưu lịch sử nghiệp vụ (ngày)<input id="retentionDays" type="number" min="7" max="365" value="${c.retention_days}"><small>Giữ ticket/audit theo chu kỳ, không phụ thuộc trạng thái nhân sự.</small></label><label>Lưu log chẩn đoán (ngày)<input id="logDays" type="number" min="1" max="60" value="${c.diagnostic_log_retention_days}"><small>Log cũ tự xóa để kiểm soát dung lượng.</small></label><label class="check"><input id="staffAuto" type="checkbox" ${c.staff_auto_sync_enabled?'checked':''}> Tự động đồng bộ DANH MỤC NHÂN SỰ</label><label>Chu kỳ đồng bộ nhân sự (phút)<input id="staffInterval" type="number" min="15" max="1440" value="${c.staff_sync_interval_minutes||60}"><small>Khuyến nghị 60 phút để giảm network/quota.</small></label><label class="check"><input id="cfgAutoSkip" type="checkbox" ${c.auto_skip_enabled?'checked':''}> Bật tự động cho phép SKIP</label><label>Mốc tự động SKIP (phút)<input id="cfgAutoSkipAfter" type="number" min="15" max="4320" value="${c.auto_skip_after_minutes||120}"></label></div><button id="saveConfig" class="primary">LƯU CẤU HÌNH</button><div id="configMsg" class="message" hidden></div></article>`;$('#saveConfig').onclick=async()=>{try{await api('save-config',{...c,retention_days:Number($('#retentionDays').value),diagnostic_log_retention_days:Number($('#logDays').value),staff_auto_sync_enabled:$('#staffAuto').checked,staff_sync_interval_minutes:Number($('#staffInterval').value),auto_skip_enabled:$('#cfgAutoSkip').checked,auto_skip_after_minutes:Number($('#cfgAutoSkipAfter').value)});message('#configMsg','Đã lưu cấu hình hệ thống.','good');}catch(e){message('#configMsg',safeMessage(e),'error');}};}catch(e){$('#configBody').innerHTML=`<div class="message" data-type="error">${escapeHtml(safeMessage(e))}</div>`;}
}''')

s=replfn(s,'renderReports',r'''async function renderReports(){
 $('#content').innerHTML=`<div class="heading"><div><p class="eyebrow">REPORT</p><h2>Báo cáo vận hành kho</h2></div></div><div id="reportBody"></div>`;try{const r=await api('reports-summary');$('#reportBody').innerHTML=`<div class="metrics"><article class="metric"><span>Lượt báo 30 ngày</span><strong>${Number(r.reports||0).toLocaleString('vi-VN')}</strong></article><article class="metric"><span>Ticket 30 ngày</span><strong>${Number(r.issues||0).toLocaleString('vi-VN')}</strong></article><article class="metric"><span>Đang mở</span><strong>${Number(r.active_now||0)}</strong></article><article class="metric"><span>Quá mốc phản hồi</span><strong>${Number(r.overdue_now||0)}</strong></article><article class="metric"><span>Trung vị nhận</span><strong>${r.median_claim_minutes??'—'} phút</strong></article><article class="metric"><span>P95 hoàn tất</span><strong>${r.p95_resolution_minutes??'—'} phút</strong></article></div><div class="panel-grid"><article class="card"><h3>24 giờ gần nhất</h3><p>Lượt báo: <b>${Number(r.last_24h?.reports||0)}</b> · Ticket: <b>${Number(r.last_24h?.issues||0)}</b> · Hoàn tất: <b>${Number(r.last_24h?.resolved||0)}</b></p><p>Có hàng/châm bù: <b>${Number(r.last_24h?.available||0)}</b> · Cho SKIP: <b>${Number(r.last_24h?.skipped||0)}</b></p></article><article class="card"><h3>Chất lượng xử lý</h3><p>Trung vị hoàn tất: <b>${r.median_resolution_minutes??'—'} phút</b> · P95: <b>${r.p95_resolution_minutes??'—'} phút</b></p><p>Tái phát: <b>${Number(r.recurrent_episodes||0)}</b> · Auto SKIP 30 ngày: <b>${Number(r.auto_skip_count_30d||0)}</b></p></article></div><article class="card"><h3>SKU phát sinh nhiều nhất</h3><div class="table-wrap"><table><thead><tr><th>SKU</th><th>Tên sản phẩm</th><th>Lượt báo</th></tr></thead><tbody>${(r.top_skus||[]).map(x=>`<tr><td><b>${escapeHtml(x.sku)}</b></td><td>${escapeHtml(x.product_name||'')}</td><td>${Number(x.reports||0)}</td></tr>`).join('')}</tbody></table></div></article>`;}catch(e){$('#reportBody').innerHTML=`<div class="message" data-type="error">${escapeHtml(safeMessage(e))}</div>`;}
}''')
write(p,s)

p=Path('firebase.json');s=read(p);s=s.replace(' https://api-supra.winmart.vn','');s=re.sub(r'\n\s*\{\n\s*"source": "/browser-supra-poc\\.js",\n\s*"headers": \[\n\s*\{ "key": "Cache-Control", "value": "no-store" \}\n\s*\]\n\s*\},?','',s);write(p,s)
Path('.github/workflows/provision-supra-master-key.yml').unlink(missing_ok=True)
print('WEB_PATCH_OK')
