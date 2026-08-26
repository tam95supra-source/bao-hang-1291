'use strict';

const { initializeApp, cert, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { chromium } = require('playwright-core');

const SITE = 'https://bao-hang-1291.web.app/';
const API_KEY = 'AIzaSyB-n368fntzxsuuLlvte9NXhcuX0DDbTXM';
const PROJECT = 'bao-hang-1291';
const ADMIN_UID = '44fae0a2-09eb-4226-8412-0f1a1f5d7ef8';
const ADMIN_CODE = '6281280';
const SESSION_KEY = 'bao-hang-1291-web-session';
const NEON = process.env.NEON_DATA_API || '';
const CHROME = process.env.CHROME_BIN || '';

const safe = (value) => String(value ?? '')
  .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
  .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, '[JWT_REDACTED]')
  .slice(0, 1400);

function tokenMeta(token) {
  const [h, p] = String(token || '').split('.');
  const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  return {
    alg: header.alg,
    kid: header.kid || '',
    iss: payload.iss,
    aud: payload.aud,
    sub: payload.sub,
    exp: Number(payload.exp || 0),
  };
}

async function stage(label, fn, timeoutMs = 20000) {
  console.log(`TARGET_STAGE=${label}:BEGIN timeout_ms=${timeoutMs}`);
  let timer;
  try {
    const value = await Promise.race([
      Promise.resolve().then(fn),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}_TIMEOUT_${timeoutMs}MS`)), timeoutMs);
      }),
    ]);
    console.log(`TARGET_STAGE=${label}:PASS`);
    return value;
  } catch (error) {
    console.error(`TARGET_STAGE=${label}:FAIL error=${safe(error?.message || error)}`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, init, timeoutMs = 15000) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: safe(text) }; }
  return { response, payload };
}

async function exchangeCustomToken(customToken) {
  const { response, payload } = await fetchJson(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );
  if (!response.ok || !payload.idToken || !payload.refreshToken) {
    throw new Error(`CUSTOM_TOKEN_EXCHANGE_HTTP_${response.status}:${safe(payload?.error?.message)}`);
  }
  const meta = tokenMeta(payload.idToken);
  if (meta.iss !== `https://securetoken.google.com/${PROJECT}` || meta.aud !== PROJECT || meta.sub !== ADMIN_UID) {
    throw new Error(`CUSTOM_TOKEN_META_INVALID:${safe(JSON.stringify(meta))}`);
  }
  console.log(`ADMIN_CUSTOM_TOKEN_EXCHANGE=PASS uid_match=true iss=${meta.iss} aud=${meta.aud} kid=${meta.kid} exp_in=${meta.exp - Math.floor(Date.now()/1000)}`);
  return payload;
}

async function refreshToken(refreshToken) {
  const { response, payload } = await fetchJson(
    `https://securetoken.googleapis.com/v1/token?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    },
  );
  if (!response.ok || !payload.id_token || !payload.refresh_token) {
    throw new Error(`SECURE_TOKEN_REFRESH_HTTP_${response.status}:${safe(payload?.error?.message)}`);
  }
  const meta = tokenMeta(payload.id_token);
  if (meta.iss !== `https://securetoken.google.com/${PROJECT}` || meta.aud !== PROJECT || meta.sub !== ADMIN_UID) {
    throw new Error(`REFRESH_TOKEN_META_INVALID:${safe(JSON.stringify(meta))}`);
  }
  console.log(`ADMIN_SECURE_TOKEN_REFRESH=PASS uid_match=true iss=${meta.iss} aud=${meta.aud} kid=${meta.kid} exp_in=${meta.exp - Math.floor(Date.now()/1000)}`);
  return { idToken: payload.id_token, refreshToken: payload.refresh_token, expiresIn: Number(payload.expires_in || 3600) };
}

async function profile(idToken) {
  const { response, payload } = await fetchJson(
    `${NEON}/rpc/api_session_profile_rpc`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ p_test_role: null }),
    },
  );
  if (!response.ok) throw new Error(`ADMIN_PROFILE_HTTP_${response.status}:${safe(JSON.stringify(payload))}`);
  const p = payload?.profile;
  if (p?.id !== ADMIN_UID || p?.employee_code !== ADMIN_CODE || p?.role !== 'ADMIN' || p?.active !== true) {
    throw new Error(`ADMIN_PROFILE_MISMATCH:${safe(JSON.stringify(p))}`);
  }
  console.log('ADMIN_PROFILE_PRELOAD=PASS role=ADMIN active=true');
  return p;
}

