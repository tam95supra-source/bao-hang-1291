from pathlib import Path
import re

ROOT = Path('.')

def read(path):
    return (ROOT / path).read_text(encoding='utf-8')

def write(path, content):
    p = ROOT / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding='utf-8')

def must_replace(path, old, new, count=None):
    text = read(path)
    if old not in text:
        raise SystemExit(f'missing replacement marker in {path}: {old[:120]!r}')
    text2 = text.replace(old, new, count if count is not None else -1)
    write(path, text2)

def must_re_sub(path, pattern, repl, flags=re.S):
    text = read(path)
    text2, n = re.subn(pattern, repl, text, flags=flags)
    if n != 1:
        raise SystemExit(f'regex marker count {n} in {path}: {pattern[:120]}')
    write(path, text2)

# -----------------------------------------------------------------------------
# Database: backup accounts are technical identities, never personnel rows.
# -----------------------------------------------------------------------------
write('supabase/migrations/20260814150012_target_final_backup_accounts.sql', r'''begin;

create table if not exists public.backup_accounts (
  id uuid primary key default gen_random_uuid(),
  username text not null unique check (username = lower(username) and username ~ '^[a-z0-9._-]{3,64}$'),
  display_name text not null check (length(trim(display_name)) between 2 and 120),
  role public.user_role not null,
  device_scope text not null default '*' check (length(device_scope) between 1 and 200),
  status text not null default 'ACTIVE' check (status in ('PROVISIONING','ACTIVE','LOCKED','REVOKED')),
  expires_at timestamptz,
  firebase_uid text not null unique,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists backup_accounts_status_expiry_idx on public.backup_accounts(status, expires_at);
alter table public.backup_accounts enable row level security;
revoke all on table public.backup_accounts from public,anon,authenticated;

create table if not exists public.backup_account_audit (
  id bigint generated always as identity primary key,
  account_id uuid references public.backup_accounts(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists backup_account_audit_account_created_idx on public.backup_account_audit(account_id,created_at desc);
create index if not exists backup_account_audit_created_idx on public.backup_account_audit(created_at desc);
alter table public.backup_account_audit enable row level security;
revoke all on table public.backup_account_audit from public,anon,authenticated;

commit;
''')

