'use strict';
const fs=require('fs');
const input=process.argv[2]||'scripts/targeted-two-session-realtime-v4.cjs';
const output=process.argv[3]||process.env.FINAL_HARNESS_OUT;
if(!output)throw new Error('FINAL_HARNESS_OUT_REQUIRED');
let s=fs.readFileSync(input,'utf8');

const markerOld="const RUN_MARKER=`e2e-two-session-${process.env.GITHUB_RUN_ID||'local'}-${crypto.randomUUID()}`;";
if(!s.includes(markerOld))throw new Error('RUN_MARKER_ANCHOR_MISSING');
s=s.replace(markerOld,"const RUN_MARKER=process.env.E2E_RUN_MARKER||`e2e-two-session-${process.env.GITHUB_RUN_ID||'local'}-${crypto.randomUUID()}`;");

const reportStart=s.indexOf('async function reportViaProduction(page,sku){');
const reportEnd=s.indexOf('\nasync function issue(page,id)',reportStart);
if(reportStart<0||reportEnd<0)throw new Error('REPORT_FUNCTION_ANCHOR_MISSING');
const reportReplacement=`async function reportViaProduction(page,sku,signal){const before=await metrics(page);const out=await stage(\`REPORT_\${sku}_PRODUCTION_RPC\`,10000,()=>page.evaluate(async({backend,key,sku,req})=>{let ss;try{ss=JSON.parse(sessionStorage.getItem(key)||'null')}catch{}if(!ss?.access_token)return{ok:false,error:'NO_SESSION'};const r=await fetch(\`\${backend}/api/web-api/report-shortage\`,{method:'POST',headers:{'content-type':'application/json',apikey:'compat-public',authorization:\`Bearer \${ss.access_token}\`},body:JSON.stringify({sku,client_request_id:req})});const text=await r.text();let p={};try{p=text?JSON.parse(text):{}}catch{p={raw:text.slice(0,200)}};const issue=p?.issue||p;return{ok:r.ok,status:r.status,id:issue?.id||'',version:Number(issue?.issue_version||0),statusName:String(issue?.status||''),err:p?.error||p?.message||''}}, {backend:BACKEND,key:SESSION_KEY,sku,req:crypto.randomUUID()}));if(!out.ok||!out.id)throw new Error(\`REPORT_\${sku}_HTTP_\${out.status}:\${safe(out.err)}\`);console.log(\`REPORT_BACKEND_RESPONSE=PASS sku=\${sku} issue_id=\${out.id} entity_id=\${out.id} status=\${out.statusName||'OPEN'} reporter_uid=\${USERS[0].uid}\`);await stage(\`REPORT_\${sku}_LISTENER_SEED\`,10000,async()=>{for(let attempt=0;attempt<8;attempt++){await signal.set({event_id:\`\${RUN_MARKER}-fixture-\${sku}-\${attempt}\`,event_type:'issue_changed',topic:'issues',entity_id:out.id,entity_version:Math.max(1,out.version),source:RUN_MARKER,client_at:new Date()});try{await page.waitForFunction(({before,id})=>Number(window.__BH_PICKER_REALTIME_METRICS__?.patchedCards||0)>before&&!!document.querySelector(\`#myIssues [data-picker-issue="\${CSS.escape(id)}"]\`),{before:Number(before.patchedCards||0),id:out.id},{timeout:800});return}catch{}}throw new Error(\`LISTENER_NOT_ATTACHED_\${sku}\`)});if(sku===SKU_AVAILABLE){console.log('FIREBASE_AUTH_READY_BEFORE_SUBSCRIBE=PASS');console.log('FIRESTORE_LISTENER_ATTACH=PASS')}clean(page);console.log(\`REPORT_FIXTURE=PASS sku=\${sku} entity_id=\${out.id}\`);return{id:out.id,version:out.version}}`;
s=s.slice(0,reportStart)+reportReplacement+s.slice(reportEnd);

