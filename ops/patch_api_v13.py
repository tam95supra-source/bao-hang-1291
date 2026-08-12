from pathlib import Path
import re

ROOT=Path('.')
def read(p): return (ROOT/p).read_text(encoding='utf-8')
def write(p,s): (ROOT/p).write_text(s,encoding='utf-8')
def once(s,old,new,label):
    if s.count(old)!=1: raise SystemExit(f'{label}: expected 1 anchor, got {s.count(old)}')
    return s.replace(old,new,1)
def between(s,start,end,new,label):
    i=s.find(start); j=s.find(end,i+len(start)) if i>=0 else -1
    if i<0 or j<0: raise SystemExit(f'{label}: anchors missing')
    return s[:i]+new+s[j:]
def brace_end(s,open_idx):
    depth=0; quote=None; esc=False; line=False; block=False; i=open_idx
    while i<len(s):
        c=s[i]; n=s[i+1] if i+1<len(s) else ''
        if line:
            if c=='\n': line=False
            i+=1; continue
        if block:
            if c=='*' and n=='/': block=False; i+=2; continue
            i+=1; continue
        if quote:
            if esc: esc=False
            elif c=='\\': esc=True
            elif c==quote: quote=None
            i+=1; continue
        if c=='/' and n=='/': line=True; i+=2; continue
        if c=='/' and n=='*': block=True; i+=2; continue
        if c in ("'",'"','`'): quote=c; i+=1; continue
        if c=='{': depth+=1
        elif c=='}':
            depth-=1
            if depth==0: return i+1
        i+=1
    raise SystemExit('unbalanced braces')
def replace_function(s,name,new):
    pats=[f'async function {name}(',f'function {name}(']
    starts=[s.find(p) for p in pats if s.find(p)>=0]
    if not starts: raise SystemExit(f'function not found: {name}')
    start=min(starts); op=s.find('{',start); end=brace_end(s,op)
    return s[:start]+new+s[end:]

p=Path('supabase/functions/api/index.ts'); s=read(p)
s=once(s,'const SITE_ID = "1291";','const SITE_ID = "1291";\nconst PROTECTED_ADMIN_CODE = "6281280";\nconst STAFF_SHEET_ID = "1FRROqCp1lmkuHc3lc4UBpVI5_ZrtiPI1thlEymv458E";\nconst STAFF_SHEET_NAME = "DANH MỤC NHÂN SỰ";','constants')
s=once(s,'type Profile = { id: string; employee_code: string; full_name: string; contractor: string; role: Role; active: boolean };','type Profile = { id: string; employee_code: string; full_name: string; contractor: string; role: Role; active: boolean; source_kind?: string; source_position?: string; protected_account?: boolean };','profile type')
s=s.replace('AVAILABLE: `Đã có hàng • SKU ${issue.sku}`','AVAILABLE: `ĐÃ CÓ HÀNG • SKU ${issue.sku}`')
s=s.replace('SKIP_ALLOWED: `Được phép SKIP • SKU ${issue.sku}`','SKIP_ALLOWED: `CHO PHÉP SKIP • SKU ${issue.sku}`')
s=s.replace('AVAILABLE: `SKU ${data.sku} đã có hàng/châm bù. Vui lòng quay lại vị trí lấy hàng.`,','AVAILABLE: `SKU ${data.sku} đã được bổ sung hàng. Vui lòng quay lại vị trí lấy hàng và tiếp tục thao tác.`,')
s=s.replace('SKIP_ALLOWED: `Không tìm thấy SKU ${data.sku}. Bạn được phép SKIP SKU này.`,','SKIP_ALLOWED: `Không tìm thấy hàng để bổ sung cho SKU ${data.sku}. Bạn được phép SKIP SKU này và tiếp tục công việc.`,')

