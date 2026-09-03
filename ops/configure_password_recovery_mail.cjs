'use strict';
const fs=require('fs');
const crypto=require('crypto');

const PROJECT='bao-hang-1291';
const ADMIN_UID='44fae0a2-09eb-4226-8412-0f1a1f5d7ef8';
const WEBHOOK=String(process.env.GOOGLE_SHEET_WEBHOOK_URL||'').trim();
const enc=v=>Buffer.from(typeof v==='string'?v:JSON.stringify(v)).toString('base64url');
const safe=v=>String(v??'').replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g,'[JWT_REDACTED]').slice(0,400);

async function jsonFetch(url,opt={},timeout=20000){
  const r=await fetch(url,{...opt,signal:AbortSignal.timeout(timeout)});
  const text=await r.text();let data={};try{data=text?JSON.parse(text):{}}catch{data={raw:safe(text)}}
  if(!r.ok)throw new Error(`HTTP_${r.status}:${safe(data?.error?.message||data?.error||data?.raw||text)}`);
  return data;
}
function sign(sa,payload){
  const h=enc({alg:'RS256',typ:'JWT'}),p=enc(payload),u=`${h}.${p}`;
  return `${u}.${crypto.sign('RSA-SHA256',Buffer.from(u),sa.private_key).toString('base64url')}`;
}
async function adminIdToken(sa){
  const cfg=JSON.parse(fs.readFileSync('app/google-services.json','utf8'));
  const key=cfg.client?.[0]?.api_key?.[0]?.current_key;
  if(!key)throw new Error('FIREBASE_WEB_API_KEY_MISSING');
  const now=Math.floor(Date.now()/1000);
  const custom=sign(sa,{iss:sa.client_email,sub:sa.client_email,aud:'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',iat:now,exp:now+900,uid:ADMIN_UID});
  const out=await jsonFetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(key)}`,{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:custom,returnSecureToken:true})
  });
  if(!out.idToken)throw new Error('ADMIN_ID_TOKEN_MISSING');
  return out.idToken;
}
async function oauthCandidate(label,id,secret,refresh){
  if(!id||!secret||!refresh)return null;
  try{
    const token=await jsonFetch('https://oauth2.googleapis.com/token',{
      method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({client_id:id,client_secret:secret,refresh_token:refresh,grant_type:'refresh_token'})
    });
    if(!token.access_token)return null;
    const info=await jsonFetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token.access_token)}`);
    const scopes=String(info.scope||'').split(/\s+/).filter(Boolean);
    const canSend=scopes.includes('https://www.googleapis.com/auth/gmail.send')||scopes.includes('https://mail.google.com/');
    console.log(`PASSWORD_RESET_OAUTH_CANDIDATE_${label}=${canSend?'GMAIL_SEND_OK':'NO_GMAIL_SEND'}`);
    return canSend?{label,id,secret,refresh}:null;
  }catch(e){
    console.log(`PASSWORD_RESET_OAUTH_CANDIDATE_${label}=UNAVAILABLE`);
    return null;
  }
}
async function gas(idToken,action,extra={}){
  const out=await jsonFetch(WEBHOOK,{
    method:'POST',headers:{'content-type':'text/plain;charset=UTF-8'},
    body:JSON.stringify({action,id_token:idToken,...extra})
  },40000);
  if(out.ok!==true)throw new Error(`GAS_${action}_FAILED:${safe(out.error||JSON.stringify(out))}`);
  return out;
}

(async()=>{
  if(!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(WEBHOOK))throw new Error('WEBHOOK_SCOPE_INVALID');
  const sa=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT||'{}');
  if(sa.project_id!==PROJECT||!sa.client_email||!sa.private_key)throw new Error('FIREBASE_SERVICE_ACCOUNT_SCOPE');
  const candidates=[
    ['GOOGLE_OAUTH',process.env.GOOGLE_OAUTH_CLIENT_ID,process.env.GOOGLE_OAUTH_CLIENT_SECRET,process.env.GOOGLE_OAUTH_REFRESH_TOKEN],
    ['APPS_SCRIPT_OAUTH',process.env.APPS_SCRIPT_OAUTH_CLIENT_ID,process.env.APPS_SCRIPT_OAUTH_CLIENT_SECRET,process.env.APPS_SCRIPT_OAUTH_REFRESH_TOKEN],
  ];
  let chosen=null;
  for(const args of candidates){chosen=await oauthCandidate(...args);if(chosen)break;}
  if(!chosen)throw new Error('GMAIL_SEND_OAUTH_SCOPE_MISSING');
  const idToken=await adminIdToken(sa);
  await gas(idToken,'password-reset-mail-oauth-configure',{
    client_id:chosen.id,client_secret:chosen.secret,refresh_token:chosen.refresh,scope_verified:'gmail.send'
  });
  const check=await gas(idToken,'password-reset-mail-capability');
  if(check.provider!=='GMAIL_API_OAUTH'||check.recovery_email!=='tam95.supra@gmail.com'||check.send_scope_verified!==true)throw new Error('PASSWORD_RESET_MAIL_CAPABILITY_MISMATCH');
  console.log(`PASSWORD_RESET_MAIL_OAUTH_CONFIG=PASS provider=${check.provider} email=${check.recovery_email} candidate=${chosen.label}`);
})().catch(e=>{console.error(`PASSWORD_RESET_MAIL_OAUTH_CONFIG=FAIL ${safe(e?.message||e)}`);process.exit(1);});