# -----------------------------------------------------------------------------
# Edge: Admin-only backup identity management. Password never enters DB/Sheet/log.
# The Sheet stores only salt+peppered HMAC verifier; Firebase is pre-provisioned.
# -----------------------------------------------------------------------------
write('supabase/functions/backup-account-admin/index.ts', r'''import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SHEET_URL = Deno.env.get("GOOGLE_SHEET_WEBHOOK_URL") ?? "";
const SHEET_SECRET = Deno.env.get("GOOGLE_SHEET_WEBHOOK_SECRET") ?? "";
const SIGNING_SECRET = Deno.env.get("FALLBACK_TOKEN_SIGNING_SECRET") ?? SHEET_SECRET;
const FIREBASE_SERVICE_ACCOUNT = Deno.env.get("FIREBASE_SERVICE_ACCOUNT") ?? "";
const FIREBASE_API_KEY = Deno.env.get("FIREBASE_WEB_API_KEY") ?? "AIzaSyB-n368fntzxsuuLlvte9NXhcuX0DDbTXM";
const PROJECT_ID = "bao-hang-1291";
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

type Role = "ADMIN" | "ADMIN_INVENT" | "INVENT" | "PICKER";
type ServiceAccount = { project_id: string; client_email: string; private_key: string };
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const safe = (value: unknown) => String(value ?? "").trim();

function b64url(bytes: Uint8Array): string { let s=""; for(const b of bytes)s+=String.fromCharCode(b); return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,""); }
function pemBytes(pem: string): Uint8Array { const raw=atob(pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,"")); return Uint8Array.from(raw,c=>c.charCodeAt(0)); }
async function googleToken(account: ServiceAccount): Promise<string> {
  const now=Math.floor(Date.now()/1000);
  const enc=(v:unknown)=>b64url(new TextEncoder().encode(JSON.stringify(v)));
  const h=enc({alg:"RS256",typ:"JWT"});
  const p=enc({iss:account.client_email,scope:"https://www.googleapis.com/auth/cloud-platform",aud:"https://oauth2.googleapis.com/token",iat:now,exp:now+1800});
  const unsigned=`${h}.${p}`;
  const key=await crypto.subtle.importKey("pkcs8",Uint8Array.from(pemBytes(account.private_key)).buffer,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);
  const sig=await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,new TextEncoder().encode(unsigned));
  const response=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion:`${unsigned}.${b64url(new Uint8Array(sig))}`})});
  if(!response.ok) throw new HttpError(503,`Firebase OAuth unavailable (${response.status})`);
  return String((await response.json()).access_token ?? "");
}
async function googleJson(url:string, token:string, init:RequestInit={}):Promise<any>{
  const response=await fetch(url,{...init,headers:{authorization:`Bearer ${token}`,"content-type":"application/json",...(init.headers??{})}});
  const text=await response.text(); const body=text?JSON.parse(text):{};
  if(!response.ok) throw new HttpError(response.status>=500?503:409,`Firebase admin ${response.status}: ${String(body?.error?.message??body?.error?.status??"FAILED").slice(0,120)}`);
  return body;
}
async function hmacHex(value:string):Promise<string>{
  if(SIGNING_SECRET.length<24) throw new HttpError(503,"Backup verifier service is not configured");
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(SIGNING_SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const out=new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(value)));
  return [...out].map(b=>b.toString(16).padStart(2,"0")).join("");
}
function randomSalt():string { const bytes=crypto.getRandomValues(new Uint8Array(24)); return b64url(bytes); }
function backupEmail(id:string):string { return `backup-${id}@auth.bao-hang-1291.invalid`; }
function claims(role:Role, deviceScope:string){ return JSON.stringify({site:"1291",role,device_scope:deviceScope,emergency_enabled:true,account_kind:"BACKUP"}); }
async function context(req:Request){
  const authorization=req.headers.get("authorization")??""; if(!authorization.startsWith("Bearer ")) throw new HttpError(401,"Unauthorized");
  const client=createClient(SUPABASE_URL,ANON_KEY,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}});
  const {data:{user},error}=await client.auth.getUser(); if(error||!user) throw new HttpError(401,"Phiên đăng nhập đã hết hạn");
  const {data:profile,error:pe}=await admin.from("profiles").select("id,role,active").eq("id",user.id).single();
  if(pe||!profile?.active||profile.role!=="ADMIN") throw new HttpError(403,"Chỉ Admin hệ thống được quản lý tài khoản dự phòng");
  return {userId:String(user.id)};
}
async function sheetUpsert(payload:Record<string,unknown>){
  if(!SHEET_URL||!SHEET_SECRET) throw new HttpError(503,"Google Sheet authority chưa cấu hình");
  const response=await fetch(SHEET_URL,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({mode:"backup_account_upsert",secret:SHEET_SECRET,...payload})});
  const text=await response.text(); let body:any={}; try{body=text?JSON.parse(text):{};}catch{throw new HttpError(503,"Apps Script trả dữ liệu không hợp lệ");}
  if(!response.ok||body?.ok!==true) throw new HttpError(503,`Apps Script backup registry rejected: ${String(body?.error??response.status).slice(0,120)}`);
  return body;
}
async function firebaseProvision(account:ServiceAccount, id:string, username:string, displayName:string, role:Role, deviceScope:string, password:string, disabled=false){
  const token=await googleToken(account); const email=backupEmail(id);
  const createUrl=`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts?key=${encodeURIComponent(FIREBASE_API_KEY)}`;
  let created=false;
  try{
    await googleJson(createUrl,token,{method:"POST",body:JSON.stringify({localId:id,email,password,displayName,emailVerified:true,disabled})}); created=true;
  }catch(error){
    if(!(error instanceof HttpError) || !String(error.message).includes("LOCAL_ID_EXISTS") && !String(error.message).includes("EMAIL_EXISTS")) throw error;
  }
  await googleJson(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:update?key=${encodeURIComponent(FIREBASE_API_KEY)}`,token,{method:"POST",body:JSON.stringify({localId:id,targetProjectId:PROJECT_ID,email,password,displayName,emailVerified:true,disableUser:disabled,customAttributes:claims(role,deviceScope)})});
  return {token,email,created};
}
async function firebaseSetDisabled(account:ServiceAccount,id:string,disabled:boolean){
  const token=await googleToken(account);
  await googleJson(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:update?key=${encodeURIComponent(FIREBASE_API_KEY)}`,token,{method:"POST",body:JSON.stringify({localId:id,targetProjectId:PROJECT_ID,disableUser:disabled})});
  return token;
}
async function setRevocation(token:string,id:string,revoked:boolean){
  const url=`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/emergency_revocations/${encodeURIComponent(id)}`;
  if(revoked){
    await googleJson(url,token,{method:"PATCH",body:JSON.stringify({fields:{revoked:{booleanValue:true},updated_at:{timestampValue:new Date().toISOString()}}})});
  }else{
    const response=await fetch(url,{method:"DELETE",headers:{authorization:`Bearer ${token}`}}); if(!response.ok&&response.status!==404) throw new HttpError(503,`Revocation cleanup ${response.status}`);
  }
}
async function audit(accountId:string|null,actorId:string,action:string,detail:Record<string,unknown>={}){
  await admin.from("backup_account_audit").insert({account_id:accountId,actor_id:actorId,action,detail});
}
function parseRole(value:unknown):Role { const role=safe(value).toUpperCase() as Role; if(!["ADMIN","ADMIN_INVENT","INVENT","PICKER"].includes(role)) throw new HttpError(400,"Vai trò dự phòng không hợp lệ"); return role; }
function validatePassword(value:unknown):string { const p=String(value??""); if(p.length<14||p.length>200) throw new HttpError(400,"Mật khẩu dự phòng cần từ 14 ký tự"); return p; }

Deno.serve(async(req)=>{try{
  if(req.method!=="POST") return json({error:"Method not allowed"},405);
  const ctx=await context(req); const action=new URL(req.url).pathname.split("/").filter(Boolean).at(-1)??"list"; const body=await req.json().catch(()=>({})) as Record<string,unknown>;
  if(!FIREBASE_SERVICE_ACCOUNT) throw new HttpError(503,"Firebase admin credential unavailable");
  const serviceAccount=JSON.parse(FIREBASE_SERVICE_ACCOUNT) as ServiceAccount; if(serviceAccount.project_id!==PROJECT_ID) throw new HttpError(503,"Firebase project mismatch");
  if(action==="list"){
    const {data,error}=await admin.from("backup_accounts").select("id,username,display_name,role,device_scope,status,expires_at,created_at,updated_at,revoked_at").order("created_at",{ascending:false}).limit(500); if(error) throw error;
    return json({accounts:data??[]});
  }
  if(action==="create"){
    const username=safe(body.username).toLowerCase(); if(!/^[a-z0-9._-]{3,64}$/.test(username)) throw new HttpError(400,"Username dự phòng không hợp lệ");
    const displayName=safe(body.display_name); if(displayName.length<2||displayName.length>120) throw new HttpError(400,"Tên hiển thị không hợp lệ");
    const role=parseRole(body.role); const deviceScope=safe(body.device_scope)||"*"; if(deviceScope.length>200) throw new HttpError(400,"Phạm vi thiết bị không hợp lệ");
    const password=validatePassword(body.password); const expiresAt=safe(body.expires_at); if(expiresAt&&Number.isNaN(Date.parse(expiresAt))) throw new HttpError(400,"Thời hạn không hợp lệ");
    const {data:existing}=await admin.from("backup_accounts").select("id").eq("username",username).maybeSingle(); if(existing) throw new HttpError(409,"Username dự phòng đã tồn tại");
    const id=crypto.randomUUID(); const salt=randomSalt(); const verifier=await hmacHex(`${salt}\n${username}\n${password}`);
    const firebase=await firebaseProvision(serviceAccount,id,username,displayName,role,deviceScope,password,false);
    try{
      await sheetUpsert({account:{account_id:id,username,display_name:displayName,role,device_scope:deviceScope,verifier_scheme:"HMAC_SHA256_PEPPER_V1",salt_b64:salt,verifier_b64:verifier,status:"ACTIVE",expires_at:expiresAt,revoked_at:"",created_at:new Date().toISOString(),created_by_account_id:ctx.userId,updated_at:new Date().toISOString()}});
      const {error}=await admin.from("backup_accounts").insert({id,username,display_name:displayName,role,device_scope:deviceScope,status:"ACTIVE",expires_at:expiresAt||null,firebase_uid:id,created_by:ctx.userId}); if(error) throw error;
      await setRevocation(firebase.token,id,false); await audit(id,ctx.userId,"CREATE",{username,role,device_scope:deviceScope,expires_at:expiresAt||null});
      return json({account:{id,username,display_name:displayName,role,device_scope:deviceScope,status:"ACTIVE",expires_at:expiresAt||null}});
    }catch(error){
      await firebaseSetDisabled(serviceAccount,id,true).catch(()=>undefined); await setRevocation(firebase.token,id,true).catch(()=>undefined); throw error;
    }
  }
  const id=safe(body.id); if(!id) throw new HttpError(400,"Thiếu account id");
  const {data:account,error:ae}=await admin.from("backup_accounts").select("*").eq("id",id).single(); if(ae||!account) throw new HttpError(404,"Không tìm thấy tài khoản dự phòng");
  if(action==="lock"){
    const token=await firebaseSetDisabled(serviceAccount,id,true); await setRevocation(token,id,true);
    const now=new Date().toISOString(); await sheetUpsert({account:{account_id:id,username:account.username,display_name:account.display_name,role:account.role,device_scope:account.device_scope,status:"LOCKED",expires_at:account.expires_at??"",revoked_at:now,updated_at:now}});
    const {error}=await admin.from("backup_accounts").update({status:"LOCKED",revoked_at:now,updated_at:now}).eq("id",id); if(error) throw error; await audit(id,ctx.userId,"LOCK"); return json({ok:true});
  }
  if(action==="reset"||action==="unlock"){
    const password=validatePassword(body.password); const salt=randomSalt(); const verifier=await hmacHex(`${salt}\n${account.username}\n${password}`);
    const firebase=await firebaseProvision(serviceAccount,id,account.username,account.display_name,account.role,account.device_scope,password,false); await setRevocation(firebase.token,id,false);
    const now=new Date().toISOString(); await sheetUpsert({account:{account_id:id,username:account.username,display_name:account.display_name,role:account.role,device_scope:account.device_scope,verifier_scheme:"HMAC_SHA256_PEPPER_V1",salt_b64:salt,verifier_b64:verifier,status:"ACTIVE",expires_at:account.expires_at??"",revoked_at:"",created_at:account.created_at,created_by_account_id:account.created_by,updated_at:now}});
    const {error}=await admin.from("backup_accounts").update({status:"ACTIVE",revoked_at:null,updated_at:now}).eq("id",id); if(error) throw error; await audit(id,ctx.userId,action.toUpperCase()); return json({ok:true});
  }
  throw new HttpError(404,"Không tìm thấy thao tác");
}catch(error){
  const status=error instanceof HttpError?error.status:500; const message=error instanceof Error?error.message:"Backup account error"; if(status>=500) console.error(message.slice(0,300)); return json({error:status>=500?"Backup account service failed":message},status);
}});
''')

