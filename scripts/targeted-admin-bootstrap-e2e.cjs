'use strict';

const { initializeApp, cert, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { chromium } = require('playwright-core');

const SITE = 'https://bao-hang-1291.web.app/';
const ORIGIN = 'https://bao-hang-1291.web.app';
const API_KEY = 'AIzaSyB-n368fntzxsuuLlvte9NXhcuX0DDbTXM';
const PROJECT = 'bao-hang-1291';
const ADMIN_UID = '44fae0a2-09eb-4226-8412-0f1a1f5d7ef8';
const ADMIN_CODE = '6281280';
const SESSION_KEY = 'bao-hang-1291-web-session';
const NEON = process.env.NEON_DATA_API || '';
const GAS = process.env.APPS_SCRIPT_WORKER_URL || '';
const CHROME = process.env.CHROME_BIN || '';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const safe = (value) => String(value ?? '')
  .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
  .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, '[JWT_REDACTED]')
  .slice(0, 1800);

function tokenMeta(token) {
  const [h, p] = String(token || '').split('.');
  const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  return {
    alg: header.alg, kid: header.kid || '', iss: payload.iss || '', aud: payload.aud || '', sub: payload.sub || '',
    userId: payload.user_id || '', emailPresent: Boolean(payload.email), provider: payload.firebase?.sign_in_provider || '',
    keys: Object.keys(payload).sort(),
  };
}
function assertTokenMeta(meta, label) {
  if (meta.iss !== `https://securetoken.google.com/${PROJECT}` || meta.aud !== PROJECT || meta.sub !== ADMIN_UID) {
    throw new Error(`${label}_TOKEN_META_INVALID:${safe(JSON.stringify(meta))}`);
  }
}
async function stage(label, fn, timeoutMs = 20000) {
  console.log(`TARGET_STAGE=${label}:BEGIN timeout_ms=${timeoutMs}`);
  let timer;
  try {
    const value = await Promise.race([
      Promise.resolve().then(fn),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}_TIMEOUT_${timeoutMs}MS`)), timeoutMs); }),
    ]);
    console.log(`TARGET_STAGE=${label}:PASS`);
    return value;
  } catch (error) {
    console.error(`TARGET_STAGE=${label}:FAIL error=${safe(error?.message || error)}`);
    throw error;
  } finally { clearTimeout(timer); }
}
async function diagnosticStage(label, fn, timeoutMs = 15000) {
  try { return { ok: true, value: await stage(label, fn, timeoutMs) }; }
  catch (error) { console.log(`${label}=FAIL_CONTINUE_TO_BROWSER error=${safe(error?.message || error)}`); return { ok: false, error: safe(error?.message || error) }; }
}
async function fetchJson(url, init, timeoutMs = 15000) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: safe(text) }; }
  return { response, payload };
}
async function gasAction(idToken, action, extra = {}, timeoutMs = 30000) {
  const { response, payload } = await fetchJson(GAS, {
    method: 'POST',
    headers: { 'content-type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify({ action, id_token: idToken, ...extra }),
  }, timeoutMs);
  if (!response.ok) throw new Error(`GAS_${action}_HTTP_${response.status}:${safe(JSON.stringify(payload))}`);
  if (payload?.ok !== true) throw new Error(`GAS_${action}_FAILED:${safe(JSON.stringify(payload))}`);
  return payload;
}
async function exchangeCustomToken(customToken) {
  const { response, payload } = await fetchJson(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  if (!response.ok || !payload.idToken || !payload.refreshToken) throw new Error(`CUSTOM_TOKEN_EXCHANGE_HTTP_${response.status}:${safe(payload?.error?.message)}`);
  const meta = tokenMeta(payload.idToken); assertTokenMeta(meta, 'CUSTOM');
  console.log(`ADMIN_CUSTOM_TOKEN_EXCHANGE=PASS uid_match=true user_id_claim_match=${meta.userId === ADMIN_UID} email_present=${meta.emailPresent} provider=${meta.provider} iss=${meta.iss} aud=${meta.aud} kid=${meta.kid}`);
  return { idToken: payload.idToken, refreshToken: payload.refreshToken, expiresIn: Number(payload.expiresIn || 3600) };
}
async function refreshToken(refreshToken) {
  const { response, payload } = await fetchJson(`https://securetoken.googleapis.com/v1/token?key=${API_KEY}`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  if (!response.ok || !payload.id_token || !payload.refresh_token) throw new Error(`SECURE_TOKEN_REFRESH_HTTP_${response.status}:${safe(payload?.error?.message)}`);
  const meta = tokenMeta(payload.id_token); assertTokenMeta(meta, 'REFRESH');
  console.log(`ADMIN_SECURE_TOKEN_REFRESH=PASS uid_match=true user_id_claim_match=${meta.userId === ADMIN_UID} email_present=${meta.emailPresent} provider=${meta.provider} iss=${meta.iss} aud=${meta.aud} kid=${meta.kid}`);
  console.log(`ADMIN_TOKEN_CLAIM_KEYS source=refresh keys=${meta.keys.join(',')}`);
  return { idToken: payload.id_token, refreshToken: payload.refresh_token, expiresIn: Number(payload.expires_in || 3600) };
}
async function profile(idToken, label) {
  const { response, payload } = await fetchJson(`${NEON}/rpc/api_session_profile_rpc`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` }, body: JSON.stringify({ p_test_role: null }),
  });
  console.log(`ADMIN_PROFILE_HTTP source=${label} status=${response.status}`);
  if (!response.ok) throw new Error(`ADMIN_PROFILE_HTTP_${response.status}:${safe(JSON.stringify(payload))}`);
  const p = payload?.profile;
  if (p?.id !== ADMIN_UID || p?.employee_code !== ADMIN_CODE || p?.role !== 'ADMIN' || p?.active !== true) throw new Error(`ADMIN_PROFILE_MISMATCH:${safe(JSON.stringify(p))}`);
  console.log(`ADMIN_PROFILE=PASS source=${label} role=ADMIN active=true`);
  return p;
}
function classifyUrl(url) {
  if (url.includes('securetoken.googleapis.com/v1/token')) return 'secure_token';
  if (url.includes('.neon.tech/') && url.includes('/rpc/api_session_profile_rpc')) return 'profile_rpc';
  return '';
}
async function cdpDom(client) {
  const { root } = await client.send('DOM.getDocument', { depth: 0, pierce: true });
  const query = async (selector) => (await client.send('DOM.querySelector', { nodeId: root.nodeId, selector })).nodeId || 0;
  const shell = await query('.app-shell');
  const login = await query('#loginForm');
  const body = await query('body');
  let bodyHtml = '';
  if (body) bodyHtml = safe((await client.send('DOM.getOuterHTML', { nodeId: body })).outerHTML || '');
  return { hasShell: Boolean(shell), hasLogin: Boolean(login), bodyHtml };
}
async function pollCdpDom(client, timeoutMs = 20000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await cdpDom(client);
    if (last.hasShell || last.hasLogin) return last;
    await sleep(250);
  }
  last = await cdpDom(client);
  throw new Error(`CDP_DOM_TIMEOUT hasShell=${last.hasShell} hasLogin=${last.hasLogin} body=${last.bodyHtml}`);
}
async function cdpSessionStorage(client) {
  try {
    await client.send('DOMStorage.enable');
    const result = await client.send('DOMStorage.getDOMStorageItems', { storageId: { securityOrigin: ORIGIN, isLocalStorage: false } });
    const row = (result.entries || []).find(([key]) => key === SESSION_KEY);
    if (!row) return { present: false };
    const parsed = JSON.parse(row[1] || 'null');
    return { present: true, role: parsed?.profile?.role || '', uid: parsed?.profile?.id || '', hasAccess: Boolean(parsed?.access_token), hasRefresh: Boolean(parsed?.refresh_token) };
  } catch (error) { return { present: false, error: safe(error?.message || error) }; }
}

async function main() {
  if (!NEON || !GAS || !CHROME) throw new Error('TARGETED_E2E_ENV_MISSING');
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(GAS)) throw new Error('APPS_SCRIPT_WORKER_URL_INVALID');
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (sa.project_id !== PROJECT || !sa.client_email || !sa.private_key) throw new Error('FIREBASE_SCOPE_INVALID');
  const app = initializeApp({ credential: cert(sa) }, `target-admin-${Date.now()}`);
  const auth = getAuth(app);
  let browser, context;
  const trace = [], pageErrors = [];
  let phase = 'setup';
  const started = Date.now();
  try {
    const customToken = await stage('ADMIN_CREATE_CUSTOM_TOKEN', () => auth.createCustomToken(ADMIN_UID), 10000);
    const exchanged = await stage('ADMIN_EXCHANGE_CUSTOM_TOKEN', () => exchangeCustomToken(customToken), 15000);
    const adminProfile = await stage('ADMIN_PROFILE_EXCHANGED_TOKEN', () => profile(exchanged.idToken, 'custom_exchange'), 15000);

    const sourceStatus = await stage('STAFF_SOURCE_STATUS', () => gasAction(exchanged.idToken, 'staff-source-status', {}, 30000), 32000);
    if (sourceStatus.sheet_id !== '1E7ZWz-4eMcBliQxDYBVoogIoeSYyiaXGwj0I6mbMm78' || sourceStatus.sheet_name !== 'DANH SÁCH NHÂN SỰ' || sourceStatus.fallback_only !== false) {
      throw new Error(`STAFF_SOURCE_STATUS_MISMATCH:${safe(JSON.stringify(sourceStatus))}`);
    }
    console.log('STAFF_SOURCE_STATUS=PASS current_source=true');

    const sourceValidate = await stage('STAFF_SOURCE_NO_CHANGE_VALIDATE', () => gasAction(exchanged.idToken, 'staff-source-configure', {
      sheet_url: sourceStatus.sheet_url,
      sheet_name: sourceStatus.sheet_name,
    }, 60000), 62000);
    if (Number(sourceValidate.eligible_rows || 0) !== 502 ||
        sourceValidate.status !== 'NO_CHANGE' ||
        sourceValidate.changed !== false ||
        sourceValidate.validation_only !== true ||
        Number(sourceValidate.created || 0) !== 0 ||
        Number(sourceValidate.updated || 0) !== 0 ||
        Number(sourceValidate.deactivated || 0) !== 0 ||
        sourceValidate.cleanup?.skipped !== 'SAME_SOURCE_VALIDATION') {
      throw new Error(`STAFF_SOURCE_NO_CHANGE_MISMATCH:${safe(JSON.stringify(sourceValidate))}`);
    }
    console.log('STAFF_SOURCE_NO_CHANGE_VALIDATION=PASS eligible_rows=502 changed=false cleanup_skipped=true');

    const refreshDiag = await diagnosticStage('ADMIN_REFRESH_NODE', () => refreshToken(exchanged.refreshToken), 15000);
    if (refreshDiag.ok) await diagnosticStage('ADMIN_PROFILE_REFRESHED_TOKEN', () => profile(refreshDiag.value.idToken, 'node_refresh'), 15000);

    browser = await stage('BROWSER_LAUNCH', () => chromium.launch({ executablePath: CHROME, headless: true, timeout: 20000, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] }), 22000);
    context = await stage('BROWSER_CONTEXT', () => browser.newContext({ viewport: { width: 1280, height: 900 } }), 8000);
    const page = await stage('BROWSER_PAGE', () => context.newPage(), 8000);
    const cdp = await stage('CDP_SESSION', () => context.newCDPSession(page), 8000);
    await stage('CDP_DOM_ENABLE', () => cdp.send('DOM.enable'), 8000);
    page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(20000);
    const record = (kind, extra = {}) => trace.push({ t: Date.now() - started, phase, kind, ...extra });
    page.on('request', (request) => { const kind = classifyUrl(request.url()); if (kind) record(`${kind}_request`, { method: request.method() }); });
    page.on('response', (response) => { const kind = classifyUrl(response.url()); if (kind) record(`${kind}_response`, { status: response.status() }); });
    page.on('requestfinished', (request) => { const kind = classifyUrl(request.url()); if (kind) record(`${kind}_finished`); });
    page.on('requestfailed', (request) => { const kind = classifyUrl(request.url()); if (kind) record(`${kind}_failed`, { error: safe(request.failure()?.errorText || '') }); });
    page.on('pageerror', (error) => pageErrors.push(`page:${safe(error?.message || error)}`));
    page.on('console', (message) => { if (message.type() === 'error') pageErrors.push(`console:${safe(message.text())}`); });

    phase = 'initial';
    await stage('ADMIN_INITIAL_PAGE', () => page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 18000 }), 20000);
    const initialDom = await stage('ADMIN_INITIAL_CDP_DOM', () => cdpDom(cdp), 8000);
    if (!initialDom.hasLogin) throw new Error(`INITIAL_LOGIN_FORM_MISSING body=${initialDom.bodyHtml}`);
    await stage('ADMIN_SESSION_SEED', () => page.evaluate(({ key, session }) => {
      sessionStorage.setItem(key, JSON.stringify(session));
      const read = JSON.parse(sessionStorage.getItem(key) || 'null');
      return Boolean(read?.access_token && read?.refresh_token && read?.profile?.role === 'ADMIN');
    }, { key: SESSION_KEY, session: { access_token: exchanged.idToken, refresh_token: exchanged.refreshToken, expires_at: Math.floor(Date.now()/1000) + exchanged.expiresIn, profile: adminProfile } }), 8000).then((ok) => { if (!ok) throw new Error('SESSION_SEED_READBACK_FAILED'); });
    console.log('ADMIN_SESSION_STORAGE_BEFORE_RELOAD=PASS');

    phase = 'reload';
    await stage('ADMIN_RELOAD_COMMIT', () => page.reload({ waitUntil: 'commit', timeout: 12000 }), 14000);
    await stage('ADMIN_RELOAD_DOMCONTENTLOADED', () => page.waitForLoadState('domcontentloaded', { timeout: 18000 }), 20000);
    const storageAfterReload = await stage('ADMIN_STORAGE_CDP_READBACK', () => cdpSessionStorage(cdp), 8000);
    console.log(`ADMIN_STORAGE_AFTER_RELOAD=${safe(JSON.stringify(storageAfterReload))}`);
    const dom = await stage('ADMIN_BOOTSTRAP_CDP_DOM', () => pollCdpDom(cdp, 20000), 22000);
    const reloadTrace = trace.filter((x) => x.phase === 'reload');
    console.log(`ADMIN_BOOTSTRAP_TRACE=${safe(JSON.stringify(reloadTrace))}`);
    console.log(`ADMIN_BOOTSTRAP_CDP_STATE=${safe(JSON.stringify(dom))}`);
    if (pageErrors.length) console.log(`ADMIN_PAGE_ERRORS_DIAG=${safe(JSON.stringify(pageErrors))}`);

    const secureResponses = reloadTrace.filter((x) => x.kind === 'secure_token_response').map((x) => x.status);
    const profileResponses = reloadTrace.filter((x) => x.kind === 'profile_rpc_response').map((x) => x.status);
    const secureFinished = reloadTrace.some((x) => x.kind === 'secure_token_finished');
    const profileFinished = reloadTrace.some((x) => x.kind === 'profile_rpc_finished');
    if (!secureResponses.includes(200) || !secureFinished) throw new Error(`ADMIN_BROWSER_SECURE_TOKEN_INCOMPLETE statuses=${secureResponses.join(',')} finished=${secureFinished}`);
    if (!profileResponses.includes(200) || !profileFinished) throw new Error(`ADMIN_BROWSER_PROFILE_RPC_INCOMPLETE statuses=${profileResponses.join(',')} finished=${profileFinished}`);
    if (!dom.hasShell || dom.hasLogin) throw new Error(`ADMIN_APP_NOT_RENDERED hasShell=${dom.hasShell} hasLogin=${dom.hasLogin}`);
    if (!storageAfterReload.present || storageAfterReload.role !== 'ADMIN' || storageAfterReload.uid !== ADMIN_UID || !storageAfterReload.hasAccess || !storageAfterReload.hasRefresh) throw new Error(`ADMIN_SESSION_AFTER_RELOAD_INVALID:${safe(JSON.stringify(storageAfterReload))}`);

    console.log('ADMIN_BROWSER_SECURE_TOKEN_AFTER_RELOAD=PASS http=200 body_finished=true');
    console.log('ADMIN_BROWSER_PROFILE_AFTER_RELOAD=PASS http=200 body_finished=true');
    console.log('ADMIN_BROWSER_BOOTSTRAP_AFTER_RELOAD=PASS role=ADMIN project=bao-hang-1291 selector=.app-shell source=cdp');

    await stage('STAFF_SOURCE_UI_OPEN', async () => {
      const button = page.locator('button[data-tab="users"]');
      await button.waitFor({ state: 'visible', timeout: 15000 });
      await button.click();
      await page.locator('#opsStaffSourceForm').waitFor({ state: 'visible', timeout: 20000 });
    }, 24000);
    const sourceUi = await stage('STAFF_SOURCE_UI_READY', async () => {
      await page.waitForFunction(() => {
        const submit = document.querySelector('#opsStaffSourceSubmit');
        const state = document.querySelector('#opsStaffSourceState');
        return Boolean(submit && !submit.disabled && state && state.textContent.trim() !== 'ĐANG KIỂM TRA' && state.textContent.trim() !== 'CHƯA SẴN SÀNG');
      }, null, { timeout: 30000 });
      return page.evaluate(() => ({
        submitDisabled: document.querySelector('#opsStaffSourceSubmit')?.disabled ?? true,
        state: document.querySelector('#opsStaffSourceState')?.textContent?.trim() || '',
        sheetUrl: document.querySelector('#opsStaffSheetUrl')?.value || '',
        sheetName: document.querySelector('#opsStaffSheetName')?.value || '',
      }));
    }, 32000);
    if (sourceUi.submitDisabled || sourceUi.sheetName !== 'DANH SÁCH NHÂN SỰ' || !sourceUi.sheetUrl.includes('/spreadsheets/d/1E7ZWz-4eMcBliQxDYBVoogIoeSYyiaXGwj0I6mbMm78/')) {
      throw new Error(`STAFF_SOURCE_UI_INVALID:${safe(JSON.stringify(sourceUi))}`);
    }
    console.log(`STAFF_SOURCE_UI_ENABLE=PASS state=${sourceUi.state}`);

    console.log('TARGETED_ADMIN_BOOTSTRAP=PASS');
  } catch (error) {
    console.error(`TARGETED_ADMIN_DIAG trace=${safe(JSON.stringify(trace))} page_errors=${safe(JSON.stringify(pageErrors))}`);
    throw error;
  } finally {
    if (context) await Promise.race([context.close().catch(() => {}), sleep(5000)]);
    if (browser) await Promise.race([browser.close().catch(() => {}), sleep(5000)]);
    await deleteApp(app).catch(() => {});
  }
}
main().catch((error) => { console.error(error?.stack || error); process.exitCode = 1; });
