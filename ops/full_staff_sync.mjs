import fs from 'node:fs';
import crypto from 'node:crypto';

const PROJECT='bao-hang-1291';
const ADMIN_UID='44fae0a2-09eb-4226-8412-0f1a1f5d7ef8';
const NEON_API='https://ep-morning-bread-az3w94qb.apirest.c-3.ap-southeast-1.aws.neon.tech/neondb/rest/v1';
const source=JSON.parse(fs.readFileSync(process.env.STAFF_SOURCE_JSON,'utf8'));
const sa=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT||'{}');
const workerUrl=String(process.env.GOOGLE_SHEET_WEBHOOK_URL||'');
if(sa.project_id!==PROJECT)throw new Error('PROJECT_SCOPE_MISMATCH');
if(!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(workerUrl))throw new Error('WORKER_SCOPE_MISMATCH');
if(!Array.isArray(source.staff)||source.staff.length<1||source.staff.length>500)throw new Error('SOURCE_COUNT_INVALID');

const gcfg=JSON.parse(fs.readFileSync('app/google-services.json','utf8'));
const apiKey=gcfg.client?.[0]?.api_key?.[0]?.current_key;
if(!apiKey)throw new Error('FIREBASE_WEB_API_KEY_MISSING');
const b64=v=>Buffer.from(typeof v==='string'?v:JSON.stringify(v)).toString('base64url');
function signJwt(payload){const h=b64({alg:'RS256',typ:'JWT'}),p=b64(payload),u=h+'.'+p,s=crypto.sign('RSA-SHA256',Buffer.from(u),sa.private_key).toString('base64url');return u+'.'+s}
async function request(url,opt={}){const r=await fetch(url,opt),text=await r.text();let j={};try{j=text?JSON.parse(text):{}}catch{j={raw:text}};if(!r.ok)throw new Error('HTTP_'+r.status+':'+String(j?.error?.message||j?.error||j?.message||j?.raw||'').slice(0,240));return j}
async function oauth(scope){const now=Math.floor(Date.now()/1000),assertion=signJwt({iss:sa.client_email,scope,aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});return (await request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})})).access_token}
async function adminIdToken(){const now=Math.floor(Date.now()/1000),custom=signJwt({iss:sa.client_email,sub:sa.client_email,aud:'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',iat:now,exp:now+900,uid:ADMIN_UID});return (await request('https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key='+encodeURIComponent(apiKey),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:custom,returnSecureToken:true})})).idToken}
async function neon(name,payload,token){return request(NEON_API+'/rpc/'+name,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify(payload||{})})}
async function firebaseUpdate(access,body){return request('https://identitytoolkit.googleapis.com/v1/projects/'+PROJECT+'/accounts:update',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+access},body:JSON.stringify(body)})}
const claims=(code,role)=>JSON.stringify({role:'authenticated',employee_code:String(code),app_role:String(role)});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

const adminToken=await adminIdToken();
const googleAccess=await oauth('https://www.googleapis.com/auth/identitytoolkit');
let profiles=await neon('worker_profiles_snapshot_rpc',{},adminToken);
if(!Array.isArray(profiles))throw new Error('PROFILE_SNAPSHOT_INVALID');
let byCode=new Map(profiles.map(p=>[String(p.employee_code||'').toLowerCase(),p]));
const seen=new Set(source.staff.map(x=>String(x.employee_code).toLowerCase()));
const result={source:source.staff.length,created:0,updated:0,unchanged:0,deactivated:0,failed:0,retries:0,errors:[]};

