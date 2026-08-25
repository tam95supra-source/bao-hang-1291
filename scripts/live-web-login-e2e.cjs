'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const target = path.join(__dirname, 'live-web-login-e2e-v2.cjs');
let patched = fs.readFileSync(target, 'utf8');

function replaceOnce(label, before, after) {
  if (!patched.includes(before)) throw new Error(`${label}_PATCH_TARGET_MISSING`);
  patched = patched.replace(before, after);
}

replaceOnce(
  'E2E_TOKEN_META',
  "function meta(token){const [h,p]=String(token||'').split('.');const H=JSON.parse(Buffer.from(h,'base64url'));const P=JSON.parse(Buffer.from(p,'base64url'));return {alg:H.alg,iss:P.iss,aud:P.aud,sub:P.sub,keys:Object.keys(P)};}",
  "function meta(token){const [h,p]=String(token||'').split('.');const H=JSON.parse(Buffer.from(h,'base64url'));const P=JSON.parse(Buffer.from(p,'base64url'));return {alg:H.alg,kid:H.kid||'',iss:P.iss,aud:P.aud,sub:P.sub,iat:Number(P.iat||0),exp:Number(P.exp||0),keys:Object.keys(P)};}"
);
replaceOnce(
  'E2E_PASSWORD_TOKEN_LOG',
  "console.log(`FIREBASE_TOKEN_META code=${code} alg=${m.alg} iss=${m.iss} aud=${m.aud} synthetic_role_claims=false`);return p;",
  "console.log(`FIREBASE_TOKEN_META code=${code} alg=${m.alg} kid=${m.kid} iss=${m.iss} aud=${m.aud} sub_matches_local_id=${m.sub===p.localId} exp_in=${m.exp-Math.floor(Date.now()/1000)} synthetic_role_claims=false`);return p;"
);
replaceOnce(
  'E2E_PROFILE_REFRESH',
  "const pr=await profile(t.idToken,u.code,u.role);if(!auths[u.role])auths[u.role]={token:t,profile:pr};",
  "let pr;try{pr=await profile(t.idToken,u.code,u.role);}catch(e){if(!/AUTH_REQUIRED/.test(String(e?.message||e)))throw e;const initial=meta(t.idToken),refreshed=await refreshPair(t.refreshToken),next=meta(refreshed.idToken);console.log(`NEON_AUTH_REFRESH_DIAGNOSTIC code=${u.code} initial_kid=${initial.kid} refreshed_kid=${next.kid} sub_matches_uid=${next.sub===u.uid} exp_in=${next.exp-Math.floor(Date.now()/1000)} reason=AUTH_REQUIRED`);t.idToken=refreshed.idToken;t.refreshToken=refreshed.refreshToken;pr=await profile(t.idToken,u.code,u.role);}if(!auths[u.role])auths[u.role]={token:t,profile:pr};"
);
replaceOnce(
  'E2E_ADMIN_LOGIN',
  "async function loginAdmin(p,pair,prof){console.log('E2E_STAGE=browser_login role=ADMIN method=production_refresh_session');await p.goto(SITE,{waitUntil:'domcontentloaded'});await p.evaluate(({k,pair,prof})=>sessionStorage.setItem(k,JSON.stringify({access_token:pair.idToken,refresh_token:pair.refreshToken,expires_at:Math.floor(Date.now()/1000)+pair.expiresIn,profile:prof})),{k:SESSION_KEY,pair,prof});await p.reload({waitUntil:'domcontentloaded'});await waitApp(p,'ADMIN',40000);}",
  "async function loginAdmin(p,pair,prof){console.log('E2E_STAGE=browser_login role=ADMIN method=preloaded_production_refresh_session');await p.addInitScript(({k,pair,prof,origin})=>{if(location.origin===origin)sessionStorage.setItem(k,JSON.stringify({access_token:pair.idToken,refresh_token:pair.refreshToken,expires_at:Math.floor(Date.now()/1000)+pair.expiresIn,profile:prof}));},{k:SESSION_KEY,pair,prof,origin:new URL(SITE).origin});await p.goto(SITE,{waitUntil:'domcontentloaded',timeout:25000});await waitApp(p,'ADMIN',40000);console.log('ADMIN_BROWSER_SESSION_PRELOAD=PASS');}"
);

const runtime = new Module(target, module);
runtime.filename = target;
runtime.paths = Module._nodeModulePaths(path.dirname(target));
runtime._compile(patched, target);
