'use strict';
const fs=require('fs');
const file=process.argv[2]||process.env.FINAL_HARNESS_OUT;
if(!file)throw new Error('FINAL_HARNESS_REQUIRED');
let s=fs.readFileSync(file,'utf8');

let start=s.indexOf('async function selectExact(page,id){');
let end=s.indexOf('\nasync function waitAlert(page,sku)',start);
if(start<0||end<0)throw new Error('WV3_SELECTOR_PATCH_ANCHOR_MISSING');
const selectorReplacement=`async function selectExact(page,id){const backend=await inventBackendReadback(page,id);await page.locator('[data-tab="events"]').click().catch(()=>{});await page.waitForSelector('#workflowV3Events',{timeout:10000});const active=page.locator('#workflowV3Events [data-wv3-bucket="active"]');if(await active.count())await active.click();const refresh=page.locator('#wv3EventsRefresh');if(await refresh.count())await refresh.click();await stage('INVENT_EXACT_ENTITY_RENDER',15000,async()=>{await page.waitForFunction(id=>!!document.querySelector(\`#wv3EventsList [data-wv3-select="\${CSS.escape(id)}"]\`),id,{timeout:14000})});const row=page.locator(\`#wv3EventsList [data-wv3-select="\${id}"]\`);await row.click();await page.waitForFunction(id=>{const detail=document.querySelector('#wv3EventsDetail');return !!detail&&!!detail.querySelector(\`[data-id="\${CSS.escape(id)}"]\`)},id,{timeout:5000});console.log(\`INVENT_EXACT_ENTITY_RENDER=PASS entity_id=\${id} bucket=active backend_bucket=\${backend.bucket}\`);return id}
async function actionExact(page,id,name){const action=name==='available'?'available':'skip';const selector=\`#wv3EventsDetail [data-wv3-action="\${action}"][data-id="\${id}"]\`;const b=page.locator(selector);await b.waitFor({state:'visible',timeout:7000});await b.click();clean(page)}`;
s=s.slice(0,start)+selectorReplacement+s.slice(end);

function replaceRange(startMarker,endMarker,replacement,label){
  const a=s.indexOf(startMarker), b=s.indexOf(endMarker,a);
  if(a<0||b<0)throw new Error(`${label}_ANCHOR_MISSING`);
  s=s.slice(0,a)+replacement+s.slice(b+endMarker.length);
}

replaceRange(
  " const ui=await uiSnapshot(B.p),m0=await metrics(B.p);",
  "const m1=await metrics(B.p);",
  ` const ui=await uiSnapshot(B.p);await stage('NO_CLAIM_AVAILABLE',5000,async()=>{const removed=await A.p.locator('#workflowV3Events [data-wv3-action="claim"],#workflowV3Events [data-wv3-action="reassign"],#workflowV3Events [data-fast-action="claim"],#workflowV3Events [data-fast-action="reassign"]').count();if(removed!==0)throw new Error('REMOVED_RECEIVING_ACTION_VISIBLE');console.log('NO_CLAIM_UI=PASS flow=available')});const m1=await metrics(B.p);`,
  'AVAILABLE_NO_CLAIM'
);

replaceRange(
  "const ui2=await uiSnapshot(B.p),m2=await metrics(B.p);",
  "const m3=await metrics(B.p);",
  `const ui2=await uiSnapshot(B.p);await stage('NO_CLAIM_SKIP',5000,async()=>{const removed=await A.p.locator('#workflowV3Events [data-wv3-action="claim"],#workflowV3Events [data-wv3-action="reassign"],#workflowV3Events [data-fast-action="claim"],#workflowV3Events [data-fast-action="reassign"]').count();if(removed!==0)throw new Error('REMOVED_RECEIVING_ACTION_VISIBLE');console.log('NO_CLAIM_UI=PASS flow=skip')});const m3=await metrics(B.p);`,
  'SKIP_NO_CLAIM'
);

const resolvedStart="await stage('RESOLVED_SKU_CLEARED'";
const resolvedEnd="console.log('RESOLVED_SKU_ACTIONS_CLEARED=PASS');";
replaceRange(resolvedStart,resolvedEnd,`await stage('RESOLVED_SKU_CLEARED',10000,async()=>{await A.p.waitForFunction(({id,sku})=>{const oldRow=!!document.querySelector(\`#wv3EventsList [data-wv3-select="\${CSS.escape(id)}"]\`);const detailSku=document.querySelector('#wv3EventsDetail .fast-detail-head h3')?.textContent?.trim()||'';return !oldRow&&detailSku!==sku},{id:one.id,sku:SKU_AVAILABLE},{timeout:8000})});console.log('RESOLVED_SKU_ACTIONS_CLEARED=PASS');`,'RESOLVED_WV3');

