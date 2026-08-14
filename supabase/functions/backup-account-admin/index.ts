import { createClient } from "jsr:@supabase/supabase-js@2";

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
