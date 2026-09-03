'use strict';
const fs=require('fs');
const crypto=require('crypto');
const {initializeApp,cert,deleteApp}=require('firebase-admin/app');
const {getAuth}=require('firebase-admin/auth');

const PROJECT='bao-hang-1291';
const ADMIN_UID='44fae0a2-09eb-4226-8412-0f1a1f5d7ef8';
const NEON=process.env.NEON_DATA_API||'https://ep-morning-bread-az3w94qb.apirest.c-3.ap-southeast-1.aws.neon.tech/neondb/rest/v1';
const outPath=process.env.CLEANUP_EVIDENCE||'acceptance-evidence/staff-orphan-cleanup-direct.json';
const enc=v=>Buffer.from(typeof v==='string'?v:JSON.stringify(v)).toString('base64url');
const safe=v=>String(v??'').replace(/Bearer\s+[A-Za-z0-9._-]+/gi,'Bearer [REDACTED]').replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g,'[JWT_REDACTED]').slice(0,500);

function sign(sa,payload){const h=enc({alg:'RS256',typ:'JWT'}),p=enc(payload),u=`${h}.${p}`;return `${u}.${crypto.sign('RSA-SHA256',Buffer.from(u),sa.private_key).toString('base64url')}`;}
async function req(url,opt={},ms=30000){const r=await fetch(url,{...opt,signal:AbortSignal.timeout(ms)}),text=await r.text();let data={};try{data=text?JSON.parse(text):{}}catch{data={raw:safe(text)}}if(!r.ok)throw new Error(`HTTP_${r.status}:${safe(data?.message||data?.error||data?.raw||text)}`);return data;}
async function adminToken(sa){
  const cfg=JSON.parse(fs.readFileSync('app/google-services.json','utf8'));
  const key=cfg.client?.[0]?.api_key?.[0]?.current_key;
  if(!key)throw new Error('FIREBASE_WEB_API_KEY_MISSING');
  const now=Math.floor(Date.now()/1000);
  const token=sign(sa,{iss:sa.client_email,sub:sa.client_email,aud:'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',iat:now,exp:now+900,uid:ADMIN_UID});
  const x=await req(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(key)}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token,returnSecureToken:true})});
  if(!x.idToken)throw new Error('ADMIN_ID_TOKEN_MISSING');
  return x.idToken;
}
async function rpc(token,name,payload={}){
  const data=await req(`${NEON}/rpc/${encodeURIComponent(name)}`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify(payload)},30000);
  return Array.isArray(data)&&data.length===1&&typeof data[0]==='object'&&data[0]!==null&&Object.keys(data[0]).length===1?Object.values(data[0])[0]:data;
}
async function pool(items,limit,fn){
  let index=0;
  const workers=Array.from({length:Math.min(limit,items.length||1)},async()=>{while(true){const i=index++;if(i>=items.length)return;await fn(items[i],i);}});
  await Promise.all(workers);
}
(async()=>{
  if(!NEON.includes('ep-morning-bread-az3w94qb.apirest.c-3.ap-southeast-1.aws.neon.tech'))throw new Error('NEON_SCOPE_MISMATCH');
  const sa=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT||'{}');
  if(sa.project_id!==PROJECT||!sa.client_email||!sa.private_key)throw new Error('FIREBASE_SERVICE_ACCOUNT_SCOPE');
  const token=await adminToken(sa);
  const snapshotRaw=await rpc(token,'worker_profiles_snapshot_rpc',{});
  const profiles=Array.isArray(snapshotRaw)?snapshotRaw:(Array.isArray(snapshotRaw?.profiles)?snapshotRaw.profiles:[]);
  const candidates=profiles.filter(p=>p&&p.active===false&&String(p.source_kind||'')==='GSHEET'&&!p.protected_account&&String(p.role||'')!=='ADMIN');
  const app=initializeApp({credential:cert(sa)},`staff-orphan-cleanup-${Date.now()}`);
  const auth=getAuth(app);
  const result={checked:0,purged:0,retained_history:0,failed:0,errors:[]};
  try{
    await pool(candidates,6,async(profile)=>{
      try{
        const id=String(profile.id||'');
        const dryRaw=await rpc(token,'worker_profile_purge_if_orphan_rpc',{p_id:id,p_execute:false});
        const dry=Array.isArray(dryRaw)?dryRaw[0]:dryRaw;
        result.checked++;
        if(!dry?.eligible){result.retained_history++;return;}
        try{await auth.deleteUser(id);}catch(e){if(e?.code!=='auth/user-not-found')throw e;}
        const doneRaw=await rpc(token,'worker_profile_purge_if_orphan_rpc',{p_id:id,p_execute:true});
        const done=Array.isArray(doneRaw)?doneRaw[0]:doneRaw;
        if(done?.purged===true)result.purged++;
        else throw new Error(`PURGE_NOT_CONFIRMED:${safe(JSON.stringify(done))}`);
      }catch(e){result.failed++;if(result.errors.length<20)result.errors.push(`${profile.employee_code||profile.id}:${safe(e?.message||e)}`);}
    });
  }finally{await deleteApp(app).catch(()=>{});}
  const verifyRaw=await rpc(token,'worker_profiles_snapshot_rpc',{});
  const verify=Array.isArray(verifyRaw)?verifyRaw:(Array.isArray(verifyRaw?.profiles)?verifyRaw.profiles:[]);
  const remaining=verify.filter(p=>p&&p.active===false&&String(p.source_kind||'')==='GSHEET'&&!p.protected_account&&String(p.role||'')!=='ADMIN').length;
  const evidence={status:result.failed===0?'PASS':'FAIL',captured_at:new Date().toISOString(),...result,remaining_inactive_gsheet:remaining};
  fs.mkdirSync(require('path').dirname(outPath),{recursive:true});
  fs.writeFileSync(outPath,JSON.stringify(evidence,null,2)+'\n');
  console.log(`STAFF_ORPHAN_CHECKED=${result.checked}`);
  console.log(`STAFF_ORPHAN_PURGED=${result.purged}`);
  console.log(`STAFF_ORPHAN_RETAINED_HISTORY=${result.retained_history}`);
  console.log(`STAFF_ORPHAN_REMAINING_INACTIVE=${remaining}`);
  if(result.failed)throw new Error(`STAFF_ORPHAN_CLEANUP_FAILED:${result.failed}`);
  console.log('STAFF_ORPHAN_DIRECT_CLEANUP=PASS');
})().catch(e=>{console.error(`STAFF_ORPHAN_DIRECT_CLEANUP=FAIL ${safe(e?.message||e)}`);process.exit(1);});
