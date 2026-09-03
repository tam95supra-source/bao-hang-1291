import fs from 'node:fs';
import crypto from 'node:crypto';

const req = (name) => {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`MISSING_${name}`);
  return value;
};
const sha256 = (value) => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
const apiBase = 'https://script.googleapis.com/v1';
const outDir = 'acceptance-evidence';
fs.mkdirSync(outDir, {recursive:true});

const oldWorkerBlock = `    const tick = neonRpc_('worker_tick_rpc', {}, token);
    const notifications = drainNotifications_(token);
    const pushes = drainPushes_(token);
    const sheet = drainSheet_(token);
    const realtime = drainRealtime_(token);
    maybeCleanup_(token);
    const schedule = neonRpc_('worker_schedule_rpc', {p_realtime_enabled:true}, token);
    scheduleAdaptiveTrigger_(schedule && schedule.next_at ? String(schedule.next_at) : '');
    return {ok:true,source:source,tick:tick,notifications:notifications,pushes:pushes,sheet:sheet,realtime:realtime,schedule:schedule};`;

const newWorkerBlock = `    const tick = neonRpc_('worker_tick_rpc', {}, token);

    // Latency-sensitive transport must never sit behind Google Sheet export.
    // A CLIENT_KICK is the foreground fast path: publish realtime/FCM first and
    // leave bulk Sheet export + cleanup to adaptive/safety workers.
    const realtime = drainRealtime_(token);
    const notifications = drainNotifications_(token);
    const pushes = drainPushes_(token);
    const sheet = source === 'CLIENT_KICK' ? {count:0,skipped:'CLIENT_KICK'} : drainSheet_(token);
    if (source !== 'CLIENT_KICK') maybeCleanup_(token);
    const schedule = neonRpc_('worker_schedule_rpc', {p_realtime_enabled:true}, token);
    scheduleAdaptiveTrigger_(schedule && schedule.next_at ? String(schedule.next_at) : '');
    return {ok:true,source:source,tick:tick,realtime:realtime,notifications:notifications,pushes:pushes,sheet:sheet,schedule:schedule};`;

function patchWorker(source) {
  if (source.includes(newWorkerBlock)) return source;
  if (!source.includes(oldWorkerBlock)) throw new Error('WORKER_TICK_CANONICAL_BLOCK_NOT_FOUND');
  return source.replace(oldWorkerBlock, newWorkerBlock);
}

function assertWorker(source) {
  if (!source.includes("const realtime = drainRealtime_(token);")) throw new Error('REALTIME_DRAIN_MISSING');
  if (!source.includes("source === 'CLIENT_KICK' ? {count:0,skipped:'CLIENT_KICK'} : drainSheet_(token)")) throw new Error('CLIENT_KICK_SHEET_BYPASS_MISSING');
  if (!source.includes("if (source !== 'CLIENT_KICK') maybeCleanup_(token);")) throw new Error('CLIENT_KICK_CLEANUP_BYPASS_MISSING');
  const tickStart = source.indexOf('function workerTick_(source)');
  const tickEnd = source.indexOf('function installWorkerTriggers_', tickStart);
  if (tickStart < 0 || tickEnd < 0) throw new Error('WORKER_TICK_FUNCTION_MISSING');
  const body = source.slice(tickStart, tickEnd);
  const realtimeAt = body.indexOf('const realtime = drainRealtime_(token);');
  const sheetAt = body.indexOf("const sheet = source === 'CLIENT_KICK'");
  if (realtimeAt < 0 || sheetAt < 0 || realtimeAt >= sheetAt) throw new Error('REALTIME_NOT_PRIORITIZED');
  new Function(source);
}

async function jsonFetch(url, options = {}, timeoutMs = 30000) {
  const response = await fetch(url, {...options, signal: AbortSignal.timeout(timeoutMs)});
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = {raw:text.slice(0,500)}; }
  if (!response.ok) {
    const msg = data?.error?.message || data?.error_description || data?.error || `HTTP_${response.status}`;
    throw new Error(`API_${response.status}:${String(msg).slice(0,300)}`);
  }
  return data;
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function readRetry(label, fn, attempts = 3) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try { return await fn(); }
    catch (error) {
      last = error;
      if (i === attempts) break;
      console.log(`${label}_RETRY=${i}`);
      await sleep(i * 2500);
    }
  }
  throw last;
}