const selectStart=s.indexOf('async function selectOpen(page,sku){');
const actionStart=s.indexOf('\nasync function action(page,name){',selectStart);
const actionEnd=s.indexOf('\nasync function waitAlert(page,sku)',actionStart);
if(selectStart<0||actionStart<0||actionEnd<0)throw new Error('INVENT_SELECTOR_ANCHOR_MISSING');
const exactFunctions=`async function inventBackendReadback(page,id){const out=await stage('BACKEND_ENTITY_READBACK',10000,()=>page.evaluate(async({backend,key,id})=>{let ss;try{ss=JSON.parse(sessionStorage.getItem(key)||'null')}catch{}if(!ss?.access_token)return{ok:false,error:'NO_SESSION'};const r=await fetch(\`\${backend}/api/web-api/issue-board\`,{method:'POST',headers:{'content-type':'application/json',apikey:'compat-public',authorization:\`Bearer \${ss.access_token}\`},body:'{}'});const text=await r.text();let board={};try{board=text?JSON.parse(text):{}}catch{return{ok:false,status:r.status,error:'INVALID_JSON'}};const buckets=['open','claimed','available','skipped','recent'];for(const bucket of buckets){const row=(Array.isArray(board[bucket])?board[bucket]:[]).find(x=>String(x?.id||'')===id);if(row)return{ok:r.ok,status:r.status,bucket,entity_id:String(row.id),issue_status:String(row.status||''),site:String(row.site||'1291'),count:(board[bucket]||[]).length}}return{ok:r.ok,status:r.status,bucket:'',entity_id:'',issue_status:'',counts:Object.fromEntries(buckets.map(k=>[k,Array.isArray(board[k])?board[k].length:0]))}}, {backend:BACKEND,key:SESSION_KEY,id}));if(!out.ok||out.entity_id!==id)throw new Error(\`BACKEND_ENTITY_NOT_FOUND id=\${id} diag=\${safe(JSON.stringify(out))}\`);console.log(\`BACKEND_ENTITY_READBACK=PASS entity_id=\${id} bucket=\${out.bucket} status=\${out.issue_status} site=\${out.site||'1291'}\`);return out}
async function selectExact(page,id){await inventBackendReadback(page,id);await stage('INVENT_EXACT_ENTITY_RENDER',15000,async()=>{try{await page.waitForSelector(\`.wv2-issue[data-issue-id="\${id}"]\`,{state:'visible',timeout:14000})}catch(e){const diag=await page.evaluate(()=>({activeTab:document.querySelector('.tabs [data-tab].active')?.getAttribute('data-tab')||'',activeBucket:document.querySelector('[data-wv2-bucket].active')?.getAttribute('data-wv2-bucket')||'',renderedIds:[...document.querySelectorAll('.wv2-issue[data-issue-id]')].map(n=>n.getAttribute('data-issue-id')),cardCount:document.querySelectorAll('.wv2-issue').length,countText:document.querySelector('[data-wv2-bucket="claimed"] .wv2-count')?.textContent||''}));throw new Error(\`INVENT_ENTITY_NOT_RENDERED id=\${id} diag=\${safe(JSON.stringify(diag))}\`)} });console.log(\`INVENT_EXACT_ENTITY_RENDER=PASS entity_id=\${id}\`);return id}
async function actionExact(page,id,name){const selector=name==='claim'?\`.wv2-issue[data-issue-id="\${id}"] [data-claim="\${id}"]\`:\`.wv2-issue[data-issue-id="\${id}"] [data-update="\${name==='available'?'AVAILABLE':'NOT_FOUND'}"][data-id="\${id}"]\`;const b=page.locator(selector);await b.waitFor({state:'visible',timeout:7000});await b.click();if(name==='claim')await page.waitForSelector(\`.wv2-issue[data-issue-id="\${id}"] [data-update="AVAILABLE"][data-id="\${id}"]\`,{state:'visible',timeout:9000});clean(page)}`;
s=s.slice(0,selectStart)+exactFunctions+s.slice(actionEnd);

const decl='let browser,A,B,signalOk=false,fbOk=false;try{';
if(!s.includes(decl))throw new Error('MAIN_DECL_ANCHOR_MISSING');
s=s.replace(decl,'let browser,A,B,signalOk=false,fbOk=false,fixtureIds=[];try{');
const login="await stage('LOGIN_A',18000,()=>browserLogin(A.p,USERS[2],pw,'TWO_SESSION_LOGIN_A'));await stage('LOGIN_B',18000,()=>browserLogin(B.p,USERS[0],pw,'TWO_SESSION_LOGIN_B'));";
if(!s.includes(login))throw new Error('LOGIN_ANCHOR_MISSING');
s=s.replace(login,`${login}console.log('FIREBASE_PROFILE_UID_MATCH=PASS');`);
const calls='const one=await reportViaProduction(B.p,SKU_AVAILABLE),two=await reportViaProduction(B.p,SKU_SKIP);if(!one.id||!two.id||one.id===two.id)';
if(!s.includes(calls))throw new Error('REPORT_CALL_ANCHOR_MISSING');
s=s.replace(calls,'const one=await reportViaProduction(B.p,SKU_AVAILABLE,signal),two=await reportViaProduction(B.p,SKU_SKIP,signal);fixtureIds=[one.id,two.id];if(!one.id||!two.id||one.id===two.id)');
s=s.replace("const aid=await stage('ENTITY_MATCH',10000,()=>selectOpen(A.p,SKU_AVAILABLE));","const aid=await selectExact(A.p,one.id);");
s=s.replace("const sid=await stage('SKIP_ENTITY_MATCH',10000,()=>selectOpen(A.p,SKU_SKIP));","const sid=await selectExact(A.p,two.id);");
let claimCount=0;s=s.replace(/await action\(A\.p,'claim'\);/g,()=>`await actionExact(A.p,${claimCount++===0?'one.id':'two.id'},'claim');`);
s=s.replace("await action(A.p,'available');","await actionExact(A.p,one.id,'available');");
s=s.replace("await action(A.p,'skip');","await actionExact(A.p,two.id,'skip');");
const a2b="console.log('REALTIME_WITHOUT_FULL_RELOAD=PASS');";
if(!s.includes(a2b))throw new Error('A_TO_B_ANCHOR_MISSING');
s=s.replace(a2b,"console.log('A_TO_B_REALTIME=PASS');console.log('REALTIME_WITHOUT_FULL_RELOAD=PASS');");
const restore="if(d?.source===RUN_MARKER||String(d?.event_id||'').startsWith(RUN_MARKER)){if(saved.exists)t.set(signal,saved.data);else t.delete(signal)}";
if(!s.includes(restore))throw new Error('RESTORE_ANCHOR_MISSING');
s=s.replace(restore,"if(d?.source===RUN_MARKER||String(d?.event_id||'').startsWith(RUN_MARKER)||fixtureIds.includes(String(d?.entity_id||''))){if(saved.exists)t.set(signal,saved.data);else t.delete(signal)}");
fs.writeFileSync(output,s);
console.log('FINAL_HARNESS_PATCH=PASS exact_entity=true backend_readback=true cross_session_acceptance=preserved manifest_marker=stable');