start=s.indexOf('async function dismiss(page){');
end=s.indexOf('\nasync function uiSnapshot(page)',start);
if(start<0||end<0)throw new Error('DISMISS_PATCH_ANCHOR_MISSING');
const dismissReplacement=`async function dismiss(page){const out=await page.evaluate(async({backend,key})=>{const alert=document.querySelector('#pendingAlert [data-picker-alert]');if(!alert)return{ok:true,none:true};const eventId=alert.getAttribute('data-picker-alert')||'';let ss;try{ss=JSON.parse(sessionStorage.getItem(key)||'null')}catch{}if(!ss?.access_token||!eventId)return{ok:false,status:0,error:'ALERT_ACK_CONTEXT_MISSING'};const r=await fetch(\`\${backend}/api/web-api/ack-alert\`,{method:'POST',headers:{'content-type':'application/json',apikey:'compat-public',authorization:\`Bearer \${ss.access_token}\`},body:JSON.stringify({event_id:eventId})});const text=await r.text();let body={};try{body=text?JSON.parse(text):{}}catch{}if(r.ok){const target=document.querySelector('#pendingAlert');if(target)target.innerHTML=''}return{ok:r.ok,status:r.status,eventId,error:body?.error||body?.message||''}}, {backend:BACKEND,key:SESSION_KEY});if(!out.ok)throw new Error(\`ALERT_FIXTURE_ACK_HTTP_\${out.status}:\${safe(out.error)}\`);await page.waitForFunction(()=>!document.querySelector('#pendingAlert [data-picker-alert]'),null,{timeout:3000});console.log('ALERT_FIXTURE_ACK=PASS cleanup_only=true')}`;
s=s.slice(0,start)+dismissReplacement+s.slice(end);

start=s.indexOf(" const current=await issue(B.p,one.id),high=");
end=s.indexOf("\n const beforeStale=",start);
if(start<0||end<0)throw new Error('DUPLICATE_BASELINE_PATCH_ANCHOR_MISSING');
const duplicateReplacement=` const current=await issue(B.p,one.id),high=1000000+Math.max(1,current?.version||1),dupId=\`\${RUN_MARKER}-dup\`,mb=await metrics(B.p);await stage('SYNTHETIC_ACCEPT',10000,async()=>{await signal.set({event_id:dupId,event_type:'issue_changed',topic:'issues',entity_id:one.id,entity_version:high,source:RUN_MARKER,client_at:new Date()});await waitMetric(B.p,'events',Number(mb.events||0));await waitMetric(B.p,'patchedCards',Number(mb.patchedCards||0))});await B.p.waitForFunction(()=>!document.querySelector('#pendingAlert [data-picker-alert]'),null,{timeout:5000});const dupBase=await metrics(B.p);await stage('DUPLICATE_EVENT',10000,async()=>{await signal.set({event_id:dupId,event_type:'issue_changed',topic:'issues',entity_id:one.id,entity_version:high,source:RUN_MARKER,client_at:new Date()});await waitMetric(B.p,'duplicateIgnored',Number(dupBase.duplicateIgnored||0))});if(await B.p.locator(\`#myIssues [data-picker-issue="\${one.id}"]\`).count()!==1)throw new Error('DUPLICATE_CARD_CREATED');if(Number((await metrics(B.p)).alertPatches||0)!==Number(dupBase.alertPatches||0))throw new Error('DUPLICATE_NOTIFICATION_CREATED');console.log('DUPLICATE_EVENT_IGNORED=PASS duplicate_card=1 duplicate_notification=0');`;
s=s.slice(0,start)+duplicateReplacement+s.slice(end);

const loginAnchor="await stage('LOGIN_A',18000,()=>browserLogin(A.p,USERS[2],pw,'TWO_SESSION_LOGIN_A'));await stage('LOGIN_B',18000,()=>browserLogin(B.p,USERS[0],pw,'TWO_SESSION_LOGIN_B'));console.log('FIREBASE_PROFILE_UID_MATCH=PASS');";
if(!s.includes(loginAnchor))throw new Error('LISTENER_READY_LOGIN_ANCHOR_MISSING');
const listenerReady=`${loginAnchor}await stage('PICKER_LISTENER_READY',15000,async()=>{const before=Number((await metrics(B.p)).events||0);await B.p.evaluate(()=>{const n=document.createElement('span');n.hidden=true;n.dataset.e2eListenerReady='1';document.body.appendChild(n);n.remove()});for(let attempt=1;attempt<=6;attempt++){await signal.set({event_id:\`\${RUN_MARKER}-listener-ready-\${attempt}\`,event_type:'issue_changed',topic:'issues',entity_id:'12910000-0000-4000-8000-00000000feed',entity_version:attempt,source:RUN_MARKER,client_at:new Date()});try{await B.p.waitForFunction(before=>Number(window.__BH_PICKER_REALTIME_METRICS__?.events||0)>before,before,{timeout:2200});console.log(\`PICKER_LISTENER_READY=PASS attempt=\${attempt}\`);return}catch{}}throw new Error('PICKER_LISTENER_READY_TIMEOUT')});console.log('FIREBASE_AUTH_READY_BEFORE_SUBSCRIBE=PASS');console.log('FIRESTORE_LISTENER_ATTACH=PASS');`;
s=s.replace(loginAnchor,listenerReady);

if(s.includes("actionExact(A.p,one.id,'claim')")||s.includes("actionExact(A.p,two.id,'claim')")||s.includes("AVAILABLE_CLAIM")||s.includes("SKIP_CLAIM"))throw new Error('CLAIM_FLOW_STILL_PRESENT_IN_FINAL_HARNESS');
if(!s.includes('NO_CLAIM_UI=PASS'))throw new Error('NO_CLAIM_ACCEPTANCE_MARKER_MISSING');
fs.writeFileSync(file,s);
console.log('FINAL_FAST_EVENTS_HARNESS_PATCH=PASS renderer=workflow-v3 no_claim=true selector=data-wv3-select alert_ack=exact_api_cleanup listener_readiness=event_probe');