s=replace_function(s,'importUsers',r'''async function importUsers(context: Context, items: Record<string, unknown>[]) {
  requireRole(context, ["ADMIN", "ADMIN_INVENT"]);
  let created = 0, updated = 0;
  const errors: string[] = [];
  for (const [index, item] of items.entries()) {
    try {
      const code = required(item.employee_code, "Mã nhân viên").trim();
      if (code === PROTECTED_ADMIN_CODE) throw new Error("Tài khoản quản trị cao nhất được bảo vệ");
      const role = String(item.role ?? "PICKER").trim().toUpperCase() as Role;
      const allowed = context.effectiveRole === "ADMIN" ? new Set<Role>(["ADMIN_INVENT","INVENT","PICKER"]) : new Set<Role>(["PICKER"]);
      if (!allowed.has(role)) throw new Error(context.effectiveRole === "ADMIN" ? "Admin hệ thống chỉ tạo thêm Admin Event, Người báo hàng hoặc Picker" : "Admin Event chỉ được tạo thêm Picker / Người lấy hàng");
      const { data: existing, error: existingError } = await admin.from("profiles").select("id,role,source_kind,protected_account").ilike("employee_code", code).maybeSingle();
      if (existingError) throw existingError;
      if (existing?.protected_account || existing?.role === "ADMIN") throw new Error("Tài khoản quản trị cao nhất được bảo vệ");
      if (existing?.source_kind === "GSHEET") throw new Error("Nhân sự đồng bộ từ Google Sheet chỉ được cập nhật từ nguồn");
      const profile = { employee_code:code, full_name:required(item.full_name,"Họ tên"), contractor:String(item.contractor??""), role,
        active:item.active===undefined?true:Boolean(item.active), source_kind:"MANUAL", source_position:"", source_last_seen_at:null, protected_account:false, updated_at:new Date().toISOString() };
      if (existing) {
        const { error } = await admin.from("profiles").update(profile).eq("id", existing.id); if (error) throw error; updated++;
      } else {
        let password=String(item.initial_password??"").trim();
        if(!password){const {data,error}=await admin.rpc("get_staff_default_password_service");if(error)throw error;password=String(data??"");}
        if(password.length<8) throw new Error("Mật khẩu khởi tạo không hợp lệ");
        const {data,error}=await admin.auth.admin.createUser({email:employeeEmail(code),password,email_confirm:true});
        if(error||!data.user)throw error??new Error("Không tạo được tài khoản");
        const {error:insertError}=await admin.from("profiles").insert({id:data.user.id,...profile});if(insertError)throw insertError;created++;
      }
      await admin.from("sheet_export_queue").insert({event_type:"USER_UPSERT",payload:profile});
    } catch(error){errors.push(`Dòng ${index+1}: ${errorText(error)}`);}
  }
  return {created,updated,failed:errors.length,errors:errors.slice(0,30)};
}''')

s=replace_function(s,'listUsers',r'''async function listUsers(context: Context) {
  requireRole(context, ["ADMIN", "ADMIN_INVENT"]);
  let query=admin.from("profiles").select("id,employee_code,full_name,contractor,role,active,source_kind,source_position,source_last_seen_at,protected_account",{count:"exact"}).order("employee_code").limit(5000);
  if(context.effectiveRole==="ADMIN_INVENT") query=query.neq("role","ADMIN");
  const {data,error,count}=await query;if(error)throw error;
  if((count??0)>5000)throw new HttpError(409,"Số nhân sự vượt giới hạn 5000 tài khoản");
  return {users:data??[],count:count??0};
}''')

s=replace_function(s,'updateManagedUser',r'''async function updateManagedUser(context: Context, body: Record<string, unknown>) {
  requireRole(context,["ADMIN","ADMIN_INVENT"]);
  const targetId=required(body.id,"User ID");
  const {data:target,error:targetError}=await admin.from("profiles").select("id,employee_code,full_name,contractor,role,active,source_kind,source_position,protected_account").eq("id",targetId).single();
  if(targetError||!target)throw new HttpError(404,"Không tìm thấy tài khoản");
  if(target.protected_account||target.employee_code===PROTECTED_ADMIN_CODE||target.role==="ADMIN")throw new HttpError(409,"ADMIN_PROTECTED");
  if(target.source_kind==="GSHEET")throw new HttpError(409,"SOURCE_MANAGED_USER");
  if(context.effectiveRole==="ADMIN_INVENT"&&target.role!=="PICKER")throw new HttpError(403,"Admin Event chỉ được quản lý Picker tạo thêm ngoài danh sách nguồn");
  const employeeCode=required(body.employee_code,"Mã nhân viên"),fullName=required(body.full_name,"Họ tên"),contractor=String(body.contractor??"").trim();
  const role=String(body.role??target.role).trim().toUpperCase() as Role,active=typeof body.active==="boolean"?body.active:Boolean(target.active),newPassword=String(body.new_password??"");
  if(!["ADMIN_INVENT","INVENT","PICKER"].includes(role))throw new HttpError(400,"Quyền không hợp lệ");
  if(context.effectiveRole==="ADMIN_INVENT"&&role!=="PICKER")throw new HttpError(403,"Admin Event chỉ được quản lý Picker");
  if(newPassword&&newPassword.length<8)throw new HttpError(400,"Mật khẩu mới cần ít nhất 8 ký tự");
  if(employeeCode===PROTECTED_ADMIN_CODE)throw new HttpError(409,"ADMIN_PROTECTED");
  if(employeeCode.toLowerCase()!==String(target.employee_code).toLowerCase()){
    const {data:duplicate,error}=await admin.from("profiles").select("id").ilike("employee_code",employeeCode).neq("id",targetId).maybeSingle();if(error)throw error;if(duplicate)throw new HttpError(409,"Mã nhân viên đã tồn tại");
  }
  const values={employee_code:employeeCode,full_name:fullName,contractor,role,active,source_kind:"MANUAL",updated_at:new Date().toISOString()};
  const {data:updated,error:updateError}=await admin.from("profiles").update(values).eq("id",targetId).select("id,employee_code,full_name,contractor,role,active,source_kind,source_position,source_last_seen_at,protected_account").single();
  if(updateError||!updated)throw updateError??new Error("Không cập nhật được hồ sơ");
  const authValues:{email?:string;password?:string}={};if(employeeCode.toLowerCase()!==String(target.employee_code).toLowerCase())authValues.email=employeeEmail(employeeCode);if(newPassword)authValues.password=newPassword;
  if(Object.keys(authValues).length){const {error}=await admin.auth.admin.updateUserById(targetId,authValues);if(error)throw error;}
  await admin.from("sheet_export_queue").insert({event_type:"USER_UPSERT",payload:values});return {profile:updated};
}''')