# -----------------------------------------------------------------------------
# Backend deployment must include every target worker/function.
# -----------------------------------------------------------------------------
deploy = read('.github/workflows/deploy-backend.yml')
if 'backup-account-admin' not in deploy:
    anchor = '''      - name: Deploy fallback token issuer\n        if: ${{ hashFiles('supabase/functions/fallback-token/index.ts') != '' }}\n        run: supabase functions deploy fallback-token --no-verify-jwt --project-ref "$SUPABASE_PROJECT_ID"\n'''
    if anchor not in deploy:
        raise SystemExit('deploy-backend fallback marker missing')
    deploy = deploy.replace(anchor, anchor + '''      - name: Deploy Emergency Firebase auth broker\n        if: ${{ hashFiles('supabase/functions/emergency-auth/index.ts') != '' }}\n        run: supabase functions deploy emergency-auth --no-verify-jwt --project-ref "$SUPABASE_PROJECT_ID"\n      - name: Deploy Firestore-to-Sheet emergency drain helper\n        if: ${{ hashFiles('supabase/functions/emergency-drain/index.ts') != '' }}\n        run: supabase functions deploy emergency-drain --no-verify-jwt --project-ref "$SUPABASE_PROJECT_ID"\n      - name: Deploy Sheet-to-Service recovery importer\n        if: ${{ hashFiles('supabase/functions/fallback-importer/index.ts') != '' }}\n        run: supabase functions deploy fallback-importer --no-verify-jwt --project-ref "$SUPABASE_PROJECT_ID"\n      - name: Deploy backup technical account admin\n        if: ${{ hashFiles('supabase/functions/backup-account-admin/index.ts') != '' }}\n        run: supabase functions deploy backup-account-admin --no-verify-jwt --project-ref "$SUPABASE_PROJECT_ID"\n      - name: Deploy zero-cost Firebase bootstrap/verifier\n        if: ${{ hashFiles('supabase/functions/firebase-bootstrap/index.ts') != '' }}\n        run: supabase functions deploy firebase-bootstrap --no-verify-jwt --project-ref "$SUPABASE_PROJECT_ID"\n''')
    write('.github/workflows/deploy-backend.yml', deploy)

# Quality gate includes every target Edge function.
quality = read('.github/workflows/quality-target.yml')
if 'backup-account-admin/index.ts' not in quality:
    quality = quality.replace('supabase/functions/firebase-bootstrap/index.ts', 'supabase/functions/firebase-bootstrap/index.ts supabase/functions/backup-account-admin/index.ts')
    write('.github/workflows/quality-target.yml', quality)

# Web API forwards admin backup-account commands to the dedicated Edge function.
webapi = read('supabase/functions/web-api/index.ts')
if 'forwardToBackupAdmin' not in webapi:
    marker = '''async function forwardToApi(req: Request, action: string): Promise<Response> {'''
    insert = r'''async function forwardToBackupAdmin(req: Request, action: string): Promise<Response> {
  const ctx = await requireWebUser(req);
  if (ctx.effectiveRole !== "ADMIN") throw new HttpError(403, "Chỉ Admin hệ thống được quản lý tài khoản dự phòng");
  const authorization = req.headers.get("authorization") ?? "";
  const body = await req.text();
  const command = action.replace(/^backup-account-/, "");
  const response = await fetch(`${SUPABASE_URL}/functions/v1/backup-account-admin/${command}`, {
    method: "POST", headers: { "content-type": "application/json", authorization, apikey: ANON_KEY }, body: body || "{}",
  });
  return new Response(await response.text(), {
    status: response.status,
    headers: { ...corsHeaders(req), "content-type": response.headers.get("content-type") ?? "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

'''
    webapi = webapi.replace(marker, insert + marker)
    webapi = webapi.replace('''    if (forwardedActions.has(action)) return await forwardToApi(req, action);''', '''    if (action.startsWith("backup-account-")) return await forwardToBackupAdmin(req, action);\n    if (forwardedActions.has(action)) return await forwardToApi(req, action);''')
    write('supabase/functions/web-api/index.ts', webapi)

# -----------------------------------------------------------------------------
# Web: official label, Picker privacy, role-scoped realtime, no auto-SKIP UI,
# and Admin-only technical backup account management.
# -----------------------------------------------------------------------------
main = read('web-admin/src/main.js').replace('Admin Event', 'Admin Invent')
main = main.replace("setTimeout(() => {\n    if (kind === 'catalog'", "setTimeout(() => {\n    if (kind === 'catalog'")
main = main.replace('  }, 180);', '  }, 1200);')
main = main.replace("result.already_reported ? `SKU đã có báo trước. Đã ghi thêm lượt của bạn; tổng ${result.issue.report_count} lượt.` : 'Đã được server xác nhận báo thiếu.'", "result.already_reported ? 'SKU này đã có báo trước. Hệ thống đã ghi nhận báo của bạn.' : 'Đã được server xác nhận báo thiếu.'")
main = main.replace('<small>${Number(issue.report_count || 1)} lượt · ${formatTime(issue.reported_at)}</small>', '<small>${formatTime(issue.reported_at)}</small>')
# Role scoped channels. Picker never joins issue/staff global channels.
channel_old = '''  state.issueChannel = realtimeClient.channel('site:1291:issues', { config: { private: true } })\n    .on('broadcast', { event: 'issue_changed' }, () => scheduleLiveRefresh('issue'))\n    .subscribe(subscribeStatus);\n  state.catalogChannel = realtimeClient.channel('site:1291:catalog', { config: { private: true } })\n    .on('broadcast', { event: 'catalog_changed' }, () => scheduleLiveRefresh('catalog')).subscribe(subscribeStatus);\n  state.staffChannel = realtimeClient.channel('site:1291:staff', { config: { private: true } })\n    .on('broadcast', { event: 'staff_changed' }, () => scheduleLiveRefresh('staff')).subscribe(subscribeStatus);'''
channel_new = '''  if (role() === 'PICKER') {\n    state.issueChannel = realtimeClient.channel(`user:1291:${state.session.profile.id}`, { config: { private: true } })\n      .on('broadcast', { event: 'picker_alert' }, () => scheduleLiveRefresh('issue'))\n      .subscribe(subscribeStatus);\n  } else {\n    state.issueChannel = realtimeClient.channel('site:1291:issues', { config: { private: true } })\n      .on('broadcast', { event: 'issue_changed' }, () => scheduleLiveRefresh('issue'))\n      .subscribe(subscribeStatus);\n    if (['ADMIN','ADMIN_INVENT'].includes(role())) {\n      state.staffChannel = realtimeClient.channel('site:1291:staff', { config: { private: true } })\n        .on('broadcast', { event: 'staff_changed' }, () => scheduleLiveRefresh('staff')).subscribe(subscribeStatus);\n    }\n  }\n  state.catalogChannel = realtimeClient.channel('site:1291:catalog', { config: { private: true } })\n    .on('broadcast', { event: 'catalog_changed' }, () => scheduleLiveRefresh('catalog')).subscribe(subscribeStatus);'''
if channel_old not in main:
    raise SystemExit('web realtime channel marker missing')
