'use strict';

const fs = require('fs');
const crypto = require('crypto');

const PROJECT = 'bao-hang-1291';
const ADMIN_UID = '44fae0a2-09eb-4226-8412-0f1a1f5d7ef8';
const NEON = String(process.env.NEON_DATA_API || '').replace(/\/$/, '');
const GAS = String(process.env.GOOGLE_SHEET_WEBHOOK_URL || '');
const RUN_ID = '66f8cebc-d3ac-4fc5-82a6-82cc1551ac04';
const MARKER = 'RESTORE_PRE_VALIDATION_502_20260903';
const safe = (v) => String(v ?? '').replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]').replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, '[JWT_REDACTED]').slice(0, 800);
const enc = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

function signJwt(sa, payload) {
  const h = enc({alg:'RS256',typ:'JWT'});
  const p = enc(payload);
  const u = `${h}.${p}`;
  const s = crypto.sign('RSA-SHA256', Buffer.from(u), sa.private_key).toString('base64url');
  return `${u}.${s}`;
}

async function jsonRequest(url, init = {}, ms = 30000) {
  const r = await fetch(url, {...init, signal:AbortSignal.timeout(ms)});
  const text = await r.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = {raw:safe(text)}; }
  return {r,data};
}

async function authPair(sa, apiKey) {
  const now = Math.floor(Date.now()/1000);
  const custom = signJwt(sa, {
    iss:sa.client_email, sub:sa.client_email,
    aud:'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat:now, exp:now+900, uid:ADMIN_UID
  });
  const {r,data} = await jsonRequest(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(apiKey)}`, {
    method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({token:custom,returnSecureToken:true})
  }, 15000);
  if (!r.ok || !data.idToken || !data.refreshToken) throw new Error(`FIREBASE_CUSTOM_TOKEN_${r.status}:${safe(data?.error?.message)}`);
  return {idToken:data.idToken,refreshToken:data.refreshToken};
}

async function refreshPair(apiKey, pair) {
  const {r,data} = await jsonRequest(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`, {
    method:'POST',
    headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'refresh_token',refresh_token:pair.refreshToken})
  }, 15000);
  if (!r.ok || !data.id_token || !data.refresh_token) throw new Error(`FIREBASE_REFRESH_${r.status}:${safe(data?.error?.message)}`);
  return {idToken:data.id_token,refreshToken:data.refresh_token};
}

async function gas(pair, apiKey, payload, timeoutMs = 45000) {
  let last;
  for (let attempt=1; attempt<=4; attempt++) {
    try {
      const {r,data} = await jsonRequest(GAS, {
        method:'POST',
        headers:{'content-type':'text/plain;charset=UTF-8'},
        body:JSON.stringify({...payload,id_token:pair.idToken})
      }, timeoutMs);
      if (!r.ok) throw new Error(`GAS_HTTP_${r.status}`);
      if (data?.ok !== true) {
        const detail = String(data?.error || '') + ' ' + JSON.stringify(data?.errors || []);
        if (/AUTH_REQUIRED/.test(detail)) {
          pair = await refreshPair(apiKey,pair);
          await new Promise(resolve=>setTimeout(resolve,1200*attempt));
          last = new Error('GAS_AUTH_REQUIRED_RETRY');
          continue;
        }
        if (/FIREBASE_ADMIN_5\d\d|service is currently unavailable|UNAVAILABLE|backendError|503/i.test(detail) && attempt < 4) {
          console.log(`STAFF_RECOVERY_TRANSIENT_RETRY attempt=${attempt}`);
          await new Promise(resolve=>setTimeout(resolve,2000*attempt));
          last = new Error('GAS_TRANSIENT_RETRY');
          continue;
        }
        throw new Error(`GAS_ACTION_FAIL:${safe(data?.error || JSON.stringify(data))}`);
      }
      return {pair,data};
    } catch (error) {
      last=error;
      if (attempt===4) break;
      if (/timeout|aborted|AUTH_REQUIRED|NETWORK|fetch/i.test(String(error?.message||error))) {
        pair=await refreshPair(apiKey,pair).catch(()=>pair);
        await new Promise(resolve=>setTimeout(resolve,1200*attempt));
        continue;
      }
      throw error;
    }
  }
  throw last;
}