helpers=r'''function parseCsv(text: string): string[][] {
  const rows:string[][]=[];let row:string[]=[],cell="",quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i],n=text[i+1];if(quoted){if(c==='"'&&n==='"'){cell+='"';i++;}else if(c==='"')quoted=false;else cell+=c;continue;}if(c==='"')quoted=true;else if(c===','){row.push(cell);cell="";}else if(c==='\n'){row.push(cell.replace(/\r$/,""));rows.push(row);row=[];cell="";}else cell+=c;}
  if(cell.length||row.length){row.push(cell.replace(/\r$/,""));rows.push(row);}return rows;
}
function staffRole(position:string,employeeCode:string):Role{if(employeeCode===PROTECTED_ADMIN_CODE)return "ADMIN";return ["chuyen vien","truong nhom","truong kho"].includes(normalizeSearch(position))?"ADMIN_INVENT":"PICKER";}
async function staffDefaultPassword():Promise<string>{const {data,error}=await admin.rpc("get_staff_default_password_service");if(error)throw error;const v=String(data??"");if(v.length<8)throw new HttpError(503,"Mật khẩu mặc định nhân sự chưa được cấu hình an toàn");return v;}
async function staffSyncDue():Promise<boolean>{const {data:cfg,error}=await admin.from("app_config").select("staff_auto_sync_enabled,staff_sync_interval_minutes").eq("singleton",true).single();if(error)throw error;if(!cfg.staff_auto_sync_enabled)return false;const {data:last,error:e}=await admin.from("staff_sync_runs").select("finished_at").in("status",["SUCCEEDED","NO_CHANGE"]).order("finished_at",{ascending:false}).limit(1).maybeSingle();if(e)throw e;if(!last?.finished_at)return true;return Date.now()-new Date(last.finished_at).getTime()>=Math.max(15,Number(cfg.staff_sync_interval_minutes??60))*60000;}
async function syncStaffDirectory(triggerSource:"AUTO"|"MANUAL"|"DEPLOY",actorId:string|null=null){
  const {data:running}=await admin.from("staff_sync_runs").select("id,started_at").eq("status","RUNNING").gte("started_at",new Date(Date.now()-15*60000).toISOString()).limit(1).maybeSingle();if(running)return {status:"RUNNING",run_id:running.id,reused:true};
  const {data:run,error:runError}=await admin.from("staff_sync_runs").insert({trigger_source:triggerSource,source_sheet_id:STAFF_SHEET_ID,requested_by:actorId}).select().single();if(runError||!run)throw runError??new Error("Không tạo được phiên đồng bộ nhân sự");
  try{
    const url=`https://docs.google.com/spreadsheets/d/${STAFF_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(STAFF_SHEET_NAME)}`;const response=await fetch(url,{headers:{accept:"text/csv"},redirect:"follow"});if(!response.ok)throw new Error(`Google Sheet HTTP ${response.status}`);const text=await response.text();if(!text||text.length>5000000)throw new Error("Dữ liệu DANH MỤC NHÂN SỰ rỗng hoặc vượt giới hạn an toàn");
    const rows=parseCsv(text);if(rows.length<2)throw new Error("DANH MỤC NHÂN SỰ không có dữ liệu");const headers=rows[0].map(normalizeSearch);const col=(...names:string[])=>{const a=names.map(normalizeSearch);const i=headers.findIndex(h=>a.includes(h));if(i<0)throw new Error(`Thiếu cột ${names[0]}`);return i;};
    const cCode=col("Mã nhân viên"),cName=col("Họ tên"),cContractor=col("Nhà thầu"),cPosition=col("Vị trí chính"),cSite=col("Site"),cWarehouse=col("Kho");const byCode=new Map<string,{employee_code:string;full_name:string;contractor:string;source_position:string;role:Role}>();
    for(const row of rows.slice(1)){const code=String(row[cCode]??"").trim(),full_name=String(row[cName]??"").trim();if(!code||!full_name)continue;if(String(row[cSite]??"").trim()!=="1291"||String(row[cWarehouse]??"").trim().toUpperCase()!=="HY1")continue;const source_position=String(row[cPosition]??"").trim();byCode.set(code,{employee_code:code,full_name,contractor:String(row[cContractor]??"").trim(),source_position,role:staffRole(source_position,code)});}
    if(!byCode.size)throw new Error("Không có nhân sự Site 1291 / Kho HY1 trong nguồn");const canonical=[...byCode.values()].sort((a,b)=>a.employee_code.localeCompare(b.employee_code)).map(x=>`${x.employee_code}|${x.full_name}|${x.contractor}|${x.source_position}|${x.role}`).join("\n");const sourceHash=await sha256(canonical);
    const {data:last}=await admin.from("staff_sync_runs").select("source_hash").in("status",["SUCCEEDED","NO_CHANGE"]).order("finished_at",{ascending:false}).limit(1).maybeSingle();if(triggerSource==="AUTO"&&last?.source_hash===sourceHash){await admin.from("staff_sync_runs").update({status:"NO_CHANGE",source_hash:sourceHash,source_rows:Math.max(0,rows.length-1),eligible_rows:byCode.size,finished_at:new Date().toISOString()}).eq("id",run.id);return {status:"NO_CHANGE",run_id:run.id,eligible_rows:byCode.size};}
    const {data:profiles,error:profileError}=await admin.from("profiles").select("id,employee_code,full_name,contractor,role,active,source_kind,source_position,protected_account").limit(10000);if(profileError)throw profileError;const existing=new Map((profiles??[]).map((p:any)=>[String(p.employee_code).toLowerCase(),p]));const defaultPassword=await staffDefaultPassword();let created=0,updated=0,deactivated=0,failed=0;const failures:string[]=[],seen:string[]=[];
    for(const staff of byCode.values()){const key=staff.employee_code.toLowerCase();seen.push(key);try{const old:any=existing.get(key);if(staff.employee_code===PROTECTED_ADMIN_CODE){if(old){const values={full_name:staff.full_name,contractor:staff.contractor,role:"ADMIN",active:true,protected_account:true,source_position:staff.source_position,source_last_seen_at:new Date().toISOString(),updated_at:new Date().toISOString()};const {error}=await admin.from("profiles").update(values).eq("id",old.id);if(error)throw error;updated++;}continue;}const values={employee_code:staff.employee_code,full_name:staff.full_name,contractor:staff.contractor,role:staff.role,active:true,source_kind:"GSHEET",source_position:staff.source_position,source_last_seen_at:new Date().toISOString(),protected_account:false,updated_at:new Date().toISOString()};if(old){if(old.protected_account||old.role==="ADMIN")continue;const {error}=await admin.from("profiles").update(values).eq("id",old.id);if(error)throw error;updated++;await admin.from("sheet_export_queue").insert({event_type:"USER_UPSERT",payload:{id:old.id,...values}});}else{const {data,error}=await admin.auth.admin.createUser({email:employeeEmail(staff.employee_code),password:defaultPassword,email_confirm:true});if(error||!data.user)throw error??new Error("Không tạo được tài khoản");const {error:ie}=await admin.from("profiles").insert({id:data.user.id,...values});if(ie)throw ie;created++;await admin.from("sheet_export_queue").insert({event_type:"USER_UPSERT",payload:{id:data.user.id,...values}});}}catch(error){failed++;failures.push(`${staff.employee_code}: ${errorText(error)}`);}}
    if(failed===0){const missing=(profiles??[]).filter((p:any)=>p.source_kind==="GSHEET"&&!p.protected_account&&p.employee_code!==PROTECTED_ADMIN_CODE&&!seen.includes(String(p.employee_code).toLowerCase())&&p.active);for(const p of missing){const {error}=await admin.from("profiles").update({active:false,updated_at:new Date().toISOString()}).eq("id",p.id);if(error){failed++;failures.push(`${p.employee_code}: ${errorText(error)}`);continue;}deactivated++;await admin.from("sheet_export_queue").insert({event_type:"USER_UPSERT",payload:{id:p.id,employee_code:p.employee_code,full_name:p.full_name,contractor:p.contractor,role:p.role,active:false}});}}
    await admin.from("profiles").update({role:"ADMIN",active:true,protected_account:true}).eq("employee_code",PROTECTED_ADMIN_CODE);const status=failed?"PARTIAL":"SUCCEEDED";await admin.from("staff_sync_runs").update({status,source_hash:sourceHash,source_rows:Math.max(0,rows.length-1),eligible_rows:byCode.size,created_count:created,updated_count:updated,deactivated_count:deactivated,failed_count:failed,error_summary:failures.slice(0,20).join("; ").slice(0,3000),finished_at:new Date().toISOString()}).eq("id",run.id);await admin.schema("realtime").rpc("send",{payload:{run_id:run.id,status,created,updated,deactivated},event:"staff_changed",topic:"site:1291:staff",private:true}).catch(()=>{});return {status,run_id:run.id,eligible_rows:byCode.size,created,updated,deactivated,failed,errors:failures.slice(0,20)};
  }catch(error){await admin.from("staff_sync_runs").update({status:"FAILED",failed_count:1,error_summary:errorText(error).slice(0,3000),finished_at:new Date().toISOString()}).eq("id",run.id);throw error;}
}
async function staffSyncStatus(context:Context){requireRole(context,["ADMIN","ADMIN_INVENT"]);const {data,error}=await admin.from("staff_sync_runs").select("*").order("started_at",{ascending:false}).limit(10);if(error)throw error;return {runs:data??[],source_sheet_id:STAFF_SHEET_ID,source_sheet_name:STAFF_SHEET_NAME};}
async function replaceCatalog(context:Context,body:Record<string,unknown>){requireRole(context,["ADMIN","ADMIN_INVENT"]);const items=Array.isArray(body.items)?body.items as Record<string,unknown>[]:[];if(!items.length||items.length>10000)throw new HttpError(400,"File danh mục cần từ 1 đến 10.000 SKU");const clean=items.map(item=>({sku:required(item.sku,"SKU").trim(),product_name:required(item.product_name,"Tên sản phẩm").trim()}));const canonical=clean.slice().sort((a,b)=>a.sku.localeCompare(b.sku)).map(x=>`${x.sku}|${x.product_name}`).join("\n");const sourceSha=await sha256(canonical);const {data,error}=await admin.rpc("replace_sku_catalog_service",{p_items:clean,p_actor:context.userId,p_source_name:String(body.source_name??"Tồn Bin XLSX").slice(0,240),p_source_sha:sourceSha});if(error)throw error;return {...data,source_sha256:sourceSha};}
async function deleteManagedUser(context:Context,body:Record<string,unknown>){requireRole(context,["ADMIN","ADMIN_INVENT"]);const id=required(body.id,"User ID");const {data:t,error}=await admin.from("profiles").select("id,employee_code,full_name,contractor,role,active,source_kind,protected_account").eq("id",id).single();if(error||!t)throw new HttpError(404,"Không tìm thấy tài khoản");if(t.protected_account||t.employee_code===PROTECTED_ADMIN_CODE||t.role==="ADMIN")throw new HttpError(409,"ADMIN_PROTECTED");if(t.source_kind==="GSHEET")throw new HttpError(409,"SOURCE_MANAGED_USER");if(context.effectiveRole==="ADMIN_INVENT"&&t.role!=="PICKER")throw new HttpError(403,"Admin Event chỉ được quản lý Picker tạo thêm");const {error:ue}=await admin.from("profiles").update({active:false,updated_at:new Date().toISOString()}).eq("id",id);if(ue)throw ue;await admin.from("sheet_export_queue").insert({event_type:"USER_UPSERT",payload:{...t,active:false,updated_at:new Date().toISOString()}});return {deleted:true,soft_deleted:true,id};}
async function serviceMetrics(context:Context){requireRole(context,["ADMIN","ADMIN_INVENT"]);const [{data:usage,error},{data:lastStaff},{data:cfg}]=await Promise.all([admin.rpc("service_usage_snapshot"),admin.from("staff_sync_runs").select("status,finished_at,eligible_rows,failed_count").order("started_at",{ascending:false}).limit(1).maybeSingle(),admin.from("app_config").select("retention_days,diagnostic_log_retention_days,staff_auto_sync_enabled,staff_sync_interval_minutes,auto_skip_enabled,auto_skip_after_minutes").eq("singleton",true).single()]);if(error)throw error;return {usage,last_staff_sync:lastStaff??null,config:cfg??{},free_limits:{database_bytes:500*1024*1024,storage_bytes:1024*1024*1024,edge_invocations_month:500000,realtime_messages_month:2000000,realtime_peak_connections:200},cost_policy:{billing_enabled:false,paid_services_allowed:false,guard:"Firebase deploy chặn nếu billingEnabled=true"}};}
'''
s=between(s,'async function aesKey(): Promise<CryptoKey> {','async function route(req: Request) {',helpers+'\n\nasync function route(req: Request) {','retire supra inventory block')

