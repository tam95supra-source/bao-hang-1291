import fs from 'node:fs';
import crypto from 'node:crypto';

const PROJECT='bao-hang-1291';
const ADMIN_UID='44fae0a2-09eb-4226-8412-0f1a1f5d7ef8';
const NEON_API='https://ep-morning-bread-az3w94qb.apirest.c-3.ap-southeast-1.aws.neon.tech/neondb/rest/v1';
const MAX_SOURCE_ROWS=2000;
const MIN_SOURCE_ROWS=350;
const MAX_STALE_PROFILES=1000;
const source=JSON.parse(fs.readFileSync(process.env.STAFF_SOURCE_JSON,'utf8'));
const sa=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT||'{}');
const workerUrl=String(process.env.GOOGLE_SHEET_WEBHOOK_URL||'');

if(sa.project_id!==PROJECT)throw new Error('PROJECT_SCOPE_MISMATCH');
if(!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(workerUrl))throw new Error('WORKER_SCOPE_MISMATCH');
if(!Array.isArray(source.staff)||source.staff.length<MIN_SOURCE_ROWS||source.staff.length>MAX_SOURCE_ROWS)throw new Error('SOURCE_COUNT_INVALID');
if(!source.meta||Number(source.meta.unique_count)!==source.staff.length||Number(source.meta.duplicate_count)!==0||Number(source.meta.invalid_count)!==0)throw new Error('SOURCE_META_INVALID');

const gcfg=JSON.parse(fs.readFileSync('app/google-services.json','utf8'));
const apiKey=gcfg.client?.[0]?.api_key?.[0]?.current_key;
if(!apiKey)throw new Error('FIREBASE_WEB_API_KEY_MISSING');