async function snapshot(pair, apiKey) {
  for (let attempt=1; attempt<=4; attempt++) {
    const {r,data} = await jsonRequest(`${NEON}/rpc/worker_profiles_snapshot_rpc`, {
      method:'POST',
      headers:{'content-type':'application/json',authorization:`Bearer ${pair.idToken}`},
      body:'{}'
    }, 20000);
    if (r.ok && Array.isArray(data)) return {pair,profiles:data};
    const msg=safe(data?.message || data?.error || JSON.stringify(data));
    if (/AUTH_REQUIRED/.test(msg) && attempt<4) {
      pair=await refreshPair(apiKey,pair);
      await new Promise(resolve=>setTimeout(resolve,1000*attempt));
      continue;
    }
    throw new Error(`NEON_SNAPSHOT_${r.status}:${msg}`);
  }
  throw new Error('NEON_SNAPSHOT_RETRY_EXHAUSTED');
}

(async()=>{
  if (!NEON.includes('ep-morning-bread-az3w94qb.apirest.c-3.ap-southeast-1.aws.neon.tech')) throw new Error('NEON_SCOPE_MISMATCH');
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(GAS)) throw new Error('GAS_URL_INVALID');
  const sa=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (sa.project_id!==PROJECT || !sa.client_email || !sa.private_key) throw new Error('FIREBASE_SCOPE_INVALID');
  const cfg=JSON.parse(fs.readFileSync('app/google-services.json','utf8'));
  const apiKey=cfg.client?.[0]?.api_key?.[0]?.current_key;
  if (!apiKey) throw new Error('FIREBASE_API_KEY_MISSING');

  let pair=await authPair(sa,apiKey);
  let cursor='';
  let totalCreated=0,totalReactivated=0;
  for (let batch=1; batch<=40; batch++) {
    const out=await gas(pair,apiKey,{
      action:'staff-recovery-current-source',
      recovery_marker:MARKER,
      after_code:cursor,
      limit:10,
      finalize_run_id:RUN_ID
    },55000);
    pair=out.pair;
    const d=out.data;
    totalCreated+=Number(d.created||0);
    totalReactivated+=Number(d.reactivated||0);
    console.log(`STAFF_RECOVERY_BATCH=${batch} checked=${Number(d.checked||0)} created=${Number(d.created||0)} reactivated=${Number(d.reactivated||0)} remaining=${Number(d.remaining||0)} active=${Number(d.active_gsheet||0)} inactive=${Number(d.inactive_gsheet||0)}`);
    if (Number(d.failed||0)>0) throw new Error(`STAFF_RECOVERY_BATCH_FAILED:${safe(JSON.stringify(d.errors||[]))}`);
    if (d.has_more===false || Number(d.remaining||0)===0) break;
    const next=String(d.next_after_code||'');
    if (!next) {
      cursor='';
      await new Promise(resolve=>setTimeout(resolve,1000));
    } else {
      cursor=next;
    }
    pair=await refreshPair(apiKey,pair);
  }

  let snap=await snapshot(pair,apiKey); pair=snap.pair;
  const profiles=snap.profiles;
  const activeG=profiles.filter(p=>p?.source_kind==='GSHEET' && p?.active===true).length;
  const inactiveG=profiles.filter(p=>p?.source_kind==='GSHEET' && p?.active===false).length;
  const activeM=profiles.filter(p=>p?.source_kind==='MANUAL' && p?.active===true).length;
  console.log(`STAFF_RECOVERY_FINAL_COUNTS active_gsheet=${activeG} inactive_gsheet=${inactiveG} active_manual=${activeM}`);
  if (activeG!==502 || inactiveG!==97 || activeM!==3) throw new Error(`STAFF_RECOVERY_COUNT_MISMATCH:${activeG}/${inactiveG}/${activeM}`);

  const {r:runRes,data:runData}=await jsonRequest(`${NEON}/rpc/api_staff_sync_status_rpc`,{
    method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${pair.idToken}`},body:JSON.stringify({p_test_role:null,p_limit:5})
  },20000);
  if(!runRes.ok) throw new Error(`STAFF_SYNC_STATUS_HTTP_${runRes.status}:${safe(JSON.stringify(runData))}`);
  const stale=(runData?.runs||[]).find(x=>String(x.id||'')===RUN_ID);
  if(stale && stale.status==='RUNNING') throw new Error('ACCIDENTAL_SYNC_RUN_STILL_RUNNING');

  console.log(`STAFF_RECOVERY_TOTAL created=${totalCreated} reactivated=${totalReactivated}`);
  console.log('STAFF_RECOVERY_PRE_VALIDATION_BASELINE=PASS');
})().catch(error=>{
  console.error(`STAFF_RECOVERY_PRE_VALIDATION_BASELINE=FAIL ${safe(error?.message||error)}`);
  process.exitCode=1;
});