async function readUntil(label, fn, accept, attempts = 8) {
  let lastValue = null;
  let lastError = null;
  for (let i = 1; i <= attempts; i++) {
    try {
      const value = await fn();
      lastValue = value;
      if (accept(value)) return value;
      lastError = new Error(`${label}_NOT_PROPAGATED`);
    } catch (error) {
      lastError = error;
    }
    if (i < attempts) {
      console.log(`${label}_WAIT=${i}`);
      await sleep(Math.min(10000, 1500 * i));
    }
  }
  if (lastError) throw lastError;
  throw new Error(`${label}_FAILED:${JSON.stringify(lastValue).slice(0,200)}`);
}

const envValue = (name) => String(process.env[name] || '').trim();

function oauthCandidate(label, clientId, clientSecret, refreshToken) {
  const client_id = String(clientId || '').trim();
  const client_secret = String(clientSecret || '').trim();
  const refresh_token = String(refreshToken || '').trim();
  if (!client_id || !client_secret || !refresh_token) return null;
  return {label, client_id, client_secret, refresh_token};
}

function candidatesFromClaspJson(raw, label) {
  if (!String(raw || '').trim()) return [];
  let obj;
  try { obj = JSON.parse(String(raw)); } catch { return []; }
  const out = [];
  const add = (suffix, clientId, clientSecret, refreshToken) => {
    const c = oauthCandidate(`${label}${suffix}`, clientId, clientSecret, refreshToken);
    if (c) out.push(c);
  };

  // Legacy clasp: {"tokens":{"default":{"client_id","client_secret","refresh_token"}}}
  const tokens = obj?.tokens;
  if (tokens && typeof tokens === 'object') {
    for (const [name, value] of Object.entries(tokens)) {
      if (!value || typeof value !== 'object') continue;
      add(name === 'default' ? '' : '_TOKENSET', value.client_id || value.clientId, value.client_secret || value.clientSecret, value.refresh_token || value.refreshToken);
    }
  }

  // Current clasp: token + oauth2ClientSettings.
  const token = obj?.token && typeof obj.token === 'object' ? obj.token : {};
  const settings = obj?.oauth2ClientSettings && typeof obj.oauth2ClientSettings === 'object' ? obj.oauth2ClientSettings : {};
  add('_SETTINGS', settings.clientId || settings.client_id, settings.clientSecret || settings.client_secret, token.refresh_token || token.refreshToken);

  // Authorized-user JSON and a few historical flat variants.
  add('_FLAT', obj?.client_id || obj?.clientId, obj?.client_secret || obj?.clientSecret, obj?.refresh_token || obj?.refreshToken);

  return out;
}

function oauthCandidates() {
  const all = [];
  const add = (candidate) => { if (candidate) all.push(candidate); };

  add(oauthCandidate(
    'GOOGLE_OAUTH',
    envValue('GOOGLE_OAUTH_CLIENT_ID'),
    envValue('GOOGLE_OAUTH_CLIENT_SECRET'),
    envValue('GOOGLE_OAUTH_REFRESH_TOKEN')
  ));
  add(oauthCandidate(
    'APPS_SCRIPT_OAUTH_ALT',
    envValue('APPS_SCRIPT_OAUTH_CLIENT_ID'),
    envValue('APPS_SCRIPT_OAUTH_CLIENT_SECRET'),
    envValue('APPS_SCRIPT_OAUTH_REFRESH_TOKEN')
  ));
  all.push(...candidatesFromClaspJson(envValue('CLASPRC_JSON'), 'CLASPRC_JSON'));
  all.push(...candidatesFromClaspJson(envValue('CLASP_TOKEN'), 'CLASP_TOKEN'));

  const seen = new Set();
  return all.filter((candidate) => {
    // Deduplicate without logging any credential material.
    const fingerprint = sha256(`${candidate.client_id}\0${candidate.refresh_token}`);
    if (seen.has(fingerprint)) return false;
    seen.add(fingerprint);
    return true;
  });
}

async function refreshUserAccessToken(candidate) {
  const data = await jsonFetch('https://oauth2.googleapis.com/token', {
    method:'POST',
    headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({
      client_id:candidate.client_id,
      client_secret:candidate.client_secret,
      refresh_token:candidate.refresh_token,
      grant_type:'refresh_token'
    })
  });
  if (!data.access_token) throw new Error('ACCESS_TOKEN_MISSING');
  return data.access_token;
}

