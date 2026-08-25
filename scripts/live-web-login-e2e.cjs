'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const target = path.join(__dirname, 'live-web-login-e2e-v2.cjs');
const source = fs.readFileSync(target, 'utf8');
const previous = "async function loginAdmin(p,pair,prof){console.log('E2E_STAGE=browser_login role=ADMIN method=production_refresh_session');await p.goto(SITE,{waitUntil:'domcontentloaded'});await p.evaluate(({k,pair,prof})=>sessionStorage.setItem(k,JSON.stringify({access_token:pair.idToken,refresh_token:pair.refreshToken,expires_at:Math.floor(Date.now()/1000)+pair.expiresIn,profile:prof})),{k:SESSION_KEY,pair,prof});await p.reload({waitUntil:'domcontentloaded'});await waitApp(p,'ADMIN',40000);}";
const replacement = "async function loginAdmin(p,pair,prof){console.log('E2E_STAGE=browser_login role=ADMIN method=preloaded_production_refresh_session');await p.addInitScript(({k,pair,prof,origin})=>{if(location.origin===origin)sessionStorage.setItem(k,JSON.stringify({access_token:pair.idToken,refresh_token:pair.refreshToken,expires_at:Math.floor(Date.now()/1000)+pair.expiresIn,profile:prof}));},{k:SESSION_KEY,pair,prof,origin:new URL(SITE).origin});await p.goto(SITE,{waitUntil:'domcontentloaded',timeout:25000});await waitApp(p,'ADMIN',40000);console.log('ADMIN_BROWSER_SESSION_PRELOAD=PASS');}";
if (!source.includes(previous)) throw new Error('E2E_ADMIN_LOGIN_PATCH_TARGET_MISSING');
const patched = source.replace(previous, replacement);
const runtime = new Module(target, module);
runtime.filename = target;
runtime.paths = Module._nodeModulePaths(path.dirname(target));
runtime._compile(patched, target);
