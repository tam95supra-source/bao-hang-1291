'use strict';

const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { initializeApp, cert, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { chromium } = require('playwright-core');

const SITE = 'https://bao-hang-1291.web.app/';
const UID = '12910000-0000-4000-8000-00000000e2e1';
const CODE = 'e2eweb1291';
const EMAIL = CODE + '@bao-hang-1291.local';
const FULL_NAME = '__E2E_PICKER_1__';
const RECOVERY_EMAIL = 'tam95.supra@gmail.com';
const CHROME = String(process.env.CHROME_BIN || '');
const RUN_ID = String(process.env.GITHUB_RUN_ID || '');
const ATTEMPT = String(process.env.GITHUB_RUN_ATTEMPT || '');
const REQUEST_ID = `pwd-e2e-${RUN_ID}-${ATTEMPT}`;
const PENDING = 'ops/status/password-recovery-e2e-pending.json';
const CIPHER = 'ops/status/password-recovery-e2e-cipher.json';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const safe = (value) => String(value ?? '')
  .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
  .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, '[JWT_REDACTED]')
  .slice(0, 1200);

function git(args, options = {}) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: options.capture ? ['ignore','pipe','pipe'] : 'inherit' });
}

function commitPending(publicKey) {
  fs.mkdirSync('ops/status', { recursive: true });
  fs.writeFileSync(PENDING, JSON.stringify({
    status: 'WAITING_FOR_ENCRYPTED_CODE',
    request_id: REQUEST_ID,
    employee_code: CODE,
    recovery_email: RECOVERY_EMAIL,
    expected_subject: `[Báo hàng 1291] Mật khẩu tạm cho ${CODE}`,
    public_key_pem: publicKey,
    created_at: new Date().toISOString(),
  }, null, 2) + '\n');
  git(['config','user.name','github-actions[bot]']);
  git(['config','user.email','41898282+github-actions[bot]@users.noreply.github.com']);
  git(['add', PENDING]);
  git(['commit','-m',`test(auth): publish password E2E public key ${REQUEST_ID}`]);
  git(['pull','--rebase','origin','main']);
  git(['push','origin','HEAD:main']);
  console.log(`PASSWORD_RECOVERY_E2E_HANDSHAKE=WAITING request_id=${REQUEST_ID}`);
}

function readCipherFromOrigin() {
  try {
    git(['fetch','--quiet','origin','main']);
    const raw = git(['show',`origin/main:${CIPHER}`], { capture: true });
    const payload = JSON.parse(raw);
    if (String(payload.request_id || '') !== REQUEST_ID) return null;
    const ciphertext = String(payload.ciphertext_base64 || '');
    if (!/^[A-Za-z0-9+/=]+$/.test(ciphertext) || ciphertext.length < 100) return null;
    return ciphertext;
  } catch (_) {
    return null;
  }
}

async function waitCipher(timeoutMs = 360000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const cipher = readCipherFromOrigin();
    if (cipher) return cipher;
    await sleep(3000);
  }
  throw new Error('PASSWORD_RECOVERY_E2E_CIPHER_TIMEOUT');
}

async function waitGood(page, selector, timeout = 25000) {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    return Boolean(el && el.dataset.type === 'good' && el.textContent.trim());
  }, selector, { timeout });
}

