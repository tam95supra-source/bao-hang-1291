import fs from 'node:fs';
import crypto from 'node:crypto';

const req = (name) => {
  const v = String(process.env[name] || '').trim();
  if (!v) throw new Error(`MISSING_${name}`);
  return v;
};
const sha256 = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
const apiBase = 'https://script.googleapis.com/v1';
const outDir = 'acceptance-evidence';
fs.mkdirSync(outDir, {recursive:true});

function normalizeReceiver(source) {
  const marker = 'function staffSourceBridgeRole_(';
  const start = source.indexOf(marker);
  if (start < 0) throw new Error('ROLE_FUNCTION_MISSING');
  const brace = source.indexOf('{', start);
  if (brace < 0) throw new Error('ROLE_FUNCTION_BRACE_MISSING');
  let depth = 0, end = -1;
  for (let i = brace; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  if (end < 0) throw new Error('ROLE_FUNCTION_UNBALANCED');
  const replacement = [
    'function staffSourceBridgeRole_(position, department, code) {',
    "  if (String(code) === BH_PROTECTED_ADMIN_CODE) return 'ADMIN';",
    "  return 'PICKER';",
    '}'
  ].join('\n');
  return source.slice(0, start) + replacement + source.slice(end);
}

function assertCanonical(source) {
  if (!source.includes('MAX_FULL_SOURCE_ROWS: 2000')) throw new Error('MAX_FULL_SOURCE_ROWS_NOT_2000');
  const start = source.indexOf('function staffSourceBridgeRole_(');
  const tail = source.slice(start, start + 300);
  if (!tail.includes("return 'PICKER';")) throw new Error('PICKER_ROLE_MISSING');
  if (/ADMIN_INVENT|return 'INVENT'/.test(tail)) throw new Error('ELEVATED_GSHEET_ROLE_REMAINS');
  new Function(source);
}

async function jsonFetch(url, options = {}, timeoutMs = 20000) {
  const r = await fetch(url, {...options, signal: AbortSignal.timeout(timeoutMs)});
  const text = await r.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = {raw:text.slice(0,500)}; }
  if (!r.ok) {
    const msg = data?.error?.message || data?.error_description || data?.error || `HTTP_${r.status}`;
    throw new Error(`API_${r.status}:${String(msg).slice(0,300)}`);
  }
  return data;
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function readRetry(label, fn, attempts = 3) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try { return await fn(); }
    catch (err) {
      last = err;
      if (i === attempts) break;
      console.log(`${label}_RETRY=${i}`);
      await sleep(i * 2500);
    }
  }
  throw last;
}

async function userRefreshAccessToken() {
  const body = new URLSearchParams({
    client_id: req('GOOGLE_OAUTH_CLIENT_ID'),
    client_secret: req('GOOGLE_OAUTH_CLIENT_SECRET'),
    refresh_token: req('GOOGLE_OAUTH_REFRESH_TOKEN'),
    grant_type: 'refresh_token'
  });
  const data = await jsonFetch('https://oauth2.googleapis.com/token', {
    method:'POST',
    headers:{'content-type':'application/x-www-form-urlencoded'},
    body
  });
  if (!data.access_token) throw new Error('USER_REFRESH_ACCESS_TOKEN_MISSING');
  return data.access_token;
}

