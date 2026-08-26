'use strict';
const fs = require('fs');
const crypto = require('crypto');
const { initializeApp, cert, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

const PROJECT = 'bao-hang-1291';
const ADMIN_UID = '44fae0a2-09eb-4226-8412-0f1a1f5d7ef8';
const NEON = process.env.NEON_DATA_API || '';
const USERS = [
  { uid:'12910000-0000-4000-8000-00000000e2e1', email:'e2eweb1291@bao-hang-1291.local' },
  { uid:'12910000-0000-4000-8000-00000000e2e2', email:'e2epicker2@bao-hang-1291.local' },
  { uid:'12910000-0000-4000-8000-00000000e2e3', email:'e2einvent@bao-hang-1291.local' },
  { uid:'12910000-0000-4000-8000-00000000e2e4', email:'e2eadmininvent@bao-hang-1291.local' },
];
const IDS = USERS.map(x => x.uid);
const SKUS = ['99001291','99001292'];
const CODES = ['e2eweb1291','e2epicker2','e2einvent','e2eadmininvent'];
const safe = v => String(v ?? '').replace(/Bearer\s+[A-Za-z0-9._-]+/gi,'Bearer [REDACTED]').replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g,'[JWT_REDACTED]').slice(0,900);
const b64 = v => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
function signJwt(sa,payload){ const h=b64({alg:'RS256',typ:'JWT'}),p=b64(payload),u=`${h}.${p}`,s=crypto.sign('RSA-SHA256',Buffer.from(u),sa.private_key).toString('base64url'); return `${u}.${s}`; }
async function request(url,opt={},timeout=15000){ const r=await fetch(url,{...opt,signal:AbortSignal.timeout(timeout)}); const text=await r.text(); let data={}; try{data=text?JSON.parse(text):{}}catch{data={raw:safe(text)}} if(!r.ok) throw new Error(`HTTP_${r.status}:${safe(data?.error?.message||data?.error||data?.message||data?.raw||text)}`); return {status:r.status,data}; }
async function adminIdToken(sa){
  const cfg=JSON.parse(fs.readFileSync('app/google-services.json','utf8'));
  const apiKey=cfg.client?.[0]?.api_key?.[0]?.current_key;
  if(!apiKey) throw new Error('FIREBASE_WEB_API_KEY_MISSING');
  const now=Math.floor(Date.now()/1000);
  const custom=signJwt(sa,{iss:sa.client_email,sub:sa.client_email,aud:'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',iat:now,exp:now+900,uid:ADMIN_UID});
  const out=await request(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(apiKey)}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:custom,returnSecureToken:true})});
  if(!out.data?.idToken) throw new Error('ADMIN_ID_TOKEN_MISSING');
  return out.data.idToken;
}
async function rpc(token,name){ return (await request(`${NEON}/rpc/${name}`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:'{}'})).data; }
async function del(token,table,column,values){
  const url=new URL(`${NEON}/${table}`);
  url.searchParams.set(column,`in.(${values.join(',')})`);
  const r=await fetch(url,{method:'DELETE',headers:{authorization:`Bearer ${token}`,'x-e2e-cleanup':'final-1291',prefer:'return=minimal'},signal:AbortSignal.timeout(15000)});
  const text=await r.text();
  if(!r.ok) throw new Error(`DELETE_${table}_${column}_HTTP_${r.status}:${safe(text)}`);
  console.log(`CLEANUP_DELETE=PASS table=${table} filter=${column}`);
}
async function cleanupFirebase(auth){
  let remaining=0;
  for(const user of USERS){
    try{
      const current=await auth.getUser(user.uid);
      if(current.email!==user.email || !String(current.displayName||'').startsWith('__E2E_')) throw new Error(`FIREBASE_MARKER_MISMATCH_${user.uid}`);
      await auth.deleteUser(user.uid);
    }catch(error){ if(error?.code!=='auth/user-not-found') throw error; }
  }
  for(const user of USERS){ try{ await auth.getUser(user.uid); remaining++; }catch(error){ if(error?.code!=='auth/user-not-found') throw error; } }
  console.log(`TEST_FIREBASE_USERS_REMAINING=${remaining}`);
  if(remaining!==0) throw new Error(`FIREBASE_USERS_REMAIN_${remaining}`);
}
function assertReadback(x){
  const map=[
    ['TEST_SKU_REMAINING','test_sku_remaining'],
    ['TEST_PROFILE_REMAINING','test_profile_remaining'],
    ['TEST_REPORT_REMAINING','test_report_remaining'],
    ['TEST_OWNERSHIP_REMAINING','test_ownership_remaining'],
    ['TEST_EVENT_REMAINING','test_event_remaining'],
    ['TEST_NOTIFICATION_REMAINING','test_notification_remaining'],
    ['TEST_REALTIME_SIGNAL_REMAINING','test_realtime_signal_remaining'],
  ];
  let ok=true;
  for(const [marker,key] of map){ const n=Number(x?.[key] ?? -1); console.log(`${marker}=${n}`); if(n!==0) ok=false; }
  if(x?.real_user_10060_preserved===true) console.log('REAL_USER_10060_PRESERVED=PASS'); else { console.log('REAL_USER_10060_PRESERVED=FAIL'); ok=false; }
  if(!ok) throw new Error(`CLEANUP_READBACK_NONZERO:${safe(JSON.stringify(x))}`);
  console.log('TEST_CLEANUP_READBACK=PASS');
}
async function main(){
  if(!NEON.includes('ep-morning-bread-az3w94qb.apirest.c-3.ap-southeast-1.aws.neon.tech')) throw new Error('NEON_SCOPE_MISMATCH');
  const sa=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT||'{}');
  if(sa.project_id!==PROJECT || !sa.client_email || !sa.private_key) throw new Error('FIREBASE_SERVICE_ACCOUNT_SCOPE');
  const app=initializeApp({credential:cert(sa)},`final-cleanup-${Date.now()}`),auth=getAuth(app);
  let failure=null;
  try{
    console.log('CLEANUP_STAGE=ADMIN_TOKEN:BEGIN');
    const token=await adminIdToken(sa);
    console.log('CLEANUP_STAGE=ADMIN_TOKEN:PASS');
    console.log('CLEANUP_STAGE=MARKER_GUARD:BEGIN');
    const guard=await rpc(token,'e2e_final_guard_rpc');
    if(guard?.ok!==true || guard?.real_user_10060_preserved!==true) throw new Error(`MARKER_GUARD_FAILED:${safe(JSON.stringify(guard))}`);
    console.log('E2E_MARKER_GUARD=PASS');
    console.log('CLEANUP_STAGE=NEON_EXACT_DELETE:BEGIN');
    const operations=[
      ['authority_events','actor_account_id',IDS],['authority_events','sku',SKUS],
      ['reconciliation_conflicts','actor_account_id',IDS],['reconciliation_conflicts','sku',SKUS],
      ['sheet_export_queue','actor_account_id',IDS],['sheet_export_queue','sku',SKUS],
      ['mutation_requests','actor_id',IDS],
      ['security_audit','actor_id',IDS],['security_audit','target_id',IDS],
      ['issues','sku',SKUS],
      ['realtime_events','entity_id',IDS],['realtime_events','payload->>sku',SKUS],['realtime_events','payload->>employee_code',CODES],
      ['sku_catalog','sku',SKUS],
      ['profiles','id',IDS],
    ];
    for(const op of operations) await del(token,...op);
    console.log('CLEANUP_STAGE=NEON_EXACT_DELETE:PASS');
    console.log('CLEANUP_STAGE=FIREBASE_USERS:BEGIN');
    await cleanupFirebase(auth);
    console.log('CLEANUP_STAGE=FIREBASE_USERS:PASS');
    console.log('CLEANUP_STAGE=READBACK:BEGIN');
    const readback=await rpc(token,'e2e_final_readback_rpc');
    assertReadback(readback);
    console.log('CLEANUP_STAGE=READBACK:PASS');
  }catch(error){ failure=error; console.error(`FINAL_CLEANUP_FAILURE ${safe(error?.stack||error)}`); try{ await cleanupFirebase(auth); }catch(e){ console.error(`FIREBASE_FINALLY_FAILURE ${safe(e?.message||e)}`); } }
  finally{ await deleteApp(app).catch(()=>{}); }
  if(failure) throw failure;
}
main().catch(error=>{ console.error(`FINAL_CLEANUP_FATAL ${safe(error?.message||error)}`); process.exitCode=1; });