s=replace_function(s,'slaTick',r'''async function slaTick(req: Request) {
  const expected=Deno.env.get("CRON_SECRET")??"";if(!expected||req.headers.get("x-cron-secret")!==expected)throw new HttpError(403,"Cron secret không đúng");
  const {data:events,error}=await admin.rpc("process_sla");if(error)throw error;for(const event of events??[]){const issue=(await issueRows([event.issue_id]))[0];if(issue)await notifyUsers(await inventUserIds(),issue,issue.status,`SKU ${issue.sku} đã vượt mốc thời gian vận hành; cần kiểm tra và phản hồi.`);}
  const {data:autoSkipped,error:autoSkipError}=await admin.rpc("auto_skip_overdue_service");if(autoSkipError)throw autoSkipError;for(const row of autoSkipped??[]){const issue=(await issueRows([row.issue_id]))[0];if(issue)await notifyUsers(await reporterIds(issue.id),issue,"SKIP_ALLOWED",`Không tìm thấy hàng để bổ sung cho SKU ${issue.sku} trong thời gian quy định. Bạn được phép SKIP SKU này và tiếp tục công việc.`,true);}
  await resendPendingCritical();if(await staffSyncDue().catch(()=>false)){try{await syncStaffDirectory("AUTO",null);}catch(error){console.warn("Staff sync deferred",errorText(error));}}try{await syncSheet();}catch(error){console.warn("Sheet sync deferred",errorText(error));}
  return {processed:events?.length??0,auto_skipped:autoSkipped?.length??0,critical_reminder_checked:true};
}''')

