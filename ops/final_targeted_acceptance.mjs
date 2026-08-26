import fs from 'node:fs';
import crypto from 'node:crypto';

const OWNER_REPO='tam95supra-source/bao-hang-1291';
const STAFF_RUN=32960218893;
const STAFF_ARTIFACTS=[9603567727,9603568111];
const EVENTS_RUN=32957576262;
const EVENTS_SHA='f494681dbb264e82d510e198a8cf8bc4cdcd0d2a';
const GAS_RUN=32963984519;
const GAS_ARTIFACT=9604980653;
const STAFF_DIGEST='69f3162bdd4eaf53b007db1625184e2bc4a85821fbda40d0db69283f1d63a77d';
const APPS_SCRIPT_HASH='bd8c5868a49ee14d3acd9db2b9bb80421d4af670c1ed91bb28ab16b6bac1d342';
const STAFF_SHEET_ID='1E7ZWz-4eMcBliQxDYBVoogIoeSYyiaXGwj0I6mbMm78';
const STAFF_SHEET_NAME='DANH SÁCH NHÂN SỰ';
const API='https://script.googleapis.com/v1';
const req=n=>{const v=String(process.env[n]||'').trim();if(!v)throw new Error(`MISSING_${n}`);return v};
const sha=s=>crypto.createHash('sha256').update(String(s),'utf8').digest('hex');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function fetchText(url,opt={},timeout=30000){const r=await fetch(url,{...opt,signal:AbortSignal.timeout(timeout)});const t=await r.text();if(!r.ok)throw new Error(`HTTP_${r.status}:${url.split('?')[0]}`);return t}
async function fetchJson(url,opt={},timeout=30000){const t=await fetchText(url,opt,timeout);try{return JSON.parse(t)}catch{throw new Error('JSON_PARSE_FAILED')}}
async function retry(label,fn,n=3){let e;for(let i=1;i<=n;i++){try{return await fn()}catch(x){e=x;if(i===n)break;console.log(`${label}_RETRY=${i}`);await sleep(i*2000)}}throw e}

async function githubRun(id){return fetchJson(`https://api.github.com/repos/${OWNER_REPO}/actions/runs/${id}`,{headers:{Authorization:`Bearer ${req('GH_TOKEN')}`,Accept:'application/vnd.github+json'}})}
async function githubArtifacts(id){return fetchJson(`https://api.github.com/repos/${OWNER_REPO}/actions/runs/${id}/artifacts?per_page=100`,{headers:{Authorization:`Bearer ${req('GH_TOKEN')}`,Accept:'application/vnd.github+json'}})}

function parseCsv(s){const rows=[];let row=[],f='',q=false;for(let i=0;i<s.length;i++){const c=s[i];if(q){if(c==='"'&&s[i+1]==='"'){f+='"';i++}else if(c==='"')q=false;else f+=c}else if(c==='"')q=true;else if(c===','){row.push(f);f=''}else if(c==='\n'){row.push(f.replace(/\r$/,''));rows.push(row);row=[];f=''}else f+=c}if(f||row.length){row.push(f.replace(/\r$/,''));rows.push(row)}return rows}
function stableStaffJson(staff){return '['+staff.map(x=>JSON.stringify({contractor:x.contractor,department:x.department,employee_code:x.employee_code,full_name:x.full_name,role:x.role,source_position:x.source_position})).join(',')+']'}

async function staffSnapshot(){
  const u=new URL(`https://docs.google.com/spreadsheets/d/${STAFF_SHEET_ID}/gviz/tq`);u.searchParams.set('tqx','out:csv');u.searchParams.set('sheet',STAFF_SHEET_NAME);u.searchParams.set('tq','select A,B,D,E,F');
  const rows=parseCsv(await retry('STAFF_GSHEET_READ',()=>fetchText(u.toString(),{},30000)));
  const map=new Map();let invalid=0,dup=0;
  for(const r of rows.slice(1)){const [code='',name='',position='',contractor='',department='']=r.map(x=>String(x||'').trim());if(!code||!name){invalid++;continue}if(map.has(code)){dup++;continue}map.set(code,{employee_code:code,full_name:name,contractor,source_position:position,department,role:'PICKER'})}
  const staff=[...map.values()].sort((a,b)=>a.employee_code.localeCompare(b.employee_code));
  const digest=sha(stableStaffJson(staff));
  if(staff.length!==502||dup!==0||invalid!==0||digest!==STAFF_DIGEST)throw new Error(`STAFF_SNAPSHOT_DRIFT:${staff.length}:${dup}:${invalid}:${digest}`);
  console.log(`FINAL_STAFF_SNAPSHOT=PASS count=${staff.length} digest=${digest}`);
  return {count:staff.length,duplicates:dup,invalid,digest};
}