const b64=v=>Buffer.from(typeof v==='string'?v:JSON.stringify(v)).toString('base64url');
const tokenFor=v=>crypto.createHash('sha256').update(String(v||'')).digest('hex').slice(0,12);
function signJwt(payload){const h=b64({alg:'RS256',typ:'JWT'}),p=b64(payload),u=h+'.'+p,s=crypto.sign('RSA-SHA256',Buffer.from(u),sa.private_key).toString('base64url');return u+'.'+s}
async function request(url,opt={}){const r=await fetch(url,opt),text=await r.text();let j={};try{j=text?JSON.parse(text):{}}catch{j={raw:text}};if(!r.ok)throw new Error('HTTP_'+r.status+':'+String(j?.error?.message||j?.error||j?.message||j?.raw||'').slice(0,240));return j}
async function oauth(scope){const now=Math.floor(Date.now()/1000),assertion=signJwt({iss:sa.client_email,scope,aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});return (await request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})})).access_token}
async function adminIdToken(){const now=Math.floor(Date.now()/1000),custom=signJwt({iss:sa.client_email,sub:sa.client_email,aud:'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',iat:now,exp:now+900,uid:ADMIN_UID});return (await request('https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key='+encodeURIComponent(apiKey),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:custom,returnSecureToken:true})})).idToken}
async function neon(name,payload,token){return request(NEON_API+'/rpc/'+name,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify(payload||{})})}
async function firebaseUpdate(access,body){return request('https://identitytoolkit.googleapis.com/v1/projects/'+PROJECT+'/accounts:update',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+access},body:JSON.stringify(body)})}
async function firebaseUsersSnapshot(access){
  const users=[]; let next='';
  do{
    const q=new URLSearchParams({maxResults:'1000'}); if(next)q.set('nextPageToken',next);
    const out=await request('https://identitytoolkit.googleapis.com/v1/projects/'+PROJECT+'/accounts:batchGet?'+q.toString(),{headers:{authorization:'Bearer '+access}});
    if(Array.isArray(out.users))users.push(...out.users);
    next=String(out.nextPageToken||'');
  }while(next);
  return users;
}
const claims=code=>JSON.stringify({role:'authenticated',employee_code:String(code),app_role:'PICKER'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function parseClaims(user){try{return JSON.parse(String(user?.customAttributes||'{}'))}catch{return {}}}
function firebaseState(user){return user?{email:String(user.email||''),displayName:String(user.displayName||''),disabled:user.disabled===true,customAttributes:String(user.customAttributes||'')} : null}
function firebaseNeedsNormalize(user,item){
  if(!user)return true;
  const c=parseClaims(user),email=item.employee_code.toLowerCase()+'@bao-hang-1291.local';
  return String(user.email||'').toLowerCase()!==email||String(user.displayName||'')!==item.full_name||user.emailVerified!==true||user.disabled===true||String(c.employee_code||'')!==item.employee_code||String(c.app_role||'')!=='PICKER'||String(c.role||'')!=='authenticated';
}
async function normalizeFirebase(access,uid,item){
  await firebaseUpdate(access,{localId:String(uid),email:item.employee_code.toLowerCase()+'@bao-hang-1291.local',displayName:item.full_name,emailVerified:true,disableUser:false,customAttributes:claims(item.employee_code)});
}
function profileCore(p){return {id:String(p.id),employee_code:String(p.employee_code||''),full_name:String(p.full_name||''),contractor:String(p.contractor||''),role:String(p.role||''),active:p.active===true,source_kind:String(p.source_kind||''),source_position:String(p.source_position||''),protected_account:p.protected_account===true}}
function manualDigest(profiles,firebaseById){
  const rows=profiles.filter(p=>p.source_kind==='MANUAL').map(p=>({profile:profileCore(p),firebase:firebaseState(firebaseById.get(String(p.id)))})).sort((a,b)=>a.profile.employee_code.localeCompare(b.profile.employee_code));
  return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
function setEqual(a,b){if(a.size!==b.size)return false;for(const x of a)if(!b.has(x))return false;return true}

const adminToken=await adminIdToken();
const googleAccess=await oauth('https://www.googleapis.com/auth/identitytoolkit');
let profiles=await neon('worker_profiles_snapshot_rpc',{},adminToken);
if(!Array.isArray(profiles))throw new Error('PROFILE_SNAPSHOT_INVALID');
let firebaseUsers=await firebaseUsersSnapshot(googleAccess);
let firebaseById=new Map(firebaseUsers.map(u=>[String(u.localId||''),u]));
let firebaseByEmail=new Map(firebaseUsers.filter(u=>u.email).map(u=>[String(u.email).toLowerCase(),u]));

const sourceCodes=new Set();
for(const item of source.staff){
  item.employee_code=String(item.employee_code||'').trim(); item.full_name=String(item.full_name||'').trim(); item.contractor=String(item.contractor||'').trim(); item.source_position=String(item.source_position||'').trim(); item.role='PICKER';
  if(!item.employee_code||sourceCodes.has(item.employee_code))throw new Error('SOURCE_EMPLOYEE_CODE_INVALID');
  sourceCodes.add(item.employee_code);
}
const profileCodeCounts=new Map();
for(const p of profiles){const c=String(p.employee_code||'');profileCodeCounts.set(c,(profileCodeCounts.get(c)||0)+1)}
if([...profileCodeCounts.values()].some(n=>n>1))throw new Error('PROFILE_EMPLOYEE_CODE_DUPLICATE');
const byCode=new Map(profiles.map(p=>[String(p.employee_code||''),p]));
const byId=new Map(profiles.map(p=>[String(p.id),p]));
const manualCollisions=source.staff.filter(x=>byCode.get(x.employee_code)?.source_kind==='MANUAL');
if(manualCollisions.length)throw new Error('SOURCE_COLLIDES_MANUAL:'+manualCollisions.map(x=>tokenFor(x.employee_code)).join(','));
const staleActiveBefore=profiles.filter(p=>p.source_kind==='GSHEET'&&p.active===true&&!p.protected_account&&p.role!=='ADMIN'&&!sourceCodes.has(String(p.employee_code||'')));
if(staleActiveBefore.length>MAX_STALE_PROFILES)throw new Error('MASS_CHANGE_GUARD_STALE_COUNT:'+staleActiveBefore.length);
const protectedAdminsBefore=profiles.filter(p=>p.protected_account&&p.role==='ADMIN'&&p.active===true);
if(protectedAdminsBefore.length!==1)throw new Error('PROTECTED_ADMIN_COUNT_INVALID');
const manualBeforeCount=profiles.filter(p=>p.source_kind==='MANUAL').length;
const manualBeforeDigest=manualDigest(profiles,firebaseById);
const preActiveGsheet=profiles.filter(p=>p.source_kind==='GSHEET'&&p.active===true).length;

const result={created:0,adopted_auth:0,updated:0,firebase_normalized:0,unchanged:0,deactivated:0,firebase_disabled:0,failed:0,retries:0,errors:[]};
async function markGsheet(uid,item){return neon('worker_profile_upsert_rpc',{p_id:String(uid),p_employee_code:item.employee_code,p_full_name:item.full_name,p_contractor:item.contractor,p_role:'PICKER',p_active:true,p_source_kind:'GSHEET',p_source_position:item.source_position,p_protected_account:false},adminToken)}
async function updateExisting(old,item){
  try{
    const fu=firebaseById.get(String(old.id));
    if(!fu)throw new Error('FIREBASE_USER_MISSING');
    if(firebaseNeedsNormalize(fu,item)){await normalizeFirebase(googleAccess,old.id,item);result.firebase_normalized++}
    const changed=old.full_name!==item.full_name||old.contractor!==item.contractor||old.role!=='PICKER'||old.active!==true||old.source_kind!=='GSHEET'||String(old.source_position||'')!==item.source_position||!!old.protected_account;
    if(changed){await markGsheet(old.id,item);result.updated++}else result.unchanged++;
  }catch(e){result.failed++;result.errors.push(item.employee_code+':'+String(e.message).slice(0,160))}
}
async function adoptExistingAuth(item,user){
  const uid=String(user?.localId||''); if(!uid)throw new Error('FIREBASE_ORPHAN_UID_MISSING');
  const occupied=byId.get(uid); if(occupied&&String(occupied.employee_code||'')!==item.employee_code)throw new Error('FIREBASE_UID_PROFILE_COLLISION');
  await normalizeFirebase(googleAccess,uid,item);
  await markGsheet(uid,item);
  result.created++; result.adopted_auth++; result.firebase_normalized++;
}
async function createNew(item){
  const email=item.employee_code.toLowerCase()+'@bao-hang-1291.local';
  const orphan=firebaseByEmail.get(email);
  if(orphan){try{await adoptExistingAuth(item,orphan);return}catch(e){result.failed++;result.errors.push(item.employee_code+':ADOPT:'+String(e.message).slice(0,150));return}}
  let last='';
  for(let attempt=1;attempt<=3;attempt++){
    try{
      const out=await request(workerUrl,{method:'POST',headers:{'content-type':'text/plain;charset=UTF-8'},body:JSON.stringify({action:'update-user',id_token:adminToken,employee_code:item.employee_code,full_name:item.full_name,contractor:item.contractor,role:'PICKER',active:true,source_position:item.source_position})});
      if(out?.ok!==true)throw new Error('WORKER_'+String(out?.error||'FAILED'));
      const uid=String(out?.profile?.id||''); if(!uid)throw new Error('PROFILE_ID_MISSING');
      await normalizeFirebase(googleAccess,uid,item);
      await markGsheet(uid,item); result.created++; result.firebase_normalized++; return;
    }catch(e){
      last=String(e.message);
      if(/EMAIL_EXISTS/.test(last)){
        try{
          const fresh=await firebaseUsersSnapshot(googleAccess); const found=fresh.find(u=>String(u.email||'').toLowerCase()===email);
          if(found){await adoptExistingAuth(item,found);return}
        }catch(adoptErr){last+='|ADOPT:'+String(adoptErr.message)}
      }
      if(attempt<3){result.retries++;await sleep(800*attempt)}
    }
  }
  const snap=await neon('worker_profiles_snapshot_rpc',{},adminToken).catch(()=>[]);
  const found=Array.isArray(snap)?snap.find(p=>String(p.employee_code||'')===item.employee_code):null;
  if(found){
    try{await normalizeFirebase(googleAccess,found.id,item);await markGsheet(found.id,item);result.created++;result.firebase_normalized++;return}catch(e){last+='|READBACK:'+String(e.message)}
  }
  result.failed++;result.errors.push(item.employee_code+':'+last.slice(0,180));
}

const concurrency=Math.min(8,Math.max(1,Number(process.env.STAFF_CREATE_CONCURRENCY||8)));
let cursor=0;
async function syncWorker(){
  while(true){
    const i=cursor++; if(i>=source.staff.length)return;
    const item=source.staff[i],old=byCode.get(item.employee_code);
    if(old)await updateExisting(old,item); else await createNew(item);
  }
}
await Promise.all(Array.from({length:concurrency},()=>syncWorker()));

profiles=await neon('worker_profiles_snapshot_rpc',{},adminToken);
firebaseUsers=await firebaseUsersSnapshot(googleAccess);
firebaseById=new Map(firebaseUsers.map(u=>[String(u.localId||''),u]));
const staleProfiles=profiles.filter(p=>p.source_kind==='GSHEET'&&!p.protected_account&&p.role!=='ADMIN'&&!sourceCodes.has(String(p.employee_code||'')));
if(staleProfiles.length>MAX_STALE_PROFILES)throw new Error('MASS_CHANGE_GUARD_STALE_TOTAL:'+staleProfiles.length);
let staleCursor=0;
async function staleWorker(){
  while(true){
    const i=staleCursor++; if(i>=staleProfiles.length)return;
    const p=staleProfiles[i],code=String(p.employee_code||'');
    try{
      const fu=firebaseById.get(String(p.id));
      if(!fu)throw new Error('FIREBASE_STALE_USER_MISSING');
      if(fu.disabled!==true){await firebaseUpdate(googleAccess,{localId:String(p.id),disableUser:true});result.firebase_disabled++}
      if(p.active===true){await neon('worker_profile_deactivate_rpc',{p_id:String(p.id),p_reason:'STAFF_SOURCE_MISSING'},adminToken);result.deactivated++}
    }catch(e){result.failed++;result.errors.push(code+':STALE:'+String(e.message).slice(0,150))}
  }
}
await Promise.all(Array.from({length:Math.min(8,Math.max(1,staleProfiles.length))},()=>staleWorker()));

const finalProfiles=await neon('worker_profiles_snapshot_rpc',{},adminToken);
const finalFirebase=await firebaseUsersSnapshot(googleAccess);
const finalFirebaseById=new Map(finalFirebase.map(u=>[String(u.localId||''),u]));
const finalByCode=new Map(finalProfiles.map(p=>[String(p.employee_code||''),p]));
const activeGsheet=finalProfiles.filter(p=>p.source_kind==='GSHEET'&&p.active===true);
const activeGsheetCodes=new Set(activeGsheet.map(p=>String(p.employee_code||'')));
const activeSetEqual=setEqual(activeGsheetCodes,sourceCodes);
const sourceMismatches=[];
const activeFirebaseMismatches=[];
for(const item of source.staff){
  const p=finalByCode.get(item.employee_code);
  if(!p||p.active!==true||p.source_kind!=='GSHEET'||p.full_name!==item.full_name||p.contractor!==item.contractor||p.role!=='PICKER'||String(p.source_position||'')!==item.source_position){sourceMismatches.push(item.employee_code);continue}
  const fu=finalFirebaseById.get(String(p.id)); if(firebaseNeedsNormalize(fu,item))activeFirebaseMismatches.push(item.employee_code);
}
const staleFinal=finalProfiles.filter(p=>p.source_kind==='GSHEET'&&!sourceCodes.has(String(p.employee_code||'')));
const staleNeonMismatch=staleFinal.filter(p=>p.active===true);
const staleFirebaseMismatch=staleFinal.filter(p=>finalFirebaseById.get(String(p.id))?.disabled!==true);
const manualAfterCount=finalProfiles.filter(p=>p.source_kind==='MANUAL').length;
const manualAfterDigest=manualDigest(finalProfiles,finalFirebaseById);
const manualPreserved=manualBeforeCount===manualAfterCount&&manualBeforeDigest===manualAfterDigest;
const protectedAdmins=finalProfiles.filter(p=>p.protected_account&&p.role==='ADMIN'&&p.active===true);
const massGuardPass=source.staff.length>=MIN_SOURCE_ROWS&&source.staff.length<=MAX_SOURCE_ROWS&&Number(source.meta.duplicate_count)===0&&Number(source.meta.invalid_count)===0&&staleProfiles.length<=MAX_STALE_PROFILES&&manualCollisions.length===0;
const markers={
  STAFF_SNAPSHOT_CAPTURE:source.meta?.digest&&Number(source.meta.unique_count)===source.staff.length?'PASS':'FAIL',
  STAFF_GSHEET_ACTIVE_SET_EQUAL:activeSetEqual&&sourceMismatches.length===0&&activeFirebaseMismatches.length===0?'PASS':'FAIL',
  STAFF_STALE_NEON_INACTIVE:staleNeonMismatch.length===0?'PASS':'FAIL',
  STAFF_STALE_FIREBASE_DISABLED:staleFirebaseMismatch.length===0?'PASS':'FAIL',
  STAFF_MANUAL_PRESERVED:manualPreserved?'PASS':'FAIL',
  STAFF_MASS_CHANGE_GUARD:massGuardPass?'PASS':'FAIL',
};
markers.STAFF_RECONCILIATION_READBACK=Object.values(markers).every(v=>v==='PASS')&&result.failed===0&&protectedAdmins.length===1?'PASS':'FAIL';
const mismatchCodes=[...new Set([...sourceMismatches,...activeFirebaseMismatches,...staleNeonMismatch.map(p=>String(p.employee_code||'')),...staleFirebaseMismatch.map(p=>String(p.employee_code||''))])];
const proof={
  status:markers.STAFF_RECONCILIATION_READBACK==='PASS'?'PASS':'FAIL',
  snapshot:{captured_at:source.meta.captured_at,rows:Number(source.meta.raw_rows),valid:Number(source.meta.valid_rows),unique:Number(source.meta.unique_count),duplicate:Number(source.meta.duplicate_count),invalid:Number(source.meta.invalid_count),digest:String(source.meta.digest)},
  neon:{gsheet_active_before:preActiveGsheet,gsheet_active_after:activeGsheet.length,gsheet_stale_total:staleFinal.length,gsheet_stale_inactive:staleFinal.length-staleNeonMismatch.length,total_profiles:finalProfiles.length,protected_admins:protectedAdmins.length},
  changes:{created:result.created,adopted_auth:result.adopted_auth,updated:result.updated,firebase_normalized:result.firebase_normalized,inactive:result.deactivated,firebase_disabled_this_run:result.firebase_disabled,unchanged:result.unchanged,retries:result.retries,failed:result.failed},
  firebase:{users_total:finalFirebase.length,gsheet_active_verified:source.staff.length-activeFirebaseMismatches.length,stale_disabled_total:staleFinal.length-staleFirebaseMismatch.length},
  manual:{before:manualBeforeCount,after:manualAfterCount,preserved:manualPreserved},
  mismatches:{count:mismatchCodes.length,tokens:mismatchCodes.slice(0,50).map(tokenFor),error_tokens:result.errors.slice(0,20).map(x=>tokenFor(x))},
  guards:{min_source_rows:MIN_SOURCE_ROWS,max_source_rows:MAX_SOURCE_ROWS,max_stale_profiles:MAX_STALE_PROFILES},
  markers
};
fs.writeFileSync('ops/full-staff-sync-last.json',JSON.stringify(proof,null,2)+'\n');
for(const [k,v] of Object.entries(markers))console.log(k+'='+v);
console.log('snapshot_digest='+proof.snapshot.digest);
console.log('source_unique='+proof.snapshot.unique);
console.log('gsheet_active_before='+proof.neon.gsheet_active_before);
console.log('gsheet_active_after='+proof.neon.gsheet_active_after);
console.log('stale_inactive='+proof.neon.gsheet_stale_inactive);
console.log('manual_before='+proof.manual.before);
console.log('manual_after='+proof.manual.after);
console.log('created='+proof.changes.created);
console.log('updated='+proof.changes.updated);
console.log('inactive='+proof.changes.inactive);
console.log('firebase_disabled_this_run='+proof.changes.firebase_disabled_this_run);
console.log('mismatch_count='+proof.mismatches.count);
if(proof.status!=='PASS')process.exitCode=2;