main = main.replace(channel_old, channel_new)
main = main.replace("if(currentRole==='ADMIN')return [['overview','Tổng quan'],['events','Sự kiện'],['sku','Danh mục SKU'],['reports','Báo cáo'],['users','Nhân sự & quyền'],['devices','Thiết bị'],['services','Hệ thống & dung lượng'],['logs','Log & audit'],['config','Cấu hình'],['versions','Phiên bản']];", "if(currentRole==='ADMIN')return [['overview','Tổng quan'],['events','Sự kiện'],['sku','Danh mục SKU'],['reports','Báo cáo'],['users','Nhân sự & quyền'],['backup','Tài khoản dự phòng'],['devices','Thiết bị'],['services','Hệ thống & dung lượng'],['logs','Log & audit'],['config','Cấu hình'],['versions','Phiên bản']];")
main = main.replace('''    sku: renderSku, users: renderUsers, devices: renderDevices, services: renderIntegrations, logs: renderLogs,''', '''    sku: renderSku, users: renderUsers, backup: renderBackupAccounts, devices: renderDevices, services: renderIntegrations, logs: renderLogs,''')
# Remove auto-SKIP configuration surfaces; server remains hard-locked false.
main = re.sub(r"async function renderSla\(\)\{.*?\n\}\n\nasync function renderConfig\(\)\{.*?\n\}\n\nasync function renderVersions", r'''async function renderSla(){
 $('#content').innerHTML=`<div class="heading"><div><p class="eyebrow">SLA</p><h2>Mốc thời gian vận hành</h2></div></div><div id="slaBody"></div>`;
 try{const c=await api('get-operational-config');$('#slaBody').innerHTML=`<article class="card"><div class="form-grid"><label>Thời gian nhận xử lý (phút)<input id="ackMin" type="number" min="1" max="480" value="${c.acknowledge_minutes}"></label><label>Chu kỳ nhắc xử lý (phút)<input id="reminderMin" type="number" min="1" max="480" value="${c.reminder_minutes}"></label><label>Thời gian châm hàng (phút)<input id="replenishMin" type="number" min="1" max="480" value="${c.replenish_minutes}"></label><label>Nhắc Picker xác nhận (phút)<input id="pickerAckMin" type="number" min="1" max="60" value="${c.picker_ack_reminder_minutes}"></label></div><p class="muted">Hết mốc chỉ nhắc/escalate. Hệ thống không tự cho phép SKIP.</p><button id="saveSla" class="primary">LƯU MỐC THỜI GIAN</button><div id="slaMsg" class="message" hidden></div></article>`;$('#saveSla').onclick=async()=>{try{await api('save-operational-config',{acknowledge_minutes:Number($('#ackMin').value),reminder_minutes:Number($('#reminderMin').value),replenish_minutes:Number($('#replenishMin').value),picker_ack_reminder_minutes:Number($('#pickerAckMin').value),auto_skip_enabled:false,auto_skip_after_minutes:0});message('#slaMsg','Đã lưu mốc thời gian.','good');}catch(e){message('#slaMsg',safeMessage(e),'error');}};}catch(e){$('#slaBody').innerHTML=`<div class="message" data-type="error">${escapeHtml(safeMessage(e))}</div>`;}
}

async function renderConfig(){
 $('#content').innerHTML=`<div class="heading"><div><p class="eyebrow">CONFIG</p><h2>Cấu hình hệ thống</h2></div></div><div id="configBody"></div>`;
 try{const c=await api('get-config');$('#configBody').innerHTML=`<article class="card"><p><b>Retention nghiệp vụ: 45 ngày</b></p><p class="muted">OPEN/CLAIMED, event chưa ACK và conflict không bị xóa theo tuổi.</p><div class="form-grid"><label>Lưu log chẩn đoán (ngày)<input id="logDays" type="number" min="1" max="30" value="${c.diagnostic_log_retention_days}"></label><label class="check"><input id="staffAuto" type="checkbox" ${c.staff_auto_sync_enabled?'checked':''}>Tự động đồng bộ nhân sự</label><label>Chu kỳ đồng bộ nhân sự (phút)<input id="staffInterval" type="number" min="30" max="1440" value="${c.staff_sync_interval_minutes}"></label></div><button id="saveConfig" class="primary">LƯU CẤU HÌNH</button><div id="cfgMsg" class="message" hidden></div></article>`;$('#saveConfig').onclick=async()=>{try{await api('save-config',{retention_days:45,diagnostic_log_retention_days:Number($('#logDays').value),staff_auto_sync_enabled:$('#staffAuto').checked,staff_sync_interval_minutes:Number($('#staffInterval').value),auto_skip_enabled:false,auto_skip_after_minutes:0});message('#cfgMsg','Đã lưu cấu hình.','good');}catch(e){message('#cfgMsg',safeMessage(e),'error');}};}catch(e){$('#configBody').innerHTML=`<div class="message" data-type="error">${escapeHtml(safeMessage(e))}</div>`;}
}

async function renderVersions''', main, flags=re.S)
if 'async function renderBackupAccounts' not in main:
    backup_web = r'''async function renderBackupAccounts(){
  $('#content').innerHTML=`<div class="heading"><div><p class="eyebrow">RECOVERY IDENTITY</p><h2>Tài khoản dự phòng</h2></div><button id="newBackup" class="primary">TẠO TÀI KHOẢN</button></div><article class="card"><p>Tài khoản kỹ thuật dùng khi Service lỗi, tách hoàn toàn khỏi nhân sự và báo cáo năng suất. Mật khẩu không được lưu trên Web/Sheet.</p></article><div id="backupBody"></div>`;
  const load=async()=>{try{const d=await api('backup-account-list');const rows=d.accounts||[];$('#backupBody').innerHTML=rows.length?rows.map(a=>`<article class="card"><strong>${escapeHtml(a.username)} · ${escapeHtml(a.display_name)}</strong><p>${escapeHtml(ROLES[a.role]||a.role)} · ${escapeHtml(a.status)} · thiết bị: ${escapeHtml(a.device_scope||'*')}</p><small>Hết hạn: ${a.expires_at?formatTime(a.expires_at):'Không đặt'}</small><div class="actions">${a.status==='ACTIVE'?`<button class="secondary" data-reset-backup="${a.id}">ĐẶT LẠI MẬT KHẨU</button><button class="danger" data-lock-backup="${a.id}">KHÓA</button>`:`<button class="primary" data-unlock-backup="${a.id}">MỞ KHÓA + ĐẶT MẬT KHẨU</button>`}</div></article>`).join(''):'<div class="card muted">Chưa có tài khoản dự phòng.</div>';$$('[data-lock-backup]').forEach(b=>b.onclick=async()=>{if(!confirm('Khóa tài khoản dự phòng này?'))return;try{await api('backup-account-lock',{id:b.dataset.lockBackup});await load();}catch(e){alert(safeMessage(e));}});$$('[data-reset-backup]').forEach(b=>b.onclick=()=>backupPasswordAction('reset',b.dataset.resetBackup,load));$$('[data-unlock-backup]').forEach(b=>b.onclick=()=>backupPasswordAction('unlock',b.dataset.unlockBackup,load));}catch(e){$('#backupBody').innerHTML=`<div class="message" data-type="error">${escapeHtml(safeMessage(e))}</div>`;}};
  $('#newBackup').onclick=async()=>{const username=prompt('Username dự phòng (chữ thường, số, . _ -):')?.trim().toLowerCase();if(!username)return;const display_name=prompt('Tên hiển thị:')?.trim();if(!display_name)return;const roleValue=prompt('Vai trò: ADMIN / ADMIN_INVENT / INVENT / PICKER','INVENT')?.trim().toUpperCase();if(!roleValue)return;const device_scope=prompt('Device scope (* hoặc device ID cụ thể):','*')?.trim()||'*';const days=Number(prompt('Thời hạn tài khoản (ngày):','30')||30);const password=prompt('Mật khẩu dự phòng (ít nhất 14 ký tự):')||'';if(password.length<14)return alert('Mật khẩu cần ít nhất 14 ký tự.');try{await api('backup-account-create',{username,display_name,role:roleValue,device_scope,password,expires_at:new Date(Date.now()+Math.max(1,days)*86400000).toISOString()});await load();}catch(e){alert(safeMessage(e));}};
  load();
}
async function backupPasswordAction(action,id,done){const password=prompt('Mật khẩu mới (ít nhất 14 ký tự):')||'';if(password.length<14)return alert('Mật khẩu cần ít nhất 14 ký tự.');try{await api(`backup-account-${action}`,{id,password});await done();}catch(e){alert(safeMessage(e));}}

'''
    main = main.replace('async function renderDevices() {', backup_web + 'async function renderDevices() {')