async function oauthToken(){const body=new URLSearchParams({client_id:req('GOOGLE_OAUTH_CLIENT_ID'),client_secret:req('GOOGLE_OAUTH_CLIENT_SECRET'),refresh_token:req('GOOGLE_OAUTH_REFRESH_TOKEN'),grant_type:'refresh_token'});const d=await fetchJson('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body},20000);if(!d.access_token)throw new Error('OAUTH_ACCESS_TOKEN_MISSING');return d.access_token}
const receiver=files=>{const a=(files||[]).filter(f=>f?.name==='STAFF_SOURCE_BRIDGE_RECEIVER');if(a.length===1)return a[0];const b=(files||[]).filter(f=>String(f?.source||'').includes('const BH_STAFF_BRIDGE'));if(b.length===1)return b[0];throw new Error('RECEIVER_NOT_UNIQUE')};

async function verifyAppsScript(){
  const token=await oauthToken(),scriptId=req('GAS_SCRIPT_ID'),deploymentId=req('GAS_DEPLOYMENT_ID'),h={Authorization:`Bearer ${token}`,'content-type':'application/json'};
  const dep=await retry('FINAL_GAS_DEPLOYMENT',()=>fetchJson(`${API}/projects/${encodeURIComponent(scriptId)}/deployments/${encodeURIComponent(deploymentId)}`,{headers:h},30000));
  if(dep.deploymentId!==deploymentId||dep.deploymentConfig?.scriptId!==scriptId)throw new Error('FINAL_GAS_POINTER_MISMATCH');
  const ver=Number(dep.deploymentConfig?.versionNumber||0);if(ver<1)throw new Error('FINAL_GAS_VERSION_INVALID');
  const content=await retry('FINAL_GAS_CONTENT',()=>fetchJson(`${API}/projects/${encodeURIComponent(scriptId)}/content?versionNumber=${ver}`,{headers:h},45000));
  const live=receiver(content.files);const liveHash=sha(live.source||'');
  const local=fs.readFileSync('google-apps-script/STAFF_SOURCE_BRIDGE_RECEIVER.gs','utf8'),localHash=sha(local);
  if(localHash!==APPS_SCRIPT_HASH||liveHash!==APPS_SCRIPT_HASH)throw new Error(`FINAL_GAS_HASH_MISMATCH:${localHash}:${liveHash}`);
  if(!local.includes('MAX_FULL_SOURCE_ROWS: 2000'))throw new Error('FINAL_GAS_GT500_GUARD_MISSING');
  const role=local.slice(local.indexOf('function staffSourceBridgeRole_('),local.indexOf('function staffSourceBridgeRole_(')+300);if(!role.includes("return 'PICKER';")||/ADMIN_INVENT|return 'INVENT'/.test(role))throw new Error('FINAL_GAS_ROLE_CONTRACT_BAD');
  const webhook=req('GOOGLE_SHEET_WEBHOOK_URL'),parts=new URL(webhook).pathname.split('/').filter(Boolean);if((parts[2]||'')!==deploymentId)throw new Error('FINAL_WEBHOOK_POINTER_MISMATCH');
  const ping=await retry('FINAL_GAS_PING',()=>fetchJson(webhook,{method:'POST',headers:{'content-type':'text/plain;charset=UTF-8'},body:JSON.stringify({action:'ping'})},30000));if(ping.ok!==true||ping.project!=='bao-hang-1291')throw new Error('FINAL_GAS_PING_BAD');
  console.log(`FINAL_APPS_SCRIPT_ACCEPTANCE=PASS version=${ver} hash=${liveHash}`);
  return {version:ver,hash:liveHash,webapp_ping:'PASS'};
}

async function billingGuard(){
  const sa=JSON.parse(req('FIREBASE_SERVICE_ACCOUNT'));if(!sa.client_email||!sa.private_key||sa.project_id!=='bao-hang-1291')throw new Error('BILLING_SA_INVALID');
  const enc=v=>Buffer.from(typeof v==='string'?v:JSON.stringify(v)).toString('base64url');const now=Math.floor(Date.now()/1000),header=enc({alg:'RS256',typ:'JWT'}),claim=enc({iss:sa.client_email,scope:'https://www.googleapis.com/auth/cloud-platform',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+900}),unsigned=`${header}.${claim}`,sig=crypto.sign('RSA-SHA256',Buffer.from(unsigned),sa.private_key).toString('base64url');
  const tok=await fetchJson('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:`${unsigned}.${sig}`})},20000);if(!tok.access_token)throw new Error('BILLING_TOKEN_MISSING');
  const b=await fetchJson('https://cloudbilling.googleapis.com/v1/projects/bao-hang-1291/billingInfo',{headers:{Authorization:`Bearer ${tok.access_token}`}},20000);if(b.billingEnabled===true)throw new Error('COST_GUARD_STOP');console.log('COST_GUARD=PASS billingEnabled=false');return {billingEnabled:false};
}

async function main(){
  const [staffRun,eventsRun,gasRun,staffArts,gasArts]=await Promise.all([githubRun(STAFF_RUN),githubRun(EVENTS_RUN),githubRun(GAS_RUN),githubArtifacts(STAFF_RUN),githubArtifacts(GAS_RUN)]);
  if(staffRun.conclusion!=='success')throw new Error('STAFF_RUN_NOT_SUCCESS');if(eventsRun.conclusion!=='success'||eventsRun.head_sha!==EVENTS_SHA)throw new Error('EVENTS_RUN_NOT_LOCKED_SUCCESS');if(gasRun.conclusion!=='success')throw new Error('GAS_RUN_NOT_SUCCESS');
  const staffIds=new Set((staffArts.artifacts||[]).map(a=>a.id));for(const id of STAFF_ARTIFACTS)if(!staffIds.has(id))throw new Error(`STAFF_ARTIFACT_MISSING_${id}`);if(!(gasArts.artifacts||[]).some(a=>a.id===GAS_ARTIFACT))throw new Error('GAS_ARTIFACT_MISSING');
  const liveSha=(await retry('WEB_DEPLOYED_SHA',()=>fetchText('https://bao-hang-1291.web.app/__deployed_sha.txt',{},20000))).trim();if(liveSha!==EVENTS_SHA)throw new Error(`LIVE_WEB_SHA_DRIFT:${liveSha}`);console.log('FINAL_EVENTS_PERFORMANCE_ACCEPTANCE=PASS');
  const snapshot=await staffSnapshot();const gas=await verifyAppsScript();const billing=await billingGuard();
  const evidence={status:'PASS',captured_at:new Date().toISOString(),locked:{staff_run:STAFF_RUN,staff_artifacts:STAFF_ARTIFACTS,events_run:EVENTS_RUN,events_sha:EVENTS_SHA,apps_script_run:GAS_RUN,apps_script_artifact:GAS_ARTIFACT},fresh:{staff_snapshot:snapshot,apps_script:gas,live_web_sha:liveSha,billing},markers:{FINAL_STAFF_SYNC_ACCEPTANCE:'PASS',FINAL_EVENTS_PERFORMANCE_ACCEPTANCE:'PASS',FINAL_APPS_SCRIPT_ACCEPTANCE:'PASS',COST_GUARD:'PASS',FINAL_PRODUCTION_ACCEPTANCE:'PASS'}};
  fs.mkdirSync('acceptance-evidence',{recursive:true});fs.writeFileSync('acceptance-evidence/final-production-acceptance.json',JSON.stringify(evidence,null,2));
  console.log('FINAL_STAFF_SYNC_ACCEPTANCE=PASS');console.log('FINAL_PRODUCTION_ACCEPTANCE=PASS');
}
main().catch(e=>{console.error(`FINAL_PRODUCTION_ACCEPTANCE=FAIL ${String(e?.message||e).replace(/[\r\n]+/g,' ').slice(0,500)}`);process.exit(1)});
