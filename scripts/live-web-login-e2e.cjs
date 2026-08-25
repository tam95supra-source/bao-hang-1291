'use strict';

const crypto = require('crypto');
const { initializeApp, cert, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { chromium } = require('playwright-core');

const SITE_URL = 'https://bao-hang-1291.web.app/';
const FIREBASE_API_KEY = 'AIzaSyB-n368fntzxsuuLlvte9NXhcuX0DDbTXM';
const TEST_UID = '12910000-0000-4000-8000-00000000e2e1';
const TEST_CODE = 'e2eweb1291';
const TEST_EMAIL = `${TEST_CODE}@bao-hang-1291.local`;
const SESSION_KEY = 'bao-hang-1291-web-session';
const NEON_DATA_API = process.env.NEON_DATA_API || '';
const CHROME_BIN = process.env.CHROME_BIN || '';

function required(value, label) {
  if (!value) throw new Error(`${label} is required`);
  return value;
}

async function fetchDeadline(url, init = {}, timeoutMs = 12000) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

function decodeJwtPart(part) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

function safeResponseText(value) {
  return String(value || '')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, '[JWT_REDACTED]')
    .slice(0, 1200);
}

async function deleteTestUser(auth) {
  try {
    await auth.deleteUser(TEST_UID);
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') throw error;
  }
}

async function main() {
  const serviceAccount = JSON.parse(required(process.env.FIREBASE_SERVICE_ACCOUNT, 'FIREBASE_SERVICE_ACCOUNT'));
  if (serviceAccount.project_id !== 'bao-hang-1291') throw new Error('Firebase service account is out of scope');
  required(NEON_DATA_API, 'NEON_DATA_API');
  required(CHROME_BIN, 'CHROME_BIN');

  const app = initializeApp({ credential: cert(serviceAccount) }, `web-login-e2e-${Date.now()}`);
  const adminAuth = getAuth(app);
  const password = `E2e!${crypto.randomBytes(18).toString('base64url')}Aa1`;
  let browser;

  try {
    await deleteTestUser(adminAuth);
    await adminAuth.createUser({ uid: TEST_UID, email: TEST_EMAIL, password, disabled: false });

    const signInResponse = await fetchDeadline(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(FIREBASE_API_KEY)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: TEST_EMAIL, password, returnSecureToken: true }),
      },
    );
    const signIn = await signInResponse.json();
    if (!signInResponse.ok || !signIn.idToken || signIn.localId !== TEST_UID) {
      throw new Error(`Firebase password sign-in failed HTTP ${signInResponse.status}: ${signIn?.error?.message || 'invalid response'}`);
    }

    const [jwtHeaderPart, jwtPayloadPart] = signIn.idToken.split('.');
    const jwtHeader = decodeJwtPart(jwtHeaderPart);
    const jwtPayload = decodeJwtPart(jwtPayloadPart);
    console.log(`FIREBASE_ID_TOKEN_META alg=${jwtHeader.alg || ''} kid=${jwtHeader.kid || ''} iss=${jwtPayload.iss || ''} aud=${jwtPayload.aud || ''} sub_is_test=${jwtPayload.sub === TEST_UID}`);

    const profileResponse = await fetchDeadline(`${NEON_DATA_API}/rpc/api_session_profile_rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${signIn.idToken}` },
      body: JSON.stringify({ p_test_role: null }),
    });
    const profileRaw = await profileResponse.text();
    let profilePayload = null;
    try { profilePayload = JSON.parse(profileRaw); } catch {}
    if (!profileResponse.ok) {
      throw new Error(`Neon session profile failed HTTP ${profileResponse.status}: ${safeResponseText(profileRaw) || '[empty body]'}`);
    }
    if (profilePayload?.profile?.employee_code !== TEST_CODE || profilePayload?.profile?.role !== 'PICKER' || profilePayload?.profile?.active !== true) {
      throw new Error('Neon session profile did not resolve the isolated E2E user');
    }
    console.log('WEB_LOGIN_BACKEND_E2E=PASS');

    browser = await chromium.launch({ executablePath: CHROME_BIN, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(String(error?.message || error)));

    await page.goto(SITE_URL, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.locator('#employeeCode').fill(TEST_CODE);
    await page.locator('#password').fill(password);
    await page.locator('#loginForm button[type="submit"], #loginForm button').first().click();

    await page.waitForFunction(() => {
      if (document.querySelector('.app-shell')) return true;
      const text = document.querySelector('#loginMessage')?.textContent?.trim() || '';
      return Boolean(text && !text.includes('Đang xác thực'));
    }, null, { timeout: 20000 });

    if (!await page.locator('.app-shell').count()) {
      const loginError = await page.locator('#loginMessage').textContent().catch(() => 'Không rõ lỗi');
      throw new Error(`Live browser login failed: ${String(loginError || '').trim()}`);
    }

    await page.waitForSelector('#skuSearch', { timeout: 15000 });
    await page.waitForFunction(() => document.querySelector('[data-health="REALTIME"] em')?.textContent?.trim() === 'TRỰC TUYẾN', null, { timeout: 12000 });
    await page.waitForTimeout(1200);

    const liveState = await page.evaluate((sessionKey) => {
      const session = JSON.parse(sessionStorage.getItem(sessionKey) || 'null');
      const errors = [...document.querySelectorAll('.message[data-type="error"]')]
        .map((node) => node.textContent?.trim() || '')
        .filter(Boolean);
      return {
        employeeCode: session?.profile?.employee_code || '',
        role: session?.profile?.role || '',
        bodyRole: document.body.dataset.role || '',
        realtime: document.querySelector('[data-health="REALTIME"] em')?.textContent?.trim() || '',
        pickerReady: Boolean(document.querySelector('#skuSearch')),
        errors,
      };
    }, SESSION_KEY);

    if (liveState.employeeCode !== TEST_CODE || liveState.role !== 'PICKER' || liveState.bodyRole !== 'PICKER') {
      throw new Error(`Live session mismatch: ${JSON.stringify(liveState)}`);
    }
    if (!liveState.pickerReady || liveState.realtime !== 'TRỰC TUYẾN') {
      throw new Error(`Live picker/realtime bootstrap incomplete: ${JSON.stringify(liveState)}`);
    }
    if (liveState.errors.length) throw new Error(`Authenticated UI error: ${liveState.errors.join(' | ')}`);
    if (pageErrors.length) throw new Error(`Browser page error: ${pageErrors.join(' | ')}`);

    console.log('WEB_LOGIN_BROWSER_E2E=PASS role=PICKER realtime=ONLINE');
  } finally {
    if (browser) await browser.close().catch(() => {});
    await deleteTestUser(adminAuth).catch(() => {});
    await deleteApp(app).catch(() => {});
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