async function accessToken() {
  const candidates = oauthCandidates();
  if (!candidates.length) throw new Error('APPS_SCRIPT_USER_OAUTH_REAUTH_REQUIRED:NO_USER_OAUTH_CANDIDATES');

  for (const candidate of candidates) {
    try {
      const token = await refreshUserAccessToken(candidate);
      console.log(`APPS_SCRIPT_AUTH_MODE=${candidate.label}`);
      return token;
    } catch (_) {
      // Never print OAuth errors here: provider payloads can contain credential metadata.
      console.log(`APPS_SCRIPT_AUTH_CANDIDATE_${candidate.label}=UNAVAILABLE`);
    }
  }
  throw new Error('APPS_SCRIPT_USER_OAUTH_REAUTH_REQUIRED:ALL_USER_REFRESH_TOKENS_UNAVAILABLE');
}

const authHeaders = (token) => ({Authorization:`Bearer ${token}`,'content-type':'application/json'});
function pickWorker(files) {
  const exact = files.filter(file => file?.name === 'DEPLOY_NEON');
  if (exact.length === 1) return exact[0];
  const marker = files.filter(file => String(file?.source || '').includes("const BH_PROJECT = 'bao-hang-1291';") && String(file?.source || '').includes('function workerTick_(source)'));
  if (marker.length === 1) return marker[0];
  throw new Error(`LIVE_WORKER_MATCH_COUNT_${exact.length}_${marker.length}`);
}