s=s.replace('let query = admin.from("sku_catalog").select("sku,product_name").limit','let query = admin.from("sku_catalog").select("sku,product_name").eq("active", true).limit')
old='''    case "sync-catalog": {
      const limit = Math.min(1000, Math.max(1, Number(body.limit ?? 1000)));
      const syncUntil = String(body.sync_until ?? new Date().toISOString());
      let query = admin.from("sku_catalog").select("sku,product_name,updated_at").lte("updated_at", syncUntil).order("sku").limit(limit);
      if (body.updated_since) query = query.gt("updated_at", String(body.updated_since));
      if (body.after_sku) query = query.gt("sku", String(body.after_sku));
      const { data, error } = await query;
      if (error) throw error;
      return { items: data ?? [], has_more: (data?.length ?? 0) === limit, sync_until: syncUntil };
    }'''
new='''    case "sync-catalog": {
      const limit=Math.min(1000,Math.max(1,Number(body.limit??1000))),syncUntil=String(body.sync_until??new Date().toISOString());
      const {data:cs,error:se}=await admin.from("catalog_state").select("revision").eq("singleton",true).single();if(se)throw se;
      let query=admin.from("sku_catalog").select("sku,product_name,updated_at").eq("active",true).lte("updated_at",syncUntil).order("sku").limit(limit);if(body.after_sku)query=query.gt("sku",String(body.after_sku));const {data,error}=await query;if(error)throw error;
      return {items:data??[],has_more:(data?.length??0)===limit,sync_until:syncUntil,catalog_revision:Number(cs.revision??1)};
    }'''
