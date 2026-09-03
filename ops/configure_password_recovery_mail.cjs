'use strict';
const fs=require('fs');
const crypto=require('crypto');

const PROJECT='bao-hang-1291';
const ADMIN_UID='44fae0a2-09eb-4226-8412-0f1a1f5d7ef8';
const RECOVERY_EMAIL='tam95.supra@gmail.com';
const WEBHOOK=String(process.env.GOOGLE_SHEET_WEBHOOK_URL||'').trim();
const enc=v=>Buffer.from(typeof v==='string'?v:JSON.stringify(v)).toString('base64url');
const safe=v=>String(v??'').replace(/Bearer\s+[A-Za-z0-9._-]+/gi,'Bearer [REDACTED]').replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g,'[JWT_REDACTED]').slice(0,400);

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
function addCandidate(list,label,id,secret,refresh){
  id=String(id||'').trim();secret=String(secret||'').trim();refresh=String(refresh||'').trim();
  if(id&&secret&&refresh)list.push({label,id,secret,refresh});
}
function fromJson(raw,label){
  const out=[];if(!String(raw||'').trim())return out;
  let obj;try{obj=JSON.parse(String(raw));}catch{return out;}
  const tokens=obj?.tokens;
  if(tokens&&typeof tokens==='object')for(const [name,v] of Object.entries(tokens||{})){
    if(v&&typeof v==='object')addCandidate(out,label+(name==='default'?'':'_TOKENSET'),v.client_id||v.clientId,v.client_secret||v.clientSecret,v.refresh_token||v.refreshToken);
  }
  const token=obj?.token&&typeof obj.token==='object'?obj.token:{};
  const settings=obj?.oauth2ClientSettings&&typeof obj.oauth2ClientSettings==='object'?obj.oauth2ClientSettings:{};
  addCandidate(out,label+'_SETTINGS',settings.clientId||settings.client_id,settings.clientSecret||settings.client_secret,token.refresh_token||token.refreshToken);
  addCandidate(out,label+'_FLAT',obj?.client_id||obj?.clientId,obj?.client_secret||obj?.clientSecret,obj?.refresh_token||obj?.refreshToken);
  return out;
}
function candidates(){
  const list=[];
  addCandidate(list,'GOOGLE_OAUTH',process.env.GOOGLE_OAUTH_CLIENT_ID,process.env.GOOGLE_OAUTH_CLIENT_SECRET,process.env.GOOGLE_OAUTH_REFRESH_TOKEN);
  addCandidate(list,'APPS_SCRIPT_OAUTH',process.env.APPS_SCRIPT_OAUTH_CLIENT_ID,process.env.APPS_SCRIPT_OAUTH_CLIENT_SECRET,process.env.APPS_SCRIPT_OAUTH_REFRESH_TOKEN);
  list.push(...fromJson(process.env.CLASPRC_JSON,'CLASPRC_JSON'));
  list.push(...fromJson(process.env.CLASP_TOKEN,'CLASP_TOKEN'));
  const seen=new Set();
  return list.filter(c=>{const k=crypto.createHash('sha256').update(c.id+'\0'+c.refresh).digest('hex');if(seen.has(k))return false;seen.add(k);return true;});
}
async function refreshAccess(candidate){
  const token=await jsonFetch('https://oauth2.googleapis.com/token',{
    method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({client_id:candidate.id,client_secret:candidate.secret,refresh_token:candidate.refresh,grant_type:'refresh_token'})
  });
  if(!token.access_token)throw new Error('ACCESS_TOKEN_MISSING');
  return token.access_token;
}
async function gmailProbe(access,label){
  const raw=[
    `To: ${RECOVERY_EMAIL}`,
    'Subject: [Bao Hang 1291] Kiem tra cau hinh lay lai mat khau',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    'Day la email kiem tra mot lan de xac minh kenh gui mat khau tam cua Bao Hang 1291. Khong can thao tac.'
  ].join('\r\n');
  const r=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{
    method:'POST',headers:{authorization:`Bearer ${access}`,'content-type':'application/json'},
    body:JSON.stringify({raw:Buffer.from(raw,'utf8').toString('base64url')}),
    signal:AbortSignal.timeout(20000)
  });
  if(!r.ok){
    console.log(`PASSWORD_RESET_OAUTH_CANDIDATE_${label}=GMAIL_SEND_DENIED_${r.status}`);
    return false;
  }
  console.log(`PASSWORD_RESET_OAUTH_CANDIDATE_${label}=GMAIL_SEND_OK`);
  return true;
}
async function gasRaw(idToken,action,extra={}){
  const r=await fetch(WEBHOOK,{
    method:'POST',headers:{'content-type':'text/plain;charset=UTF-8'},
    body:JSON.stringify({action,id_token:idToken,...extra}),signal:AbortSignal.timeout(40000)
  });
  const text=await r.text();let out={};try{out=text?JSON.parse(text):{}}catch{out={error:'INVALID_JSON'}}
  if(!r.ok)throw new Error(`GAS_HTTP_${r.status}`);
  return out;
}
async function gas(idToken,action,extra={}){
  const out=await gasRaw(idToken,action,extra);
  if(out.ok!==true)throw new Error(`GAS_${action}_FAILED:${safe(out.error||JSON.stringify(out))}`);
  return out;
}

(async()=>{
  if(!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(WEBHOOK))throw new Error('WEBHOOK_SCOPE_INVALID');
  const sa=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT||'{}');
  if(sa.project_id!==PROJECT||!sa.client_email||!sa.private_key)throw new Error('FIREBASE_SERVICE_ACCOUNT_SCOPE');
  const idToken=await adminIdToken(sa);

  const existing=await gasRaw(idToken,'password-reset-mail-capability');
  if(existing.ok===true&&existing.provider==='GMAIL_API_OAUTH'&&existing.recovery_email===RECOVERY_EMAIL&&existing.send_scope_verified===true){
    console.log('PASSWORD_RESET_MAIL_OAUTH_CONFIG=PASS mode=EXISTING_VERIFIED provider=GMAIL_API_OAUTH');
    return;
  }

  let chosen=null;
  for(const candidate of candidates()){
    try{
      const access=await refreshAccess(candidate);
      console.log(`PASSWORD_RESET_OAUTH_CANDIDATE_${candidate.label}=REFRESH_OK`);
      if(await gmailProbe(access,candidate.label)){chosen=candidate;break;}
    }catch(e){
      console.log(`PASSWORD_RESET_OAUTH_CANDIDATE_${candidate.label}=UNAVAILABLE`);
    }
  }
  if(!chosen)throw new Error('GMAIL_SEND_OAUTH_SCOPE_MISSING');

  await gas(idToken,'password-reset-mail-oauth-configure',{
    client_id:chosen.id,client_secret:chosen.secret,refresh_token:chosen.refresh,scope_verified:'gmail.send'
  });
  const check=await gas(idToken,'password-reset-mail-capability');
  if(check.provider!=='GMAIL_API_OAUTH'||check.recovery_email!==RECOVERY_EMAIL||check.send_scope_verified!==true)throw new Error('PASSWORD_RESET_MAIL_CAPABILITY_MISMATCH');
  console.log(`PASSWORD_RESET_MAIL_OAUTH_CONFIG=PASS mode=NEW_VERIFIED provider=${check.provider} candidate=${chosen.label}`);
})().catch(e=>{console.error(`PASSWORD_RESET_MAIL_OAUTH_CONFIG=FAIL ${safe(e?.message||e)}`);process.exit(1);});