function classifyUrl(url) {
  if (url.includes('securetoken.googleapis.com/v1/token')) return 'secure_token';
  if (url.includes('.neon.tech/') && url.includes('/rpc/api_session_profile_rpc')) return 'profile_rpc';
  if (url.startsWith(SITE)) return 'production_asset';
  return '';
}

async function main() {
  if (!NEON || !CHROME) throw new Error('TARGETED_E2E_ENV_MISSING');
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (sa.project_id !== PROJECT || !sa.client_email || !sa.private_key) throw new Error('FIREBASE_SCOPE_INVALID');

  const app = initializeApp({ credential: cert(sa) }, `target-admin-${Date.now()}`);
  const auth = getAuth(app);
  let browser;
  let context;
  const trace = [];
  const pageErrors = [];
  let phase = 'setup';
  const started = Date.now();

  try {
    const customToken = await stage('ADMIN_CREATE_CUSTOM_TOKEN', () => auth.createCustomToken(ADMIN_UID), 10000);
    const exchanged = await stage('ADMIN_EXCHANGE_CUSTOM_TOKEN', () => exchangeCustomToken(customToken), 15000);
    const refreshed = await stage('ADMIN_REFRESH_NODE', () => refreshToken(exchanged.refreshToken), 15000);
    const adminProfile = await stage('ADMIN_PROFILE_NODE', () => profile(refreshed.idToken), 15000);

    browser = await stage('BROWSER_LAUNCH', () => chromium.launch({
      executablePath: CHROME,
      headless: true,
      timeout: 20000,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    }), 22000);
    context = await stage('BROWSER_CONTEXT', () => browser.newContext({ viewport: { width: 1280, height: 900 } }), 8000);
    const page = await stage('BROWSER_PAGE', () => context.newPage(), 8000);
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(20000);

    const record = (kind, extra = {}) => trace.push({ t: Date.now() - started, phase, kind, ...extra });
    page.on('request', (request) => {
      const kind = classifyUrl(request.url());
      if (kind && kind !== 'production_asset') record(`${kind}_request`, { method: request.method() });
    });
    page.on('response', (response) => {
      const kind = classifyUrl(response.url());
      if (kind && kind !== 'production_asset') record(`${kind}_response`, { status: response.status() });
    });
    page.on('requestfailed', (request) => {
      const kind = classifyUrl(request.url());
      if (kind) record(`${kind}_failed`, { error: safe(request.failure()?.errorText || '') });
    });
    page.on('domcontentloaded', () => record('domcontentloaded'));
    page.on('load', () => record('load'));
    page.on('pageerror', (error) => pageErrors.push(`page:${safe(error?.message || error)}`));
    page.on('console', (message) => {
      if (message.type() === 'error') pageErrors.push(`console:${safe(message.text())}`);
    });

    phase = 'initial';
    await stage('ADMIN_INITIAL_PAGE', () => page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 18000 }), 20000);
    const initialLogin = await stage('ADMIN_INITIAL_LOGIN_DOM', () => page.locator('#loginForm').count(), 8000);
    if (!initialLogin) throw new Error('INITIAL_LOGIN_FORM_MISSING');

    const sessionBefore = {
      access_token: refreshed.idToken,
      refresh_token: refreshed.refreshToken,
      expires_at: Math.floor(Date.now()/1000) + refreshed.expiresIn,
      profile: adminProfile,
    };
    await stage('ADMIN_SESSION_SEED', () => page.evaluate(({ key, session }) => {
      sessionStorage.setItem(key, JSON.stringify(session));
      const read = JSON.parse(sessionStorage.getItem(key) || 'null');
      return Boolean(read?.access_token && read?.refresh_token && read?.profile?.role === 'ADMIN');
    }, { key: SESSION_KEY, session: sessionBefore }), 8000).then((ok) => {
      if (!ok) throw new Error('SESSION_SEED_READBACK_FAILED');
    });
    console.log('ADMIN_SESSION_STORAGE_BEFORE_RELOAD=PASS');

    phase = 'reload';
    await stage('ADMIN_RELOAD_COMMIT', () => page.reload({ waitUntil: 'commit', timeout: 12000 }), 14000);
    await stage('ADMIN_RELOAD_DOMCONTENTLOADED', () => page.waitForLoadState('domcontentloaded', { timeout: 18000 }), 20000);

    await stage('ADMIN_BOOTSTRAP_DOM', () => page.waitForFunction(() => {
      return Boolean(document.querySelector('.app-shell') || document.querySelector('#loginForm'));
    }, undefined, { timeout: 22000 }), 24000);

    const diag = await stage('ADMIN_BOOTSTRAP_READBACK', () => page.evaluate((key) => {
      let session = null;
      try { session = JSON.parse(sessionStorage.getItem(key) || 'null'); } catch {}
      const tokenMetaSafe = (() => {
        try {
          const p = JSON.parse(atob(String(session?.access_token || '').split('.')[1].replaceAll('-', '+').replaceAll('_', '/')));
          return { iss: p.iss || '', aud: p.aud || '', sub: p.sub || '', exp: Number(p.exp || 0) };
        } catch { return null; }
      })();
      return {
        readyState: document.readyState,
        href: location.href,
        hash: location.hash,
        hasShell: Boolean(document.querySelector('.app-shell')),
        hasLogin: Boolean(document.querySelector('#loginForm')),
        loginMessage: (document.querySelector('#loginMessage')?.textContent || '').trim(),
        role: session?.profile?.role || '',
        uid: session?.profile?.id || '',
        hasAccess: Boolean(session?.access_token),
        hasRefresh: Boolean(session?.refresh_token),
        expiresAt: Number(session?.expires_at || 0),
        authStability: globalThis.__BH_AUTH_STABILITY__ || null,
        tokenMeta: tokenMetaSafe,
      };
    }, SESSION_KEY), 10000);

    const secureResponses = trace.filter((x) => x.phase === 'reload' && x.kind === 'secure_token_response').map((x) => x.status);
    const profileResponses = trace.filter((x) => x.phase === 'reload' && x.kind === 'profile_rpc_response').map((x) => x.status);
    console.log(`ADMIN_BOOTSTRAP_TRACE=${safe(JSON.stringify(trace.filter((x) => x.phase === 'reload')))}`);
    console.log(`ADMIN_BOOTSTRAP_STATE=${safe(JSON.stringify(diag))}`);

    if (!diag.hasShell || diag.hasLogin) throw new Error(`ADMIN_APP_NOT_RENDERED login=${diag.hasLogin} message=${diag.loginMessage}`);
    if (diag.role !== 'ADMIN' || diag.uid !== ADMIN_UID || !diag.hasAccess || !diag.hasRefresh) throw new Error('ADMIN_SESSION_AFTER_RELOAD_INVALID');
    if (diag.tokenMeta?.iss !== `https://securetoken.google.com/${PROJECT}` || diag.tokenMeta?.aud !== PROJECT || diag.tokenMeta?.sub !== ADMIN_UID) throw new Error('ADMIN_BROWSER_TOKEN_META_INVALID');
    if (diag.authStability?.refreshTransport !== 'firebase_secure_token' || diag.authStability?.profileTransport !== 'api_session_profile_rpc') throw new Error(`AUTH_STABILITY_MARKER_INVALID:${safe(JSON.stringify(diag.authStability))}`);
    if (!secureResponses.includes(200)) throw new Error(`ADMIN_BROWSER_SECURE_TOKEN_MISSING statuses=${secureResponses.join(',')}`);
    if (!profileResponses.includes(200)) throw new Error(`ADMIN_BROWSER_PROFILE_RPC_MISSING statuses=${profileResponses.join(',')}`);
    if (pageErrors.length) throw new Error(`ADMIN_PAGE_ERRORS:${safe(pageErrors.join('|'))}`);

    console.log('ADMIN_BROWSER_SECURE_TOKEN_AFTER_RELOAD=PASS http=200');
    console.log('ADMIN_BROWSER_PROFILE_AFTER_RELOAD=PASS http=200');
    console.log('ADMIN_BROWSER_BOOTSTRAP_AFTER_RELOAD=PASS role=ADMIN project=bao-hang-1291');
    console.log('TARGETED_ADMIN_BOOTSTRAP=PASS');
  } catch (error) {
    console.error(`TARGETED_ADMIN_DIAG trace=${safe(JSON.stringify(trace))} page_errors=${safe(JSON.stringify(pageErrors))}`);
    throw error;
  } finally {
    if (context) await Promise.race([context.close().catch(() => {}), new Promise((r) => setTimeout(r, 5000))]);
    if (browser) await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 5000))]);
    await deleteApp(app).catch(() => {});
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
