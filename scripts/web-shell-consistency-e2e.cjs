'use strict';
const fs=require('fs');
const crypto=require('crypto');
const {initializeApp,cert,deleteApp}=require('firebase-admin/app');
const {getAuth}=require('firebase-admin/auth');
const {chromium}=require('playwright-core');

const SITE='https://bao-hang-1291.web.app/';
const SESSION_KEY='bao-hang-1291-web-session';
const NEON=process.env.NEON_DATA_API||'';
const CHROME=process.env.CHROME_BIN||'';
const ADMIN_UID='44fae0a2-09eb-4226-8412-0f1a1f5d7ef8';
const USERS=[
  {uid:'12910000-0000-4000-8000-00000000e2e4',code:'e2eadmininvent',role:'ADMIN_INVENT'},
  {uid:'12910000-0000-4000-8000-00000000e2e3',code:'e2einvent',role:'INVENT'},
  {uid:'12910000-0000-4000-8000-00000000e2e1',code:'e2eweb1291',role:'PICKER'},
];
const EXPECTED={
  ADMIN:{tabs:['overview','events','sku','reports','users','devices','services','logs','config','versions'],sections:['VẬN HÀNH','QUẢN LÝ','HẠ TẦNG','THIẾT LẬP']},
  ADMIN_INVENT:{tabs:['overview','events','sku','reports','users','server','logs','sla'],sections:['VẬN HÀNH','QUẢN LÝ','HẠ TẦNG','THIẾT LẬP']},
  INVENT:{tabs:['events'],sections:[]},
  PICKER:{tabs:['picker'],sections:[]},
};
const LEGACY=['Tổng quan','Sự kiện','Báo cáo','Nhân sự & quyền','Thiết bị','Hệ thống & dung lượng','Nhật ký & kiểm tra','Cấu hình','Phiên bản'];
const email=code=>code.toLowerCase()+'@bao-hang-1291.local';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const safe=v=>String(v??'').replace(/Bearer\s+[A-Za-z0-9._-]+/gi,'Bearer [REDACTED]').replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g,'[JWT_REDACTED]').slice(0,900);
const b64=v=>Buffer.from(typeof v==='string'?v:JSON.stringify(v)).toString('base64url');
function sign(sa,payload){const h=b64({alg:'RS256',typ:'JWT'}),p=b64(payload),u=h+'.'+p,s=crypto.sign('RSA-SHA256',Buffer.from(u),sa.private_key).toString('base64url');return u+'.'+s}
async function req(url,opt={},ms=15000){const r=await fetch(url,{...opt,signal:AbortSignal.timeout(ms)}),t=await r.text();let j={};try{j=t?JSON.parse(t):{}}catch{j={raw:t}};if(!r.ok)throw new Error('HTTP_'+r.status+':'+safe(j?.error?.message||j?.error||j?.message||j?.raw||t));return j}
function apiKey(){const g=JSON.parse(fs.readFileSync('app/google-services.json','utf8'));const k=g.client?.[0]?.api_key?.[0]?.current_key;if(!k)throw new Error('FIREBASE_API_KEY_MISSING');return k}
async function adminSession(sa){
  const now=Math.floor(Date.now()/1000);
  const custom=sign(sa,{iss:sa.client_email,sub:sa.client_email,aud:'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',iat:now,exp:now+900,uid:ADMIN_UID});
  const auth=await req('https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key='+encodeURIComponent(apiKey()),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:custom,returnSecureToken:true})});
  const prof=await req(NEON+'/rpc/api_session_profile_rpc',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+auth.idToken},body:JSON.stringify({p_test_role:null})});
  if(prof?.profile?.role!=='ADMIN')throw new Error('ADMIN_PROFILE_MISMATCH');
  return {access_token:auth.idToken,refresh_token:auth.refreshToken,expires_at:now+Number(auth.expiresIn||3600),profile:prof.profile};
}
async function resetUsers(auth,pw){
  for(const u of USERS){try{await auth.deleteUser(u.uid)}catch(e){if(e?.code!=='auth/user-not-found')throw e}}
  for(const u of USERS)await auth.createUser({uid:u.uid,email:email(u.code),password:pw,displayName:'__E2E_SHELL_'+u.role+'__',emailVerified:true,disabled:false});
}
async function cleanupUsers(auth){for(const u of USERS){try{const x=await auth.getUser(u.uid);if(!String(x.displayName||'').startsWith('__E2E_SHELL_'))throw new Error('SHELL_USER_MARKER_MISMATCH_'+u.uid);await auth.deleteUser(u.uid)}catch(e){if(e?.code!=='auth/user-not-found')throw e}}}
function guard(page,tag){const bad=[];page.on('pageerror',e=>bad.push('page:'+safe(e?.message||e)));page.on('console',m=>{if(m.type()==='error'&&/AUTH_REQUIRED|not owner|not_owner/i.test(m.text()))bad.push('console:'+safe(m.text()))});page.on('dialog',async d=>{if(/AUTH_REQUIRED|not owner|not_owner|không có quyền|forbidden/i.test(d.message()))bad.push('dialog:'+safe(d.message()));await d.accept().catch(()=>{})});page.__bad=bad;page.__tag=tag;page.setDefaultTimeout(12000);page.setDefaultNavigationTimeout(20000)}
function clean(page){if(page.__bad.length)throw new Error('SHELL_PAGE_GUARD_'+page.__tag+':'+safe(page.__bad.join('|')))}
async function shellState(page){return page.evaluate(()=>{const nav=document.querySelector('.tabs');return{generation:nav?.dataset?.shellGeneration||'',tabs:[...document.querySelectorAll('.tabs button[data-tab]')].map(n=>n.dataset.tab),labels:[...document.querySelectorAll('.tabs button[data-tab]')].map(n=>(n.textContent||'').trim()),sections:[...document.querySelectorAll('.tabs .nav-section-label')].map(n=>(n.textContent||'').trim()),html:nav?.innerHTML||'',hash:location.hash}})}
function eq(a,b,label){if(JSON.stringify(a)!==JSON.stringify(b))throw new Error(label+':got='+JSON.stringify(a)+' expected='+JSON.stringify(b))}
async function verifyShell(page,role,stable=true){
  await page.waitForSelector('.app-shell');
  const first=await shellState(page),exp=EXPECTED[role];
  if(first.generation!=='canonical-v2')throw new Error('SHELL_GENERATION_'+role+'_'+first.generation);
  eq(first.tabs,exp.tabs,'SHELL_TABS_'+role);eq(first.sections,exp.sections,'SHELL_SECTIONS_'+role);
  for(const label of LEGACY)if(first.labels.includes(label))throw new Error('LEGACY_NAV_LABEL_'+role+':'+label);
  if(stable){await sleep(900);const after=await shellState(page);if(after.html!==first.html)throw new Error('LAZY_NAV_MUTATION_'+role);}
  clean(page);return first;
}
async function loginPw(page,u,pw){await page.goto(SITE,{waitUntil:'domcontentloaded'});await page.locator('#employeeCode').fill(u.code);await page.locator('#password').fill(pw);await page.locator('#loginForm button').first().click();await page.waitForFunction(role=>{try{return document.querySelector('.app-shell')&&JSON.parse(sessionStorage.getItem('bao-hang-1291-web-session')||'null')?.profile?.role===role}catch{return false}},u.role,{timeout:20000});}
async function loginAdmin(page,session){await page.goto(SITE,{waitUntil:'domcontentloaded'});await page.evaluate(({k,s})=>sessionStorage.setItem(k,JSON.stringify(s)),{k:SESSION_KEY,s:session});await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector('.app-shell');}
const UI_TEXT_SELECTOR='h1,h2,h3,.tabs button,.heading button,.ops-form-actions button,.ops-row-actions button,.ops-save-bar button,.wv2-tabs button,.wv2-actions button,.wv2-report-actions button,.fast-tabs button,#fastDetail button,#reportShortage,#refreshMine,#catalogSearchBtn,#createFullLog,#refreshLogs,label,dt,th,.eyebrow,.nav-section-label,.muted,.ops-page-heading p,.ops-panel-title p,.ops-note,.ops-setting-card p,.ops-status-strip span,.wv2-panel>h3,.wv2-detail-title,.fast-facts dt,.alert-modal p,.bh-language-switcher span,.bh-language-switcher option';
async function auditEnglishUi(page,role,route){
  const switcher=page.locator('.bh-language-switcher select');
  await switcher.selectOption('en');
  await page.waitForFunction(()=>document.documentElement.lang==='en',{timeout:8000});
  await sleep(900);
  const residual=await page.evaluate(({selector})=>{
    const vi=/[ÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠƯàáâãèéêìíòóôõùúăđĩũơưẠ-ỹ]/;
    const rows=[],seen=new Set();
    for(const el of document.querySelectorAll(selector)){
      if(!el.offsetParent&&getComputedStyle(el).position!=='fixed')continue;
      const values=[(el.textContent||'').replace(/\s+/g,' ').trim()];
      for(const name of ['placeholder','title','aria-label'])if(el.hasAttribute?.(name))values.push((el.getAttribute(name)||'').trim());
      for(const value of values){
        if(!value||!vi.test(value)||/BÁO HÀNG 1291/i.test(value)||seen.has(value))continue;
        seen.add(value);rows.push(value.slice(0,260));
      }
    }
    return rows;
  },{selector:UI_TEXT_SELECTOR});
  if(residual.length)throw new Error('I18N_VI_RESIDUAL_'+role+'_'+route+':'+safe(JSON.stringify(residual.slice(0,12))));
  const switchState=await page.evaluate(()=>({
    label:document.querySelector('.bh-language-switcher span')?.textContent?.trim()||'',
    vi:document.querySelector('.bh-language-switcher option[value="vi"]')?.textContent?.trim()||'',
    en:document.querySelector('.bh-language-switcher option[value="en"]')?.textContent?.trim()||'',
  }));
  if(switchState.label!=='Language'||switchState.vi!=='Vietnamese'||switchState.en!=='English')throw new Error('I18N_SWITCHER_PARTIAL_'+JSON.stringify(switchState));
  await switcher.selectOption('vi');
  await page.waitForFunction(()=>document.documentElement.lang==='vi',{timeout:8000});
  console.log('WEB_I18N_ROUTE=PASS role='+role+' route='+route);
}
async function assertDashboardRenderer(page,route){
  if(route==='overview'){
    await page.waitForSelector('.v5-root.v5-overview',{timeout:12000});
    const old=await page.locator('.workflow-v3-dashboard,.v4-report').count();
    if(old)throw new Error('DASHBOARD_RENDERER_REGRESSION_overview_old_renderer='+old);
    const text=(await page.locator('#content').innerText()).replace(/\s+/g,' ');
    if(!/Cần xử lý|Needs action/.test(text)||!/SKU ưu tiên|Priority SKUs/.test(text))throw new Error('DASHBOARD_V5_OVERVIEW_MARKERS_MISSING:'+safe(text));
    console.log('DASHBOARD_V5_RUNTIME=PASS route=overview');
  }
  if(route==='reports'){
    await page.waitForSelector('.v5-root.v5-report',{timeout:12000});
    const old=await page.locator('.workflow-v3-dashboard,.v4-report').count();
    if(old)throw new Error('DASHBOARD_RENDERER_REGRESSION_reports_old_renderer='+old);
    const text=(await page.locator('#content').innerText()).replace(/\s+/g,' ');
    if(!/Tổng hợp|Summary/.test(text)||!/Tốc độ & SLA|Speed & SLA/.test(text)||!/Cơ cấu kết quả|Outcome mix/.test(text))throw new Error('DASHBOARD_V5_REPORT_MARKERS_MISSING:'+safe(text));
    console.log('DASHBOARD_V5_RUNTIME=PASS route=reports');
  }
}
async function directLoads(page,role){
  for(const route of EXPECTED[role].tabs){
    await page.goto(SITE+'#/'+route,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(r=>location.hash==='#/'+r,route,{timeout:10000});
    await verifyShell(page,role,true);
    await assertDashboardRenderer(page,route);
    await auditEnglishUi(page,role,route);
  }
  console.log('WEB_SHELL_DIRECT_LOAD_ROLE=PASS role='+role+' routes='+EXPECTED[role].tabs.length);
}
async function clickRoute(page,route,role){
  await page.locator('.tabs button[data-tab="'+route+'"]').click();
  await page.waitForFunction(r=>location.hash==='#/'+r,route,{timeout:10000});
  await verifyShell(page,role,false);
  await assertDashboardRenderer(page,route);
}
async function navigationStability(page){
  for(const route of ['events','reports','events','overview','users','services','reports'])await clickRoute(page,route,'ADMIN');
  console.log('WEB_SHELL_NAV_STABILITY=PASS');
}
async function i18n(page){
  const s=page.locator('.bh-language-switcher select');await s.selectOption('en');await page.waitForFunction(()=>[...document.querySelectorAll('.nav-section-label')].some(n=>(n.textContent||'').trim()==='OPERATIONS'));
  let st=await shellState(page);eq(st.sections,['OPERATIONS','MANAGEMENT','INFRASTRUCTURE','SETTINGS'],'SHELL_I18N_EN_SECTIONS');
  await s.selectOption('vi');await page.waitForFunction(()=>[...document.querySelectorAll('.nav-section-label')].some(n=>(n.textContent||'').trim()==='VẬN HÀNH'));
  st=await shellState(page);eq(st.sections,EXPECTED.ADMIN.sections,'SHELL_I18N_VI_SECTIONS');console.log('WEB_SHELL_I18N=PASS');
}
(async()=>{
  if(!NEON||!CHROME)throw new Error('SHELL_TARGET_ENV_MISSING');
  const sa=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT||'{}');if(sa.project_id!=='bao-hang-1291'||!sa.private_key)throw new Error('FIREBASE_SCOPE');
  const app=initializeApp({credential:cert(sa)},'shell-'+Date.now()),auth=getAuth(app),pw='Sh!'+crypto.randomBytes(18).toString('base64url')+'1A';
  let browser;
  try{
    await resetUsers(auth,pw);
    const admin=await adminSession(sa);
    browser=await chromium.launch({executablePath:CHROME,headless:true,args:['--no-sandbox']});
    const roles=['ADMIN','ADMIN_INVENT','INVENT','PICKER'];
    for(const role of roles){
      const ctx=await browser.newContext({viewport:role==='PICKER'?{width:390,height:844}:{width:1280,height:900}}),page=await ctx.newPage();guard(page,role);
      try{if(role==='ADMIN')await loginAdmin(page,admin);else await loginPw(page,USERS.find(u=>u.role===role),pw);await verifyShell(page,role,true);await directLoads(page,role);if(role==='ADMIN'){await navigationStability(page);await i18n(page);}}finally{await ctx.close().catch(()=>{})}
    }
    console.log('WEB_I18N_ALL_ROUTES=PASS roles=4 routes='+roles.reduce((n,r)=>n+EXPECTED[r].tabs.length,0));
    console.log('WEB_SHELL_ROLE_MATRIX=PASS roles=4');
    console.log('WEB_SHELL_DIRECT_LOAD=PASS');
    console.log('WEB_SHELL_RUNTIME_CONSISTENCY=PASS generation=canonical-v2');
  }finally{
    if(browser)await browser.close().catch(()=>{});
    await cleanupUsers(auth).catch(e=>{console.error('SHELL_FIREBASE_CLEANUP_FAIL '+safe(e.message));process.exitCode=2});
    await deleteApp(app).catch(()=>{});
  }
})().catch(e=>{console.error('WEB_SHELL_RUNTIME_CONSISTENCY=FAIL '+safe(e?.message||e));process.exitCode=1});
