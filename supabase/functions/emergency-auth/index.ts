import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")!;
const ANON_KEY=Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FIREBASE_SERVICE_ACCOUNT=Deno.env.get("FIREBASE_SERVICE_ACCOUNT")??"";
const admin=createClient(SUPABASE_URL,SERVICE_KEY,{auth:{persistSession:false}});
const AUD="https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit";
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
function b64url(value:string|Uint8Array){const bytes=typeof value==="string"?new TextEncoder().encode(value):value;let binary="";for(const b of bytes)binary+=String.fromCharCode(b);return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");}
function pemBytes(pem:string){const body=pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,"");const raw=atob(body);return Uint8Array.from(raw,c=>c.charCodeAt(0));}
async function mint(uid:string,claims:Record<string,unknown>,account:{client_email:string;private_key:string}){
 const now=Math.floor(Date.now()/1000);const header=b64url(JSON.stringify({alg:"RS256",typ:"JWT"}));const payload=b64url(JSON.stringify({iss:account.client_email,sub:account.client_email,aud:AUD,iat:now,exp:now+3600,uid,claims}));const unsigned=`${header}.${payload}`;const key=await crypto.subtle.importKey("pkcs8",Uint8Array.from(pemBytes(account.private_key)).buffer,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);const sig=await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,new TextEncoder().encode(unsigned));return `${unsigned}.${b64url(new Uint8Array(sig))}`;
}
Deno.serve(async(req)=>{try{
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 const authorization=req.headers.get("authorization")??"";if(!authorization.startsWith("Bearer "))return json({error:"Unauthorized"},401);
 if(!FIREBASE_SERVICE_ACCOUNT)return json({error:"Emergency auth unavailable"},503);
 const client=createClient(SUPABASE_URL,ANON_KEY,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}});const{data:{user},error:userError}=await client.auth.getUser();if(userError||!user)return json({error:"Unauthorized"},401);
 const{data:profile,error:profileError}=await admin.from("profiles").select("id,role,active").eq("id",user.id).single();if(profileError||!profile?.active)return json({error:"Account inactive"},403);
 const body=await req.json().catch(()=>({})) as Record<string,unknown>;const deviceId=String(body.device_id??"").trim();if(deviceId.length<8||deviceId.length>200)return json({error:"Invalid device"},400);
 const account=JSON.parse(FIREBASE_SERVICE_ACCOUNT) as {project_id:string;client_email:string;private_key:string};if(account.project_id!=="bao-hang-1291")return json({error:"Firebase project mismatch"},503);
 const token=await mint(String(profile.id),{site:"1291",role:String(profile.role),device_id:deviceId,emergency_enabled:true},account);
 await admin.from("emergency_auth_audit").upsert({account_id:profile.id,device_id:deviceId,role:profile.role,provisioned_at:new Date().toISOString(),last_token_at:new Date().toISOString()},{onConflict:"account_id,device_id"});
 return json({custom_token:token,project_id:account.project_id,uid:profile.id,device_id:deviceId});
 }catch(error){console.error(error instanceof Error?error.message.slice(0,400):"emergency auth error");return json({error:"Emergency auth failed"},500);}});