write('web-admin/src/main.js', main)

config_live = read('web-admin/src/config-live.js')
config_live = re.sub(r"\n\s*setChecked\('autoSkipEnabled'.*?;", '', config_live)
config_live = re.sub(r"\n\s*setValue\('autoSkipAfter'.*?;", '', config_live)
config_live = re.sub(r"\n\s*setChecked\('cfgAutoSkip'.*?;", '', config_live)
config_live = re.sub(r"\n\s*setValue\('cfgAutoSkipAfter'.*?;", '', config_live)
write('web-admin/src/config-live.js', config_live)

# -----------------------------------------------------------------------------
# Android secure session + backup login + admin management.
# -----------------------------------------------------------------------------
session = read('app/src/main/java/vn/pickpack1291/baohang/data/SessionStore.kt')
session = session.replace('val isLoggedIn: Boolean get() = accessToken.isNotBlank() && profile != null', 'val sessionKind: String get() = prefs.getString(KEY_SESSION_KIND, "SERVICE").orEmpty()\n    val isLoggedIn: Boolean get() = profile != null && (accessToken.isNotBlank() || (sessionKind == "BACKUP" && hasValidFallbackCredential))')
session = session.replace('.putBoolean(KEY_DEVICE_REGISTERED, false)\n            .remove(KEY_ADMIN_TEST_ROLE)', '.putBoolean(KEY_DEVICE_REGISTERED, false)\n            .putString(KEY_SESSION_KIND, "SERVICE")\n            .remove(KEY_ADMIN_TEST_ROLE)')
if 'fun saveBackupProfile' not in session:
    session = session.replace('    fun updateProfile(profile: UserProfile) {', '''    fun saveBackupProfile(profile: UserProfile) {\n        prefs.edit()\n            .remove(KEY_ACCESS).remove(KEY_REFRESH).putLong(KEY_EXPIRES, 0L)\n            .putString(KEY_USER_ID, profile.id)\n            .putString(KEY_EMPLOYEE_CODE, profile.employeeCode)\n            .putString(KEY_FULL_NAME, profile.fullName)\n            .putString(KEY_CONTRACTOR, profile.contractor)\n            .putString(KEY_ROLE, profile.role.wire)\n            .putBoolean(KEY_ACTIVE, profile.active)\n            .putBoolean(KEY_DEVICE_REGISTERED, false)\n            .putString(KEY_SESSION_KIND, "BACKUP")\n            .remove(KEY_ADMIN_TEST_ROLE)\n            .apply()\n    }\n\n    fun updateProfile(profile: UserProfile) {''')
session = session.replace('''    fun clear() {\n        val stableDeviceId = deviceId\n        prefs.edit().clear().putString(KEY_DEVICE_ID, stableDeviceId).apply()\n    }''', '''    fun clear() {\n        val stableDeviceId = deviceId\n        val publicFallbackUrl = fallbackUrl\n        prefs.edit().clear().putString(KEY_DEVICE_ID, stableDeviceId).apply()\n        if (publicFallbackUrl.startsWith("https://")) prefs.edit().putString(KEY_FALLBACK_URL, publicFallbackUrl).apply()\n    }''')
session = session.replace('const val KEY_FALLBACK_EXPIRES = "fallback_expires_v1"', 'const val KEY_FALLBACK_EXPIRES = "fallback_expires_v1"\n        const val KEY_SESSION_KIND = "session_kind_v1"')
write('app/src/main/java/vn/pickpack1291/baohang/data/SessionStore.kt', session)