s=once(s,old,new,'sync catalog')
s=once(s,'const { data, error } = await admin.from("app_config").select("acknowledge_minutes,reminder_minutes,replenish_minutes,picker_ack_reminder_minutes").eq("singleton", true).single();','const { data, error } = await admin.from("app_config").select("acknowledge_minutes,reminder_minutes,replenish_minutes,picker_ack_reminder_minutes,auto_skip_enabled,auto_skip_after_minutes").eq("singleton", true).single();','op config get')
s=once(s,'        replenish_minutes: Number(body.replenish_minutes), picker_ack_reminder_minutes: Number(body.picker_ack_reminder_minutes ?? 3),\n        updated_by: context.userId, updated_at: new Date().toISOString(),','        replenish_minutes: Number(body.replenish_minutes), picker_ack_reminder_minutes: Number(body.picker_ack_reminder_minutes ?? 3),\n        auto_skip_enabled: Boolean(body.auto_skip_enabled), auto_skip_after_minutes: Number(body.auto_skip_after_minutes ?? 120),\n        updated_by: context.userId, updated_at: new Date().toISOString(),','op values')
s=once(s,'      if (!Number.isInteger(values.picker_ack_reminder_minutes) || values.picker_ack_reminder_minutes < 1 || values.picker_ack_reminder_minutes > 60) throw new HttpError(400, "Nhắc Picker phải từ 1 đến 60 phút");','      if (!Number.isInteger(values.picker_ack_reminder_minutes) || values.picker_ack_reminder_minutes < 1 || values.picker_ack_reminder_minutes > 60) throw new HttpError(400, "Nhắc Picker phải từ 1 đến 60 phút");\n      if (!Number.isInteger(values.auto_skip_after_minutes) || values.auto_skip_after_minutes < 15 || values.auto_skip_after_minutes > 4320) throw new HttpError(400, "Mốc tự động cho phép SKIP phải từ 15 phút đến 72 giờ");','op validation')
s=s.replace('.select("acknowledge_minutes,reminder_minutes,replenish_minutes,picker_ack_reminder_minutes").single();','.select("acknowledge_minutes,reminder_minutes,replenish_minutes,picker_ack_reminder_minutes,auto_skip_enabled,auto_skip_after_minutes").single();',1)
old_sys='''        acknowledge_minutes: Number(body.acknowledge_minutes), reminder_minutes: Number(body.reminder_minutes), replenish_minutes: Number(body.replenish_minutes),
        picker_ack_reminder_minutes: Number(body.picker_ack_reminder_minutes ?? 3), diagnostic_log_retention_days: Number(body.diagnostic_log_retention_days ?? 14),
        retention_days: Number(body.retention_days ?? 60), inventory_auto_sync_enabled: Boolean(body.inventory_auto_sync_enabled),
        inventory_sync_interval_minutes: Number(body.inventory_sync_interval_minutes ?? 10), inventory_operating_start_hour: Number(body.inventory_operating_start_hour ?? 0),
        inventory_operating_end_hour: Number(body.inventory_operating_end_hour ?? 23), inventory_fresh_minutes: Number(body.inventory_fresh_minutes ?? 10), inventory_stale_minutes: Number(body.inventory_stale_minutes ?? 30),
        updated_by: context.userId, updated_at: new Date().toISOString(),'''