async function serviceAccountScriptAccessToken() {
  const sa = JSON.parse(String(process.env.FIREBASE_SERVICE_ACCOUNT || '{}'));
  if (sa.project_id !== 'bao-hang-1291' || !sa.client_email || !sa.private_key) {
    throw new Error('SERVICE_ACCOUNT_SCOPE_MISSING');
  }
  const enc = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const header = enc({alg:'RS256',typ:'JWT'});
  const claim = enc({
    iss:sa.client_email,
    scope:'https://www.googleapis.com/auth/script.projects https://www.googleapis.com/auth/script.deployments',
    aud:'https://oauth2.googleapis.com/token',
    iat:now,
    exp:now+900
  });
  const unsigned = `${header}.${claim}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), sa.private_key).toString('base64url');
  const data = await jsonFetch('https://oauth2.googleapis.com/token', {
    method:'POST',
    headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({
      grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:`${unsigned}.${signature}`
    })
  });
  if (!data.access_token) throw new Error('SERVICE_ACCOUNT_ACCESS_TOKEN_MISSING');
  return data.access_token;
}

async function accessToken() {
  try {
    const token = await userRefreshAccessToken();
    console.log('APPS_SCRIPT_AUTH_MODE=USER_REFRESH');
    return token;
  } catch (userError) {
    console.log(`APPS_SCRIPT_AUTH_USER_REFRESH=UNAVAILABLE reason=${String(userError?.message || userError).replace(/[\r\n]+/g,' ').slice(0,220)}`);
    try {
      const token = await serviceAccountScriptAccessToken();
      console.log('APPS_SCRIPT_AUTH_MODE=SERVICE_ACCOUNT');
      return token;
    } catch (serviceError) {
      throw new Error(`APPS_SCRIPT_AUTH_UNAVAILABLE user=${String(userError?.message || userError).slice(0,160)} service_account=${String(serviceError?.message || serviceError).slice(0,160)}`);
    }
  }
}

const authHeaders = (token) => ({Authorization:`Bearer ${token}`,'content-type':'application/json'});
const pickReceiver = (files) => {
  const exact = files.filter(f => f?.name === 'STAFF_SOURCE_BRIDGE_RECEIVER');
  if (exact.length === 1) return exact[0];
  const marker = files.filter(f => String(f?.source || '').includes('const BH_STAFF_BRIDGE'));
  if (marker.length === 1) return marker[0];
  throw new Error(`LIVE_RECEIVER_MATCH_COUNT_${exact.length}_${marker.length}`);
};

async function main() {
  const scriptId = req('GAS_SCRIPT_ID');
  const deploymentId = req('GAS_DEPLOYMENT_ID');
  const sourcePath = 'google-apps-script/STAFF_SOURCE_BRIDGE_RECEIVER.gs';
  let canonical = fs.readFileSync(sourcePath, 'utf8');
  const normalized = normalizeReceiver(canonical);
  if (normalized !== canonical) {
    fs.writeFileSync(sourcePath, normalized, 'utf8');
    canonical = normalized;
    console.log('APPS_SCRIPT_REPO_ROLE_NORMALIZED=PASS');
  } else {
    console.log('APPS_SCRIPT_REPO_ROLE_NORMALIZED=ALREADY');
  }
  assertCanonical(canonical);
  const canonicalHash = sha256(canonical);
  console.log('APPS_SCRIPT_CANONICAL_SOURCE=PASS');
  console.log(`canonical_hash=${canonicalHash}`);

  const token = await accessToken();
  console.log('APPS_SCRIPT_OAUTH_REFRESH=PASS');

  const project = await jsonFetch(`${apiBase}/projects/${encodeURIComponent(scriptId)}`, {headers:authHeaders(token)});
  if (project.scriptId !== scriptId) throw new Error('SCRIPT_ID_READBACK_MISMATCH');
  console.log('APPS_SCRIPT_PROJECT_READBACK=PASS');

  const head = await readRetry('APPS_SCRIPT_HEAD_READBACK', () => jsonFetch(`${apiBase}/projects/${encodeURIComponent(scriptId)}/content`, {headers:authHeaders(token)}, 45000));
  if (!Array.isArray(head.files) || !head.files.length) throw new Error('LIVE_CONTENT_EMPTY');
  if (!head.files.some(f => f?.name === 'appsscript' && f?.type === 'JSON')) throw new Error('LIVE_MANIFEST_MISSING');
  const liveTarget = pickReceiver(head.files);
  const liveBeforeHash = sha256(liveTarget.source || '');

  const deploymentBefore = await readRetry('APPS_SCRIPT_DEPLOYMENT_READBACK', () => jsonFetch(`${apiBase}/projects/${encodeURIComponent(scriptId)}/deployments/${encodeURIComponent(deploymentId)}`, {headers:authHeaders(token)}, 30000));
  if (deploymentBefore.deploymentId !== deploymentId) throw new Error('DEPLOYMENT_ID_READBACK_MISMATCH');
  const cfg = deploymentBefore.deploymentConfig || {};
  if (cfg.scriptId && cfg.scriptId !== scriptId) throw new Error('DEPLOYMENT_SCRIPT_ID_MISMATCH');
  const oldVersion = Number(cfg.versionNumber || 0);
  if (!Number.isInteger(oldVersion) || oldVersion < 1) throw new Error('DEPLOYMENT_VERSION_INVALID');
  const oldVersionContent = await readRetry('APPS_SCRIPT_VERSION_READBACK', () => jsonFetch(`${apiBase}/projects/${encodeURIComponent(scriptId)}/content?versionNumber=${oldVersion}`, {headers:authHeaders(token)}, 45000));
  const oldVersionTarget = pickReceiver(oldVersionContent.files || []);
  const deployedBeforeHash = sha256(oldVersionTarget.source || '');
  console.log('APPS_SCRIPT_EXISTING_DEPLOYMENT_READBACK=PASS');

  let versionNumber = oldVersion;
  let changedHead = false;
  let deploymentUpdated = false;

  if (liveBeforeHash !== canonicalHash) {
    const files = head.files.map(f => ({name:f.name, type:f.type, source: f === liveTarget ? canonical : String(f.source || '')}));
    const updated = await jsonFetch(`${apiBase}/projects/${encodeURIComponent(scriptId)}/content`, {
      method:'PUT', headers:authHeaders(token), body:JSON.stringify({files})
    }, 30000);
    const updatedTarget = pickReceiver(updated.files || []);
    if (sha256(updatedTarget.source || '') !== canonicalHash) throw new Error('HEAD_UPDATE_HASH_MISMATCH');
    changedHead = true;
    console.log('APPS_SCRIPT_HEAD_UPDATE=PASS');
  } else {
    console.log('APPS_SCRIPT_HEAD_UPDATE=ALREADY');
  }

  if (deployedBeforeHash !== canonicalHash || changedHead) {
    const version = await jsonFetch(`${apiBase}/projects/${encodeURIComponent(scriptId)}/versions`, {
      method:'POST', headers:authHeaders(token), body:JSON.stringify({description:`Bao Hang staff bridge ${canonicalHash.slice(0,12)}`})
    });
    versionNumber = Number(version.versionNumber || 0);
    if (!Number.isInteger(versionNumber) || versionNumber <= oldVersion) throw new Error('NEW_VERSION_INVALID');
    console.log(`APPS_SCRIPT_VERSION_CREATE=PASS version=${versionNumber}`);

    const deploymentConfig = {
      scriptId,
      versionNumber,
      manifestFileName: String(cfg.manifestFileName || 'appsscript'),
      description: String(cfg.description || 'Bao Hang 1291 production')
    };
    const updatedDeployment = await jsonFetch(`${apiBase}/projects/${encodeURIComponent(scriptId)}/deployments/${encodeURIComponent(deploymentId)}`, {
      method:'PUT', headers:authHeaders(token), body:JSON.stringify({deploymentConfig})
    }, 30000);
    if (updatedDeployment.deploymentId !== deploymentId) throw new Error('DEPLOYMENT_UPDATE_ID_MISMATCH');
    if (Number(updatedDeployment.deploymentConfig?.versionNumber || 0) !== versionNumber) throw new Error('DEPLOYMENT_VERSION_READBACK_MISMATCH');
    deploymentUpdated = true;
    console.log('APPS_SCRIPT_EXISTING_DEPLOYMENT_UPDATE=PASS');
  } else {
    console.log('APPS_SCRIPT_EXISTING_DEPLOYMENT_UPDATE=ALREADY');
  }

  const versionContent = await readRetry('APPS_SCRIPT_FINAL_SOURCE_READBACK', () => jsonFetch(`${apiBase}/projects/${encodeURIComponent(scriptId)}/content?versionNumber=${versionNumber}`, {headers:authHeaders(token)}, 45000));
  const versionTarget = pickReceiver(versionContent.files || []);
  const deployedAfterHash = sha256(versionTarget.source || '');
  if (deployedAfterHash !== canonicalHash) throw new Error('DEPLOYED_SOURCE_HASH_MISMATCH');
  assertCanonical(versionTarget.source || '');

  const deploymentAfter = await readRetry('APPS_SCRIPT_FINAL_DEPLOYMENT_READBACK', () => jsonFetch(`${apiBase}/projects/${encodeURIComponent(scriptId)}/deployments/${encodeURIComponent(deploymentId)}`, {headers:authHeaders(token)}, 30000));
  if (deploymentAfter.deploymentId !== deploymentId) throw new Error('FINAL_DEPLOYMENT_ID_MISMATCH');
  if (Number(deploymentAfter.deploymentConfig?.versionNumber || 0) !== versionNumber) throw new Error('FINAL_DEPLOYMENT_VERSION_MISMATCH');

  const webhook = req('GOOGLE_SHEET_WEBHOOK_URL');
  const u = new URL(webhook);
  const pathParts = u.pathname.split('/').filter(Boolean);
  const webhookDeploymentId = pathParts[2] || '';
  if (webhookDeploymentId !== deploymentId) throw new Error('WEBHOOK_DEPLOYMENT_POINTER_MISMATCH');
  const ping = await readRetry('APPS_SCRIPT_WEBAPP_PING', () => jsonFetch(webhook, {
    method:'POST', headers:{'content-type':'text/plain;charset=UTF-8'}, body:JSON.stringify({action:'ping'})
  }, 30000));
  if (ping.ok !== true || ping.project !== 'bao-hang-1291') throw new Error('LIVE_WEBAPP_PING_FAILED');
  console.log('APPS_SCRIPT_LIVE_WEBAPP_PING=PASS');

  const evidence = {
    status:'PASS',
    captured_at:new Date().toISOString(),
    project_title:String(project.title || ''),
    script_id_match:true,
    deployment_id_match:true,
    deployment_id_suffix:deploymentId.slice(-8),
    canonical_hash:canonicalHash,
    head_before_hash:liveBeforeHash,
    deployed_before_hash:deployedBeforeHash,
    deployed_after_hash:deployedAfterHash,
    old_version:oldVersion,
    live_version:versionNumber,
    head_changed:changedHead,
    existing_deployment_updated:deploymentUpdated,
    max_full_source_rows:2000,
    gsheet_role_contract:'PICKER_ONLY_EXCEPT_PROTECTED_ADMIN',
    webapp_ping:'PASS',
    markers:{
      APPS_SCRIPT_OAUTH_REFRESH:'PASS',
      APPS_SCRIPT_PROJECT_READBACK:'PASS',
      APPS_SCRIPT_CANONICAL_SOURCE:'PASS',
      APPS_SCRIPT_EXISTING_DEPLOYMENT_READBACK:'PASS',
      APPS_SCRIPT_SOURCE_HASH_READBACK:'PASS',
      APPS_SCRIPT_GT500_GUARD:'PASS',
      APPS_SCRIPT_GSHEET_PICKER_CONTRACT:'PASS',
      APPS_SCRIPT_LIVE_WEBAPP_PING:'PASS'
    }
  };
  fs.writeFileSync(`${outDir}/apps-script-deploy.json`, JSON.stringify(evidence,null,2));
  console.log('APPS_SCRIPT_SOURCE_HASH_READBACK=PASS');
  console.log('APPS_SCRIPT_GT500_GUARD=PASS');
  console.log('APPS_SCRIPT_GSHEET_PICKER_CONTRACT=PASS');
  console.log('APPS_SCRIPT_DEPLOY_ACCEPTANCE=PASS');
}

main().catch(err => {
  console.error(`APPS_SCRIPT_DEPLOY_ACCEPTANCE=FAIL ${String(err?.message || err).replace(/[\r\n]+/g,' ').slice(0,500)}`);
  process.exit(1);
});