async function main() {
  const scriptId = req('GAS_SCRIPT_ID');
  const deploymentId = req('GAS_DEPLOYMENT_ID');
  const sourcePath = 'google-apps-script/DEPLOY_NEON.gs';
  let canonical = fs.readFileSync(sourcePath, 'utf8');
  const patched = patchWorker(canonical);
  if (patched !== canonical) {
    fs.writeFileSync(sourcePath, patched, 'utf8');
    canonical = patched;
    console.log('WORKER_REPO_PATCH=PASS');
  } else {
    console.log('WORKER_REPO_PATCH=ALREADY');
  }
  assertWorker(canonical);
  const canonicalHash = sha256(canonical);

  const token = await accessToken();
  console.log('APPS_SCRIPT_OAUTH_REFRESH=PASS');
  const project = await jsonFetch(`${apiBase}/projects/${encodeURIComponent(scriptId)}`, {headers:authHeaders(token)});
  if (project.scriptId !== scriptId) throw new Error('SCRIPT_ID_READBACK_MISMATCH');

  const head = await readRetry('WORKER_HEAD_READBACK', () => jsonFetch(`${apiBase}/projects/${encodeURIComponent(scriptId)}/content`, {headers:authHeaders(token)}, 45000));
  if (!Array.isArray(head.files) || !head.files.length) throw new Error('LIVE_CONTENT_EMPTY');
  const liveWorker = pickWorker(head.files);
  const liveBeforeHash = sha256(liveWorker.source || '');

  const deploymentBefore = await readRetry('WORKER_DEPLOYMENT_READBACK', () => jsonFetch(`${apiBase}/projects/${encodeURIComponent(scriptId)}/deployments/${encodeURIComponent(deploymentId)}`, {headers:authHeaders(token)}));
  const cfg = deploymentBefore.deploymentConfig || {};
  const oldVersion = Number(cfg.versionNumber || 0);
  if (!Number.isInteger(oldVersion) || oldVersion < 1) throw new Error('DEPLOYMENT_VERSION_INVALID');
  const oldVersionContent = await readRetry('WORKER_VERSION_READBACK', () => jsonFetch(`${apiBase}/projects/${encodeURIComponent(scriptId)}/content?versionNumber=${oldVersion}`, {headers:authHeaders(token)}, 45000));
  const deployedBeforeHash = sha256(pickWorker(oldVersionContent.files || []).source || '');

  let versionNumber = oldVersion;
  let changedHead = false;
  let deploymentUpdated = false;

  if (liveBeforeHash !== canonicalHash) {
    const files = head.files.map(file => ({name:file.name, type:file.type, source:file === liveWorker ? canonical : String(file.source || '')}));
    const updated = await jsonFetch(`${apiBase}/projects/${encodeURIComponent(scriptId)}/content`, {
      method:'PUT', headers:authHeaders(token), body:JSON.stringify({files})
    }, 45000);
    if (sha256(pickWorker(updated.files || []).source || '') !== canonicalHash) throw new Error('HEAD_UPDATE_HASH_MISMATCH');
    changedHead = true;
    console.log('WORKER_HEAD_UPDATE=PASS');
  } else {
    console.log('WORKER_HEAD_UPDATE=ALREADY');
  }

  if (deployedBeforeHash !== canonicalHash || changedHead) {
    const version = await jsonFetch(`${apiBase}/projects/${encodeURIComponent(scriptId)}/versions`, {
      method:'POST', headers:authHeaders(token), body:JSON.stringify({description:`Bao Hang realtime worker ${canonicalHash.slice(0,12)}`})
    });
    versionNumber = Number(version.versionNumber || 0);
    if (!Number.isInteger(versionNumber) || versionNumber <= oldVersion) throw new Error('NEW_VERSION_INVALID');
    const deploymentConfig = {
      scriptId,
      versionNumber,
      manifestFileName:String(cfg.manifestFileName || 'appsscript'),
      description:String(cfg.description || 'Bao Hang 1291 production')
    };
    const updatedDeployment = await jsonFetch(`${apiBase}/projects/${encodeURIComponent(scriptId)}/deployments/${encodeURIComponent(deploymentId)}`, {
      method:'PUT', headers:authHeaders(token), body:JSON.stringify({deploymentConfig})
    });
    if (updatedDeployment.deploymentId !== deploymentId || Number(updatedDeployment.deploymentConfig?.versionNumber || 0) !== versionNumber) throw new Error('DEPLOYMENT_UPDATE_READBACK_MISMATCH');
    deploymentUpdated = true;
    console.log(`WORKER_DEPLOYMENT_UPDATE=PASS version=${versionNumber}`);
  } else {
    console.log('WORKER_DEPLOYMENT_UPDATE=ALREADY');
  }

  const finalContent = await readUntil(
    'WORKER_FINAL_SOURCE_READBACK',
    () => jsonFetch(`${apiBase}/projects/${encodeURIComponent(scriptId)}/content?versionNumber=${versionNumber}`, {headers:authHeaders(token)}, 45000),
    value => {
      try { return sha256(pickWorker(value.files || []).source || '') === canonicalHash; }
      catch { return false; }
    }
  );
  const deployedSource = pickWorker(finalContent.files || []).source || '';
  const deployedAfterHash = sha256(deployedSource);
  if (deployedAfterHash !== canonicalHash) throw new Error('DEPLOYED_SOURCE_HASH_MISMATCH');
  assertWorker(deployedSource);

  const deploymentAfter = await readUntil(
    'WORKER_FINAL_DEPLOYMENT_READBACK',
    () => jsonFetch(`${apiBase}/projects/${encodeURIComponent(scriptId)}/deployments/${encodeURIComponent(deploymentId)}`, {headers:authHeaders(token)}),
    value => value.deploymentId === deploymentId && Number(value.deploymentConfig?.versionNumber || 0) === versionNumber
  );
  if (Number(deploymentAfter.deploymentConfig?.versionNumber || 0) !== versionNumber) throw new Error('FINAL_DEPLOYMENT_VERSION_MISMATCH');

  const webhook = req('GOOGLE_SHEET_WEBHOOK_URL');
  const url = new URL(webhook);
  const pathParts = url.pathname.split('/').filter(Boolean);
  if ((pathParts[2] || '') !== deploymentId) throw new Error('WEBHOOK_DEPLOYMENT_POINTER_MISMATCH');
  const ping = await readRetry('WORKER_WEBAPP_PING', () => jsonFetch(webhook, {
    method:'POST', headers:{'content-type':'text/plain;charset=UTF-8'}, body:JSON.stringify({action:'ping'})
  }));
  if (ping.ok !== true || ping.project !== 'bao-hang-1291') throw new Error('LIVE_WEBAPP_PING_FAILED');

  const evidence = {
    status:'PASS', captured_at:new Date().toISOString(), project_title:String(project.title || ''),
    canonical_hash:canonicalHash, head_before_hash:liveBeforeHash, deployed_before_hash:deployedBeforeHash,
    deployed_after_hash:deployedAfterHash, old_version:oldVersion, live_version:versionNumber,
    head_changed:changedHead, existing_deployment_updated:deploymentUpdated,
    contract:{realtime_before_sheet:true,client_kick_sheet_bypass:true,client_kick_cleanup_bypass:true},
    webapp_ping:'PASS'
  };
  fs.writeFileSync(`${outDir}/apps-script-worker-deploy.json`, JSON.stringify(evidence,null,2));
  console.log('WORKER_REALTIME_PRIORITY=PASS');
  console.log('WORKER_CLIENT_KICK_FAST_PATH=PASS');
  console.log('WORKER_DEPLOY_ACCEPTANCE=PASS');
}

main().catch(error => {
  console.error(`WORKER_DEPLOY_ACCEPTANCE=FAIL ${String(error?.message || error).replace(/[\r\n]+/g,' ').slice(0,500)}`);
  process.exit(1);
});