new_sys='''        acknowledge_minutes: Number(body.acknowledge_minutes), reminder_minutes: Number(body.reminder_minutes), replenish_minutes: Number(body.replenish_minutes),
        picker_ack_reminder_minutes: Number(body.picker_ack_reminder_minutes ?? 3), diagnostic_log_retention_days: Number(body.diagnostic_log_retention_days ?? 14),
        retention_days: Number(body.retention_days ?? 60), auto_skip_enabled: Boolean(body.auto_skip_enabled), auto_skip_after_minutes: Number(body.auto_skip_after_minutes ?? 120),
        staff_auto_sync_enabled: Boolean(body.staff_auto_sync_enabled ?? true), staff_sync_interval_minutes: Number(body.staff_sync_interval_minutes ?? 60),
        updated_by: context.userId, updated_at: new Date().toISOString(),'''
s=once(s,old_sys,new_sys,'system values')
s=s.replace('      if (!Number.isInteger(values.inventory_sync_interval_minutes) || Number(values.inventory_sync_interval_minutes) < 10 || Number(values.inventory_sync_interval_minutes) > 120) throw new HttpError(400, "Chu kỳ tồn bin phải từ 10 đến 120 phút");\n      if (Number(values.inventory_fresh_minutes) >= Number(values.inventory_stale_minutes)) throw new HttpError(400, "Ngưỡng stale phải lớn hơn ngưỡng fresh");\n','      if (!Number.isInteger(values.auto_skip_after_minutes) || Number(values.auto_skip_after_minutes) < 15 || Number(values.auto_skip_after_minutes) > 4320) throw new HttpError(400, "Mốc tự động SKIP phải từ 15 phút đến 72 giờ");\n      if (!Number.isInteger(values.staff_sync_interval_minutes) || Number(values.staff_sync_interval_minutes) < 15 || Number(values.staff_sync_interval_minutes) > 1440) throw new HttpError(400, "Chu kỳ đồng bộ nhân sự phải từ 15 phút đến 24 giờ");\n')
s=s.replace('product_name: required(item.product_name, "Tên sản phẩm").trim(), last_imported_at: now, updated_at: now }','product_name: required(item.product_name, "Tên sản phẩm").trim(), last_imported_at: now, updated_at: now, active: true }')
anchor='    case "list-users": return listUsers(context);'
s=once(s,anchor,'    case "replace-catalog": return replaceCatalog(context, body);\n    case "staff-sync-now": requireRole(context,["ADMIN","ADMIN_INVENT"]); return syncStaffDirectory("MANUAL",context.userId);\n    case "staff-sync-status": return staffSyncStatus(context);\n    case "service-metrics": return serviceMetrics(context);\n    case "delete-user": return deleteManagedUser(context, body);\n'+anchor,'new routes')
for line in ['    case "inventory-status": return inventoryStatus(context, body);\n','    case "inventory-current": return inventoryCurrent(context, body);\n','    case "inventory-summary": return inventorySummary(context);\n','    case "inventory-connection-status": return inventoryConnectionStatus(context);\n','    case "inventory-credential-update": return updateInventoryCredential(context, body);\n','    case "inventory-sync-start": return startSupraInventory(context, body);\n','    case "inventory-recovery-start": return startRecoveryInventory(context, body);\n','    case "inventory-recovery-stage": return stageRecoveryInventory(context, body);\n','    case "inventory-recovery-finalize": return finalizeRecoveryInventory(context, body);\n','    case "inventory-job-cancel": return cancelInventoryJob(context, body);\n']:
    s=s.replace(line,'')

