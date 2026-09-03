'use strict';
// Keep login timing and stage deadlines aligned with the production shell acceptance harness.

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
  'E2E_ADMIN_CUSTOM_TOKEN_CARRY',
  "auths.ADMIN={pair,profile:ap};",
  "auths.ADMIN={pair:{...pair,customToken:custom},profile:ap};"
);
replaceOnce(
  'E2E_ADMIN_LOGIN',
  "async function loginAdmin(p,pair,prof){console.log('E2E_STAGE=browser_login role=ADMIN method=production_refresh_session');await p.goto(SITE,{waitUntil:'domcontentloaded'});await p.evaluate(({k,pair,prof})=>sessionStorage.setItem(k,JSON.stringify({access_token:pair.idToken,refresh_token:pair.refreshToken,expires_at:Math.floor(Date.now()/1000)+pair.expiresIn,profile:prof})),{k:SESSION_KEY,pair,prof});await p.reload({waitUntil:'domcontentloaded'});await waitApp(p,'ADMIN',40000);}",
  "async function loginAdmin(p,pair,prof){const stage=async(label,promise,ms)=>{let timer;try{return await Promise.race([Promise.resolve(promise),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`${label}_TIMEOUT_${ms}MS`)),ms)})]);}finally{clearTimeout(timer)}};console.log('E2E_STAGE=browser_login role=ADMIN method=browser_firebase_custom_token');await stage('ADMIN_LOGIN_PAGE',p.goto(SITE,{waitUntil:'commit',timeout:45000}),47000);console.log('ADMIN_LOGIN_PAGE=PASS');const fs=require('fs'),path=require('path');const root=path.join(process.cwd(),'web-admin','node_modules','firebase');const files=fs.readdirSync(root,{recursive:true}).map(String);const appRel=files.find(x=>/(^|\\/)firebase-app-compat\\.js$/.test(x.replaceAll('\\\\','/'))),authRel=files.find(x=>/(^|\\/)firebase-auth-compat\\.js$/.test(x.replaceAll('\\\\','/')));if(!appRel||!authRel)throw new Error(`FIREBASE_COMPAT_RUNTIME_NOT_FOUND app=${Boolean(appRel)} auth=${Boolean(authRel)}`);const cdp=await stage('ADMIN_CDP_SESSION',p.context().newCDPSession(p),8000);for(const rel of [appRel,authRel]){const code=fs.readFileSync(path.join(root,rel),'utf8');const r=await stage('ADMIN_FIREBASE_RUNTIME_INJECT',cdp.send('Runtime.evaluate',{expression:code,awaitPromise:true,returnByValue:false}),12000);if(r?.exceptionDetails)throw new Error(`FIREBASE_RUNTIME_INJECT_FAILED:${r.exceptionDetails.text||'exception'}`);}console.log('ADMIN_FIREBASE_BROWSER_RUNTIME=PASS');const signed=await stage('ADMIN_BROWSER_FIREBASE_SIGNIN',p.evaluate(async({custom,apiKey})=>{const fb=globalThis.firebase;if(!fb?.initializeApp||!fb?.auth)throw new Error('FIREBASE_COMPAT_GLOBAL_MISSING');if(!fb.apps.length)fb.initializeApp({apiKey,authDomain:'bao-hang-1291.web.app',projectId:'bao-hang-1291'});await fb.auth().setPersistence(fb.auth.Auth.Persistence.LOCAL);const cred=await fb.auth().signInWithCustomToken(custom);const idToken=await cred.user.getIdToken(true);return {uid:cred.user.uid,idToken,refreshToken:cred.user.refreshToken};},{custom:pair.customToken,apiKey:APIKEY}),20000);if(signed.uid!==ADMIN_UID||!signed.idToken||!signed.refreshToken)throw new Error('ADMIN_BROWSER_FIREBASE_SIGNIN_INVALID');console.log('ADMIN_BROWSER_FIREBASE_SIGNIN=PASS');await stage('ADMIN_SESSION_STORAGE',p.evaluate(({k,signed,prof})=>sessionStorage.setItem(k,JSON.stringify({access_token:signed.idToken,refresh_token:signed.refreshToken,expires_at:Math.floor(Date.now()/1000)+3600,profile:prof})),{k:SESSION_KEY,signed,prof}),8000);console.log('ADMIN_SESSION_STORAGE=PASS');await stage('ADMIN_RELOAD',p.reload({waitUntil:'commit',timeout:45000}),47000);console.log('ADMIN_RELOAD_COMMIT=PASS');try{await stage('ADMIN_WAIT_APP',waitApp(p,'ADMIN',30000),32000);}catch(error){const diag=await p.evaluate((k)=>{let s=null;try{s=JSON.parse(sessionStorage.getItem(k)||'null')}catch{}return {readyState:document.readyState,href:location.href,hasShell:Boolean(document.querySelector('.app-shell')),hasLogin:Boolean(document.querySelector('#loginForm')),loginMessage:(document.querySelector('#loginMessage')?.textContent||'').trim(),session:{present:Boolean(s),role:s?.profile?.role||'',uid:s?.profile?.id||'',hasAccess:Boolean(s?.access_token),hasRefresh:Boolean(s?.refresh_token),expiresAt:Number(s?.expires_at||0)},authStability:globalThis.__BH_AUTH_STABILITY__||null};},SESSION_KEY).catch(e=>({diagError:String(e?.message||e)}));console.error(`ADMIN_BOOTSTRAP_DIAG=${safe(JSON.stringify(diag))}`);console.error(`ADMIN_PAGE_ERRORS=${safe(JSON.stringify(p.__e||{}))}`);throw error;}console.log('ADMIN_BROWSER_AUTH_STATE=PASS');}"
);

const runtime = new Module(target, module);
runtime.filename = target;
runtime.paths = Module._nodeModulePaths(path.dirname(target));
runtime._compile(patched, target);