async function markGsheet(uid,item){return neon('worker_profile_upsert_rpc',{p_id:String(uid),p_employee_code:item.employee_code,p_full_name:item.full_name,p_contractor:item.contractor,p_role:item.role,p_active:true,p_source_kind:'GSHEET',p_source_position:item.source_position,p_protected_account:false},adminToken)}
async function updateExisting(old,item){
  const changed=old.full_name!==item.full_name||old.contractor!==item.contractor||old.role!==item.role||old.active!==true||old.source_kind!=='GSHEET'||String(old.source_position||'')!==item.source_position||!!old.protected_account;
  if(!changed){result.unchanged++;return}
  await firebaseUpdate(googleAccess,{localId:String(old.id),email:item.employee_code.toLowerCase()+'@bao-hang-1291.local',displayName:item.full_name,emailVerified:true,disableUser:false,customAttributes:claims(item.employee_code,item.role)});
  await markGsheet(old.id,item);result.updated++;
}
async function createNew(item){
  let last='';
  for(let attempt=1;attempt<=3;attempt++){
    try{
      const out=await request(workerUrl,{method:'POST',headers:{'content-type':'text/plain;charset=UTF-8'},body:JSON.stringify({action:'update-user',id_token:adminToken,employee_code:item.employee_code,full_name:item.full_name,contractor:item.contractor,role:item.role,active:true,source_position:item.source_position})});
      if(out?.ok!==true)throw new Error('WORKER_'+String(out?.error||'FAILED'));
      const uid=String(out?.profile?.id||'');if(!uid)throw new Error('PROFILE_ID_MISSING');
      await markGsheet(uid,item);result.created++;return;
    }catch(e){last=String(e.message);if(attempt<3){result.retries++;await sleep(800*attempt)}}
  }
  // A worker may have completed the write before a transient response failure. Reconcile before declaring failure.
  const snap=await neon('worker_profiles_snapshot_rpc',{},adminToken).catch(()=>[]);
  const found=Array.isArray(snap)?snap.find(p=>String(p.employee_code||'').toLowerCase()===String(item.employee_code).toLowerCase()):null;
  if(found){await markGsheet(found.id,item);result.created++;return}
  result.failed++;result.errors.push(item.employee_code+':'+last.slice(0,140));
}

const existingItems=[],newItems=[];
for(const item of source.staff){const old=byCode.get(String(item.employee_code).toLowerCase());(old?existingItems:newItems).push([old,item])}
for(const [old,item] of existingItems){try{await updateExisting(old,item)}catch(e){result.failed++;result.errors.push(item.employee_code+':'+String(e.message).slice(0,140))}}

const concurrency=Math.min(8,Math.max(1,Number(process.env.STAFF_CREATE_CONCURRENCY||8)));
let cursor=0;
async function worker(){while(true){const i=cursor++;if(i>=newItems.length)return;const [,item]=newItems[i];await createNew(item)}}
await Promise.all(Array.from({length:concurrency},()=>worker()));

profiles=await neon('worker_profiles_snapshot_rpc',{},adminToken);
for(const old of profiles){const code=String(old.employee_code||''),key=code.toLowerCase();if(old.source_kind==='GSHEET'&&!old.protected_account&&old.role!=='ADMIN'&&old.active&&!seen.has(key)){try{await firebaseUpdate(googleAccess,{localId:String(old.id),disableUser:true});await neon('worker_profile_deactivate_rpc',{p_id:String(old.id),p_reason:'STAFF_SOURCE_MISSING'},adminToken);result.deactivated++}catch(e){result.failed++;result.errors.push(code+':DEACTIVATE:'+String(e.message).slice(0,120))}}}

const finalProfiles=await neon('worker_profiles_snapshot_rpc',{},adminToken);
const finalBy=new Map(finalProfiles.map(p=>[String(p.employee_code||'').toLowerCase(),p]));
const mismatches=[];
for(const item of source.staff){const p=finalBy.get(String(item.employee_code).toLowerCase());if(!p||p.active!==true||p.source_kind!=='GSHEET'||p.full_name!==item.full_name||p.contractor!==item.contractor||p.role!==item.role||String(p.source_position||'')!==item.source_position)mismatches.push(item.employee_code)}
const protectedAdmins=finalProfiles.filter(p=>p.protected_account&&p.role==='ADMIN'&&p.active);
const gsheetActive=finalProfiles.filter(p=>p.source_kind==='GSHEET'&&p.active);
const roleCounts={};for(const p of finalProfiles.filter(p=>p.active))roleCounts[p.role]=(roleCounts[p.role]||0)+1;
const pass=result.failed===0&&mismatches.length===0&&protectedAdmins.length===1&&gsheetActive.length===source.staff.length;
const proof={status:pass?'PASS':'FAIL',source_count:source.staff.length,total_profiles:finalProfiles.length,active_gsheet:gsheetActive.length,protected_admins:protectedAdmins.length,created:result.created,updated:result.updated,unchanged:result.unchanged,deactivated:result.deactivated,failed:result.failed,retries:result.retries,mismatch_count:mismatches.length,role_counts:roleCounts,error_summary:result.errors.slice(0,20).join('; ').slice(0,1500)};
fs.writeFileSync('ops/full-staff-sync-last.json',JSON.stringify(proof,null,2)+'\n');
console.log('status='+proof.status);console.log('source_count='+proof.source_count);console.log('active_gsheet='+proof.active_gsheet);console.log('total_profiles='+proof.total_profiles);console.log('created='+proof.created);console.log('updated='+proof.updated);console.log('failed='+proof.failed);console.log('mismatch_count='+proof.mismatch_count);console.log('role_counts='+JSON.stringify(proof.role_counts));
if(!pass)process.exitCode=2;