reports=r'''    case "reports-summary": {
      requireRole(context,["ADMIN","ADMIN_INVENT"]);const now=Date.now(),since30=new Date(now-30*86400000).toISOString(),since24=new Date(now-86400000).toISOString();
      const {data,error}=await admin.from("issues").select("id,sku,status,report_count,first_reported_at,resolved_at,claimed_at,previous_issue_id,claimed_by").gte("first_reported_at",since30).limit(10000);if(error)throw error;const rows=data??[],byStatus:Record<string,number>={},skuCounts=new Map<string,number>(),durations:number[]=[],claimDurations:number[]=[],hourly=new Array(24).fill(0);
      for(const row of rows){byStatus[row.status]=(byStatus[row.status]??0)+1;skuCounts.set(row.sku,(skuCounts.get(row.sku)??0)+Number(row.report_count??1));if(row.resolved_at)durations.push((new Date(row.resolved_at).getTime()-new Date(row.first_reported_at).getTime())/60000);if(row.claimed_at)claimDurations.push((new Date(row.claimed_at).getTime()-new Date(row.first_reported_at).getTime())/60000);if(row.first_reported_at>=since24)hourly[new Date(row.first_reported_at).getHours()]+=Number(row.report_count??1);}
      const percentile=(v:number[],p:number)=>v.length?[...v].sort((a,b)=>a-b)[Math.min(v.length-1,Math.floor((v.length-1)*p))]:null;const topKeys=[...skuCounts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,20).map(([sku])=>sku),skuNames=new Map<string,string>();if(topKeys.length){const {data:c}=await admin.from("sku_catalog").select("sku,product_name").in("sku",topKeys);(c??[]).forEach((r:any)=>skuNames.set(r.sku,r.product_name));}
      const {data:cfg}=await admin.from("app_config").select("acknowledge_minutes,auto_skip_enabled,auto_skip_after_minutes").eq("singleton",true).single();const overdueCutoff=new Date(now-Math.max(1,Number(cfg?.acknowledge_minutes??15))*60000).toISOString();const {count:overdue}=await admin.from("issues").select("id",{count:"exact",head:true}).in("status",ACTIVE_STATUSES).lte("first_reported_at",overdueCutoff);const {count:autoSkipCount}=await admin.from("issue_audit").select("id",{count:"exact",head:true}).eq("action","AUTO_SKIP").gte("created_at",since30);const last24=rows.filter((r:any)=>r.first_reported_at>=since24),resolved24=last24.filter((r:any)=>r.resolved_at);
      return {days:30,issues:rows.length,reports:rows.reduce((sum,r)=>sum+Number(r.report_count??1),0),by_status:byStatus,active_now:rows.filter((r:any)=>ACTIVE_STATUSES.includes(r.status)).length,overdue_now:overdue??0,last_24h:{issues:last24.length,reports:last24.reduce((sum,r)=>sum+Number(r.report_count??1),0),resolved:resolved24.length,available:last24.filter((r:any)=>r.status==="AVAILABLE").length,skipped:last24.filter((r:any)=>r.status==="SKIP_ALLOWED").length},average_resolution_minutes:durations.length?Math.round(durations.reduce((a,b)=>a+b,0)/durations.length):null,median_resolution_minutes:percentile(durations,.5)==null?null:Math.round(percentile(durations,.5)!),p95_resolution_minutes:percentile(durations,.95)==null?null:Math.round(percentile(durations,.95)!),median_claim_minutes:percentile(claimDurations,.5)==null?null:Math.round(percentile(claimDurations,.5)!),p95_claim_minutes:percentile(claimDurations,.95)==null?null:Math.round(percentile(claimDurations,.95)!),recurrent_episodes:rows.filter((r:any)=>r.previous_issue_id).length,auto_skip_count_30d:autoSkipCount??0,auto_skip_enabled:Boolean(cfg?.auto_skip_enabled),auto_skip_after_minutes:Number(cfg?.auto_skip_after_minutes??120),top_skus:[...skuCounts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,20).map(([sku,reports])=>({sku,product_name:skuNames.get(sku)??"",reports})),hourly_reports_24h:hourly};
    }
'''
s=between(s,'    case "reports-summary": {','    case "issue-history": {',reports+'    case "issue-history": {','reports')
for key in ['SUPRA_CREDENTIAL_REQUIRED','SOURCE_CONTRACT_UNVERIFIED','SUPRA_CONNECTION_NOT_READY','SUPRA_POC_REQUIRED','ROW_COUNT_MISMATCH']:
    s=re.sub(rf'\n\s*{key}: "[^"]*",?','',s)
s=once(s,'      ADMIN_ALREADY_EXISTS: "Hệ thống chỉ cho phép duy nhất một ADMIN",','      ADMIN_ALREADY_EXISTS: "Hệ thống chỉ cho phép duy nhất một ADMIN",\n      SOURCE_MANAGED_USER: "Nhân sự đồng bộ từ Google Sheet chỉ được cập nhật từ nguồn",\n      STAFF_DEFAULT_PASSWORD_NOT_CONFIGURED: "Mật khẩu mặc định nhân sự chưa được cấu hình an toàn",\n      CATALOG_ROW_COUNT_INVALID: "File danh mục SKU vượt giới hạn hoặc không có dữ liệu",\n      CATALOG_EMPTY: "Không tìm thấy SKU hợp lệ trong file",','errors')
for retired in ['inventory-credential-update','inventory-sync-start','SUPRA_CREDENTIAL_MASTER_KEY']:
    if retired in s: raise SystemExit(f'retired marker remains: {retired}')
write(p,s)
print('API_PATCH_OK')