sheet_client = read('app/src/main/java/vn/pickpack1291/baohang/network/SheetFallbackClient.kt')
if 'BackupLoginResult' not in sheet_client:
    sheet_client = sheet_client.replace('import vn.pickpack1291.baohang.data.StockIssue', 'import vn.pickpack1291.baohang.data.StockIssue\nimport vn.pickpack1291.baohang.data.UserProfile')
    sheet_client = sheet_client.replace('data class Health(val ok: Boolean, val sheetMode: String, val schema: String)', 'data class Health(val ok: Boolean, val sheetMode: String, val schema: String)\n    data class BackupLoginResult(val profile: UserProfile, val fallbackToken: String, val fallbackUrl: String, val expiresAtMillis: Long, val firebaseEmail: String)')
    sheet_client = sheet_client.replace('''    suspend fun health(): Health {\n        if (!session.hasValidFallbackCredential) throw FallbackException("FALLBACK_TOKEN_EXPIRED", "Token fallback chưa sẵn sàng")\n        val separator = if (session.fallbackUrl.contains("?")) "&" else "?"\n        val request = Request.Builder().url(session.fallbackUrl + separator + "mode=health")\n            .get().header("Accept", "application/json").build()\n        val result = executeObject(request)\n        return Health(\n            ok = result.optBoolean("ok", false),\n            sheetMode = result.optString("sheet_mode", "UNKNOWN").uppercase(),\n            schema = result.optString("schema", "")\n        )\n    }''', '''    suspend fun health(): Health {\n        val result = signedPost(JSONObject().put("mode", "health"))\n        return Health(ok = result.optBoolean("ok", false), sheetMode = result.optString("sheet_mode", "UNKNOWN").uppercase(), schema = result.optString("schema", ""))\n    }\n\n    suspend fun backupLogin(username: String, password: String): BackupLoginResult {\n        val url = session.fallbackUrl\n        if (!url.startsWith("https://")) throw FallbackException("FALLBACK_URL_MISSING", "Thiết bị chưa được provision đường dự phòng trước sự cố")\n        val body = JSONObject().put("mode", "backup_login").put("username", username.trim().lowercase()).put("password", password)\n            .put("timestamp_ms", System.currentTimeMillis()).put("nonce", UUID.randomUUID().toString() + UUID.randomUUID().toString()).put("device_id", session.deviceId)\n        val request = Request.Builder().url(url).post(body.toString().toRequestBody(jsonType)).header("Content-Type", "application/json").header("Accept", "application/json").build()\n        val result = executeObject(request)\n        val token = result.optString("fallback_token"); val expires = runCatching { Instant.parse(result.optString("expires_at")).toEpochMilli() }.getOrDefault(0L)\n        val profile = UserProfile.fromJson(result.getJSONObject("profile"))\n        if (token.isBlank() || expires <= System.currentTimeMillis()) throw FallbackException("INVALID_CREDENTIAL", "Phiên dự phòng không hợp lệ")\n        return BackupLoginResult(profile, token, url, expires, result.optString("firebase_email"))\n    }''')
write('app/src/main/java/vn/pickpack1291/baohang/network/SheetFallbackClient.kt', sheet_client)

emergency = read('app/src/main/java/vn/pickpack1291/baohang/network/EmergencyFirestoreClient.kt')
if 'provisionBackup' not in emergency:
    emergency = emergency.replace('''    fun signOut() = auth.signOut()''', '''    suspend fun provisionBackup(firebaseEmail: String, password: String, expectedUid: String): Boolean {\n        if (firebaseEmail.isBlank() || password.isBlank() || expectedUid.isBlank()) return false\n        val signed = auth.signInWithEmailAndPassword(firebaseEmail, password).await().user ?: throw EmergencyException("AUTH_FAILED", "Không thể provision Emergency backup account")\n        if (signed.uid != expectedUid) { auth.signOut(); throw EmergencyException("UID_MISMATCH", "Emergency backup identity không khớp") }\n        return true\n    }\n\n    fun signOut() = auth.signOut()''')
write('app/src/main/java/vn/pickpack1291/baohang/network/EmergencyFirestoreClient.kt', emergency)

api = read('app/src/main/java/vn/pickpack1291/baohang/network/ApiClient.kt')
if 'suspend fun invokeEdge' not in api:
    api = api.replace('''    suspend fun invoke(action: String, payload: JSONObject): JSONObject = withContext(Dispatchers.IO) {\n        refreshSessionIfNeeded()\n        request("POST", "$baseUrl/functions/v1/api/$action", payload, authenticated = true, eventName = "api_$action")\n    }''', '''    suspend fun invoke(action: String, payload: JSONObject): JSONObject = withContext(Dispatchers.IO) {\n        refreshSessionIfNeeded()\n        request("POST", "$baseUrl/functions/v1/api/$action", payload, authenticated = true, eventName = "api_$action")\n    }\n\n    suspend fun invokeEdge(function: String, action: String, payload: JSONObject): JSONObject = withContext(Dispatchers.IO) {\n        refreshSessionIfNeeded()\n        request("POST", "$baseUrl/functions/v1/${function.trim('/')}/${action.trim('/')}", payload, authenticated = true, eventName = "edge_${function}_$action")\n    }''')
write('app/src/main/java/vn/pickpack1291/baohang/network/ApiClient.kt', api)

repo = read('app/src/main/java/vn/pickpack1291/baohang/data/AppRepository.kt')
repo = repo.replace('import vn.pickpack1291.baohang.network.ApiClient', 'import vn.pickpack1291.baohang.network.ApiClient\nimport vn.pickpack1291.baohang.network.ApiException')
login_pattern = r'''    suspend fun login\(employeeCode: String, password: String\): UserProfile \{.*?\n    \}\n\n    fun logout\(\)'''
login_repl = r'''    suspend fun login(employeeCode: String, password: String): UserProfile {
        var lastServiceError: Exception? = null
        for ((index, waitMs) in longArrayOf(0L, 500L, 1_500L).withIndex()) {
            if (waitMs > 0) delay(waitMs)
            try {
                val auth = api.signIn(employeeCode.trim(), password)
                session.save(auth)
                commitAuthority(AuthorityMode.SERVICE)
                diagnostics.info("session_saved", mapOf("employee_code" to auth.profile.employeeCode, "role" to auth.profile.role.wire, "attempt" to index + 1))
                registerCurrentDevice()
                refreshFallbackCredentialIfPossible(force = true)
                provisionEmergencyIfPossible()
                resolveAuthorityFromRecoveryState()
                if (database.outboxCount() > 0) SyncScheduler.enqueueOutbox(context)
                if (catalogNeedsRefresh()) SyncScheduler.enqueueCatalog(context)
                return auth.profile
            } catch (error: Exception) {
                if (!isLoginServiceUnavailable(error)) throw error
                lastServiceError = error
            }
        }
        val backup = try { sheet.backupLogin(employeeCode, password) } catch (error: Exception) {
            throw MutationUnavailableException("Service không khả dụng và đăng nhập dự phòng không được xác nhận.", error)
        }
        session.saveBackupProfile(backup.profile)
        session.saveFallbackCredential(backup.fallbackToken, backup.fallbackUrl, backup.expiresAtMillis)
        commitAuthority(AuthorityMode.SHEET)
        runCatching { emergency.provisionBackup(backup.firebaseEmail, password, backup.profile.id) }
            .onFailure { diagnostics.warn("backup_emergency_provision_deferred", mapOf("error" to it.message.orEmpty().take(160))) }
        diagnostics.info("backup_session_saved", mapOf("account_id" to backup.profile.id, "role" to backup.profile.role.wire))
        return backup.profile
    }

    private fun isLoginServiceUnavailable(error: Exception): Boolean = when (error) {
        is ApiException -> error.statusCode == 408 || error.statusCode == 429 || error.statusCode >= 500
        is IOException -> true
        else -> false
    }

    fun logout()'''