async function main() {
  if (!CHROME || !RUN_ID || !ATTEMPT) throw new Error('PASSWORD_E2E_ENV_MISSING');
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (sa.project_id !== 'bao-hang-1291' || !sa.client_email || !sa.private_key) throw new Error('FIREBASE_SERVICE_ACCOUNT_SCOPE');

  const app = initializeApp({ credential: cert(sa) }, `pwd-e2e-${Date.now()}`);
  const auth = getAuth(app);
  const initialPassword = `Init!${crypto.randomBytes(18).toString('base64url')}Aa1`;
  const finalPassword = `Final!${crypto.randomBytes(18).toString('base64url')}Zz9`;
  let browser;

  try {
    try { await auth.deleteUser(UID); } catch (error) { if (error?.code !== 'auth/user-not-found') throw error; }
    await auth.createUser({ uid: UID, email: EMAIL, password: initialPassword, displayName: FULL_NAME, emailVerified: true, disabled: false });
    console.log('PASSWORD_RECOVERY_E2E_FIREBASE_FIXTURE=PASS');

    browser = await chromium.launch({ executablePath: CHROME, headless: true, timeout: 20000, args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'] });
    const page = await browser.newPage({ viewport: { width: 430, height: 880 } });
    page.setDefaultTimeout(20000);

    await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.locator('#employeeCode').fill(CODE);
    await page.locator('#forgotPassword').click();
    await page.locator('#accountModal').waitFor({ state: 'visible' });

    const preview = await page.locator('#accountModal').textContent();
    if (!preview.includes(CODE) || !preview.includes(FULL_NAME) || !preview.includes(RECOVERY_EMAIL)) {
      throw new Error('PASSWORD_RECOVERY_E2E_PREVIEW_MISMATCH');
    }
    console.log('PASSWORD_RECOVERY_E2E_PREVIEW=PASS employee=true name=true fixed_email=true');

    await page.locator('#confirmReset').click();
    await waitGood(page, '#resetMessage', 35000);
    const resetText = await page.locator('#resetMessage').textContent();
    if (!resetText.includes(RECOVERY_EMAIL) || !resetText.includes('4 số')) throw new Error('PASSWORD_RECOVERY_E2E_RESET_UI_MISMATCH');
    console.log('PASSWORD_RECOVERY_E2E_RESET_REQUEST=PASS mail_sent=true');

    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    commitPending(publicKey);
    const encrypted = await waitCipher();
    const code4 = crypto.privateDecrypt({
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    }, Buffer.from(encrypted, 'base64')).toString('utf8').trim();
    if (!/^\d{4}$/.test(code4)) throw new Error('PASSWORD_RECOVERY_E2E_DECRYPTED_CODE_INVALID');
    console.log('PASSWORD_RECOVERY_E2E_CODE_RECEIVED=PASS digits=4 plaintext_logged=false');

    await page.locator('#cancelReset').click();
    await page.locator('#accountModal').waitFor({ state: 'detached' });
    await page.locator('#employeeCode').fill(CODE);
    await page.locator('#password').fill(code4);
    await page.locator('#loginForm button').click();
    await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30000 });
    if (!(await page.locator('.topbar').textContent()).includes(FULL_NAME)) throw new Error('PASSWORD_RECOVERY_E2E_TEMP_LOGIN_PROFILE_MISMATCH');
    console.log('PASSWORD_RECOVERY_E2E_TEMP_4DIGIT_LOGIN=PASS');

    await page.locator('#changePassword').click();
    await page.locator('#ownNewPassword').fill(finalPassword);
    await page.locator('#ownConfirmPassword').fill(finalPassword);
    await page.locator('#confirmChangePassword').click();
    await waitGood(page, '#changePasswordMessage', 25000);
    console.log('PASSWORD_RECOVERY_E2E_SELF_CHANGE=PASS');

    await page.locator('#cancelChangePassword').click();
    await page.locator('#accountModal').waitFor({ state: 'detached' });
    await page.locator('#logout').click();
    await page.locator('#loginForm').waitFor({ state: 'visible' });
    await page.locator('#employeeCode').fill(CODE);
    await page.locator('#password').fill(finalPassword);
    await page.locator('#loginForm button').click();
    await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30000 });
    console.log('PASSWORD_RECOVERY_E2E_FINAL_PASSWORD_LOGIN=PASS');

    console.log('PASSWORD_RECOVERY_E2E=PASS preview=true email=true temp4=true self_change=true relogin=true');
  } finally {
    if (browser) await browser.close().catch(() => {});
    try { await auth.deleteUser(UID); } catch (error) { if (error?.code !== 'auth/user-not-found') console.error(`PASSWORD_E2E_FIREBASE_CLEANUP_WARN=${safe(error.message)}`); }
    await deleteApp(app).catch(() => {});
    console.log('PASSWORD_RECOVERY_E2E_FIREBASE_CLEANUP=PASS');
  }
}

main().catch((error) => {
  console.error(`PASSWORD_RECOVERY_E2E=FAIL ${safe(error?.message || error)}`);
  process.exitCode = 1;
});