repo2, n = re.subn(login_pattern, login_repl, repo, flags=re.S)
if n != 1: raise SystemExit(f'AppRepository login replacement count={n}')
repo = repo2
repo = repo.replace('''    suspend fun refreshProfile(): UserProfile {\n        val profile = api.sessionProfile()''', '''    suspend fun refreshProfile(): UserProfile {\n        if (session.sessionKind == "BACKUP") { resolveAuthorityFromRecoveryState(); return session.profile ?: throw MutationUnavailableException("Phiên dự phòng không hợp lệ") }\n        val profile = api.sessionProfile()''')
repo = repo.replace('''                "ACTIVE_FALLBACK", "RECOVERY_IMPORTING", "RECOVERY_BLOCKED", "EMERGENCY_DRAIN" -> {\n                    // EMERGENCY stays sticky until Firestore events are durably ACKed into Sheet.\n                    if (preferredAuthority != AuthorityMode.EMERGENCY) commitAuthority(AuthorityMode.SHEET)\n                }''', '''                "ACTIVE_FALLBACK", "RECOVERY_IMPORTING", "RECOVERY_BLOCKED", "EMERGENCY_DRAIN" -> {\n                    if (preferredAuthority != AuthorityMode.EMERGENCY) commitAuthority(AuthorityMode.SHEET)\n                }\n                "EMERGENCY_CAUGHT_UP" -> commitAuthority(AuthorityMode.SHEET)''')
if 'suspend fun listBackupAccounts' not in repo:
    marker = '    suspend fun listUsers()=api.listUsers()'
    add = '''    suspend fun listBackupAccounts(): JSONArray = api.invokeEdge("backup-account-admin", "list", JSONObject()).optJSONArray("accounts") ?: JSONArray()\n    suspend fun createBackupAccount(username:String,displayName:String,role:UserRole,deviceScope:String,password:String,expiresAt:String): JSONObject = api.invokeEdge("backup-account-admin","create",JSONObject().put("username",username).put("display_name",displayName).put("role",role.wire).put("device_scope",deviceScope).put("password",password).put("expires_at",expiresAt))\n    suspend fun lockBackupAccount(id:String): JSONObject = api.invokeEdge("backup-account-admin","lock",JSONObject().put("id",id))\n    suspend fun resetBackupAccount(id:String,password:String): JSONObject = api.invokeEdge("backup-account-admin","reset",JSONObject().put("id",id).put("password",password))\n    suspend fun unlockBackupAccount(id:String,password:String): JSONObject = api.invokeEdge("backup-account-admin","unlock",JSONObject().put("id",id).put("password",password))\n\n'''
    if marker not in repo: raise SystemExit('AppRepository listUsers marker missing')
    repo = repo.replace(marker, add + marker)
write('app/src/main/java/vn/pickpack1291/baohang/data/AppRepository.kt', repo)

# Android UI labels/privacy/no-auto-skip/admin backup account screen.
ui = read('app/src/main/java/vn/pickpack1291/baohang/ui/MainActivity.kt').replace('Admin Event', 'Admin Invent')
ui = ui.replace('${issue.reportCount} lượt • ${shortTime(issue.reportedAt)}', '${shortTime(issue.reportedAt)}')
ui = ui.replace('''        content.addView(button("Nhân sự & quyền") { showUsers() })''', '''        content.addView(button("Nhân sự & quyền") { showUsers() })\n        content.addView(button("Tài khoản dự phòng") { showBackupAccounts() })''', 1)
# Replace SLA/config screens to remove forbidden automatic SKIP and hard-fix 45d.
ui = re.sub(r'''    private fun showOperationalSla\(\) \{.*?\n    \}\n\n    private fun showConfig\(\) \{.*?\n    \}\n\n    private fun showUsers\(\)''', r'''    private fun showOperationalSla() {
        val content = page("Mốc thời gian vận hành", SCREEN_SLA)
        val ack = numberInput("Thời gian nhận xử lý (phút)")
        val reminder = numberInput("Chu kỳ nhắc xử lý (phút)")
        val replenish = numberInput("Thời gian châm hàng (phút)")
        val pickerAck = numberInput("Nhắc Picker xác nhận (phút)")
        listOf(ack.first, reminder.first, replenish.first, pickerAck.first).forEach(content::addView)
        content.addView(infoBox("Hết mốc chỉ nhắc/escalate. Hệ thống không tự cho phép SKIP."))
        content.addView(button("Lưu mốc thời gian", ButtonTone.PRIMARY) {
            lifecycleScope.launch { runCatching { app.repository.saveOperationalConfig(OperationalConfig(ack.second.int(), reminder.second.int(), replenish.second.int(), pickerAck.second.int(), false, 0)) }.onSuccess { toast("Đã lưu mốc thời gian vận hành") }.onFailure { toast(it.message ?: "Không lưu được") } }
        })
        lifecycleScope.launch { runCatching { app.repository.getOperationalConfig() }.onSuccess { cfg ->
            ack.second.setText(cfg.acknowledgeMinutes.toString()); reminder.second.setText(cfg.reminderMinutes.toString()); replenish.second.setText(cfg.replenishMinutes.toString()); pickerAck.second.setText(cfg.pickerAckReminderMinutes.toString())
        }.onFailure { toast(it.message ?: "Không tải được cấu hình") } }
    }

    private fun showConfig() {
        val content = page("Cấu hình hệ thống", SCREEN_CONFIG)
        val logRetention = numberInput("Lưu log chẩn đoán (ngày)")
        val staffInterval = numberInput("Chu kỳ đồng bộ nhân sự (phút)")
        val staffAuto = CheckBox(this).apply { text = "Tự động đồng bộ danh mục nhân sự" }
        content.addView(infoBox("Lịch sử nghiệp vụ giữ 45 ngày. OPEN/CLAIMED, event chưa ACK và conflict không bị xóa theo tuổi."))
        content.addView(logRetention.first); content.addView(staffAuto); content.addView(staffInterval.first)
        content.addView(button("Lưu cấu hình", ButtonTone.PRIMARY) {
            lifecycleScope.launch { runCatching { val old=app.repository.getConfig(); app.repository.saveConfig(old.copy(retentionDays=45,diagnosticLogRetentionDays=logRetention.second.int(),staffAutoSyncEnabled=staffAuto.isChecked,staffSyncIntervalMinutes=staffInterval.second.int(),autoSkipEnabled=false,autoSkipAfterMinutes=0)) }.onSuccess { toast("Đã lưu cấu hình hệ thống") }.onFailure { toast(it.message ?: "Không lưu được") } }
        })
        lifecycleScope.launch { runCatching { app.repository.getConfig() }.onSuccess { cfg -> logRetention.second.setText(cfg.diagnosticLogRetentionDays.toString()); staffAuto.isChecked=cfg.staffAutoSyncEnabled; staffInterval.second.setText(cfg.staffSyncIntervalMinutes.toString()) }.onFailure { toast(it.message ?: "Không tải được cấu hình") } }
    }

    private fun showUsers()''', ui, flags=re.S)
if 'private fun showBackupAccounts()' not in ui:
    backup_ui = r'''    private fun showBackupAccounts() {
        if (app.session.effectiveRole != UserRole.ADMIN) { toast("Chỉ Admin hệ thống được quản lý tài khoản dự phòng"); return }
        val content = page("Tài khoản dự phòng", SCREEN_BACKUP)
        content.addView(infoBox("Danh tính kỹ thuật dùng khi Service lỗi. Không tính nhân sự/năng suất; mật khẩu không lưu trong App, Sheet hoặc log."))
        content.addView(button("Tạo tài khoản dự phòng", ButtonTone.PRIMARY) { createBackupAccount { showBackupAccounts() } })
        val list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }; content.addView(list)
        lifecycleScope.launch { runCatching { app.repository.listBackupAccounts() }.onSuccess { rows ->
            if (rows.length()==0) list.addView(infoBox("Chưa có tài khoản dự phòng."))
            for (i in 0 until rows.length()) { val a=rows.getJSONObject(i); val row=LinearLayout(this@MainActivity).apply { orientation=LinearLayout.VERTICAL; setPadding(dp(11),dp(9),dp(11),dp(9)); setBackgroundResource(R.drawable.bg_card) }
                row.addView(text("${a.optString("username")} • ${a.optString("display_name")}",16,true)); row.addView(text("${UserRole.from(a.optString("role")).label} • ${a.optString("status")} • thiết bị ${a.optString("device_scope","*")}",12,false))
                val id=a.optString("id"); if(a.optString("status")=="ACTIVE") { row.addView(button("Đặt lại mật khẩu") { backupPasswordDialog(id,false) { showBackupAccounts() } }); row.addView(button("Khóa",ButtonTone.DANGER) { lifecycleScope.launch { runCatching { app.repository.lockBackupAccount(id) }.onSuccess { showBackupAccounts() }.onFailure { toast(it.message?:"Không khóa được") } } }) } else row.addView(button("Mở khóa + đặt mật khẩu",ButtonTone.PRIMARY) { backupPasswordDialog(id,true) { showBackupAccounts() } })
                list.addView(row,LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,ViewGroup.LayoutParams.WRAP_CONTENT).apply { setMargins(0,dp(4),0,dp(4)) })
            }
        }.onFailure { list.addView(infoBox("Không tải được tài khoản dự phòng: ${it.message}")) } }
    }

    private fun createBackupAccount(refresh:()->Unit) {
        val root=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL; setPadding(dp(16),0,dp(16),0) }
        val username=EditText(this).apply { hint="Username dự phòng" }; val display=EditText(this).apply { hint="Tên hiển thị" }; val device=EditText(this).apply { hint="Device scope (* hoặc device ID)"; setText("*") }; val days=EditText(this).apply { hint="Thời hạn ngày"; inputType=InputType.TYPE_CLASS_NUMBER; setText("30") }; val password=EditText(this).apply { hint="Mật khẩu (>=14 ký tự)"; inputType=InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD }
        val roles=listOf(UserRole.ADMIN,UserRole.ADMIN_INVENT,UserRole.INVENT,UserRole.PICKER); val role=AutoCompleteTextView(this).apply { threshold=0; setAdapter(ArrayAdapter(this@MainActivity,android.R.layout.simple_dropdown_item_1line,roles.map{it.label})); setText(UserRole.INVENT.label,false) }; listOf(username,display,role,device,days,password).forEach(root::addView)
        AlertDialog.Builder(this).setTitle("Tạo tài khoản dự phòng").setView(root).setNegativeButton("Hủy",null).setPositiveButton("Tạo") { _,_-> val p=password.text.toString(); if(p.length<14){toast("Mật khẩu cần ít nhất 14 ký tự");return@setPositiveButton}; val selected=roles.firstOrNull{it.label==role.text.toString()}?:UserRole.INVENT; val expiry=Instant.now().plusSeconds((days.text.toString().toLongOrNull()?:30L).coerceAtLeast(1L)*86400L).toString(); lifecycleScope.launch { runCatching { app.repository.createBackupAccount(username.text.toString().trim().lowercase(),display.text.toString().trim(),selected,device.text.toString().trim().ifBlank{"*"},p,expiry) }.onSuccess { toast("Đã tạo tài khoản dự phòng"); refresh() }.onFailure { toast(it.message?:"Không tạo được") } } }.show()
    }

    private fun backupPasswordDialog(id:String,unlock:Boolean,refresh:()->Unit){ val input=EditText(this).apply { hint="Mật khẩu mới (>=14 ký tự)"; inputType=InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD }; AlertDialog.Builder(this).setTitle(if(unlock)"Mở khóa tài khoản dự phòng" else "Đặt lại mật khẩu").setView(input).setNegativeButton("Hủy",null).setPositiveButton("Xác nhận") { _,_-> val p=input.text.toString(); if(p.length<14){toast("Mật khẩu cần ít nhất 14 ký tự");return@setPositiveButton}; lifecycleScope.launch { runCatching { if(unlock) app.repository.unlockBackupAccount(id,p) else app.repository.resetBackupAccount(id,p) }.onSuccess { refresh() }.onFailure { toast(it.message?:"Không cập nhật được") } } }.show() }

'''
    ui = ui.replace('    private fun showServiceMetrics() {', backup_ui + '    private fun showServiceMetrics() {')
ui = ui.replace('private const val SCREEN_USERS = "users"', 'private const val SCREEN_USERS = "users"\n        private const val SCREEN_BACKUP = "backup"')
write('app/src/main/java/vn/pickpack1291/baohang/ui/MainActivity.kt', ui)

# Import java.time.Instant required by backup expiry UI.
ui2 = read('app/src/main/java/vn/pickpack1291/baohang/ui/MainActivity.kt')
if 'import java.time.Instant' not in ui2:
    ui2 = ui2.replace('import java.nio.charset.StandardCharsets', 'import java.nio.charset.StandardCharsets\nimport java.time.Instant')
write('app/src/main/java/vn/pickpack1291/baohang/ui/MainActivity.kt', ui2)

# Official role label everywhere in source that reaches UI.
for path in [
    'app/src/main/java/vn/pickpack1291/baohang/data/Models.kt',
    'web-admin/src/main.js',
    'supabase/functions/api/index.ts',
    'supabase/functions/admin-ops/index.ts',
    'docs/BUSINESS_RULES.md',
]:
    p=ROOT/path
    if p.exists(): write(path, read(path).replace('Admin Event','Admin Invent'))

# Remove the temporary patching machinery in the commit produced by the workflow.
for temp in ['scripts/apply_target_final_completion.py','.github/workflows/apply-target-final-completion.yml']:
    p=ROOT/temp
    if p.exists(): p.unlink()

print('TARGET_FINAL_COMPLETION_PATCH=READY')
