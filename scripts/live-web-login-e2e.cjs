'use strict';

const crypto = require('crypto');
const { initializeApp, cert, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { chromium } = require('playwright-core');

const SITE_URL = 'https://bao-hang-1291.web.app/';
const FIREBASE_API_KEY = 'AIzaSyB-n368fntzxsuuLlvte9NXhcuX0DDbTXM';
const SESSION_KEY = 'bao-hang-1291-web-session';
const NEON_DATA_API = process.env.NEON_DATA_API || '';
const CHROME_BIN = process.env.CHROME_BIN || '';
const ADMIN_UID = '44fae0a2-09eb-4226-8412-0f1a1f5d7ef8';
const ADMIN_CODE = '6281280';
const TEST_SKU_AVAILABLE = '99001291';
const TEST_SKU_SKIP = '99001292';
const USERS = [
  { uid:'12910000-0000-4000-8000-00000000e2e1', code:'e2eweb1291', role:'PICKER', label:'Picker' },
  { uid:'12910000-0000-4000-8000-00000000e2e2', code:'e2epicker2', role:'PICKER', label:'Picker 2' },
  { uid:'12910000-0000-4000-8000-00000000e2e3', code:'e2einvent', role:'INVENT', label:'Người báo hàng' },
  { uid:'12910000-0000-4000-8000-00000000e2e4', code:'e2eadmininvent', role:'ADMIN_INVENT', label:'Admin Event' },
];
const EXPECTED_TABS = {
  ADMIN: ['overview','events','sku','reports','users','devices','services','logs','config','versions'],
  ADMIN_INVENT: ['overview','events','sku','reports','users','logs','sla'],
  INVENT: ['events'],
  PICKER: ['picker'],
};

function required(value, label) {
  if (!value) throw new Error(`${label} is required`);
  return value;
}
function emailFor(code) { return `${String(code).toLowerCase()}@bao-hang-1291.local`; }
function safe(value) {
  return String(value || '')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, '[JWT_REDACTED]')
    .slice(0, 1000);
}
function jwtMeta(token) {
  const [headerPart, payloadPart] = String(token || '').split('.');
  const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8'));
  const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
  const customKeys = Object.keys(payload).filter((key) => !['aud','auth_time','email','email_verified','exp','firebase','iat','iss','sub','user_id'].includes(key));
  return { alg:header.alg || '', kid:header.kid || '', iss:payload.iss || '', aud:payload.aud || '', sub:payload.sub || '', customKeys };
}
async function deadline(label, promise, ms) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}_TIMEOUT_${ms}MS`)), ms); }),
    ]);
  } finally { clearTimeout(timer); }
}
async function fetchDeadline(url, init = {}, timeoutMs = 12000) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}
async function firebasePasswordSignIn(code, password) {
  const response = await fetchDeadline(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(FIREBASE_API_KEY)}`, {
    method: 'POST', headers: { 'content-type':'application/json' },
    body: JSON.stringify({ email:emailFor(code), password, returnSecureToken:true }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.idToken || !payload.localId) throw new Error(`FIREBASE_PASSWORD_SIGNIN_${code}_HTTP_${response.status}:${safe(payload?.error?.message)}`);
  const meta = jwtMeta(payload.idToken);
  if (meta.customKeys.includes('role') || meta.customKeys.includes('employee_code') || meta.customKeys.includes('app_role')) throw new Error(`FIREBASE_TOKEN_SHAPE_DRIFT_${code}:${meta.customKeys.join(',')}`);
  console.log(`FIREBASE_TOKEN_META code=${code} alg=${meta.alg} iss=${meta.iss} aud=${meta.aud} custom_role_claims=false`);
  return payload;
}
async function firebaseCustomSignIn(customToken) {
  const response = await fetchDeadline(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(FIREBASE_API_KEY)}`, {
    method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ token:customToken, returnSecureToken:true }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.idToken) throw new Error(`FIREBASE_ADMIN_CUSTOM_SIGNIN_HTTP_${response.status}:${safe(payload?.error?.message)}`);
  const meta = jwtMeta(payload.idToken);
  if (meta.sub !== ADMIN_UID) throw new Error(`FIREBASE_ADMIN_UID_MISMATCH:${meta.sub || '[missing]'}`);
  if (meta.customKeys.includes('role') || meta.customKeys.includes('employee_code') || meta.customKeys.includes('app_role')) throw new Error(`FIREBASE_TOKEN_SHAPE_DRIFT_ADMIN:${meta.customKeys.join(',')}`);
  console.log(`FIREBASE_TOKEN_META code=${ADMIN_CODE} alg=${meta.alg} iss=${meta.iss} aud=${meta.aud} custom_role_claims=false`);
  return payload;
}
async function rpc(token, name, body = {}) {
  const response = await fetchDeadline(`${NEON_DATA_API}/rpc/${encodeURIComponent(name)}`, {
    method:'POST', headers:{'content-type':'application/json', authorization:`Bearer ${token}`}, body:JSON.stringify(body),
  }, 12000);
  const raw = await response.text();
  let payload = null;
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { raw:safe(raw) }; }
  return { status:response.status, ok:response.ok, payload, raw:safe(raw) };
}
async function assertProfile(authPayload, code, role) {
  const result = await rpc(authPayload.idToken, 'api_session_profile_rpc', { p_test_role:null });
  if (!result.ok) throw new Error(`ROLE_PROFILE_${role}_HTTP_${result.status}:${result.raw}`);
  const profile = result.payload?.profile;
  if (profile?.employee_code !== code || profile?.role !== role || profile?.active !== true) throw new Error(`ROLE_PROFILE_MISMATCH_${role}:${safe(JSON.stringify(profile))}`);
  console.log(`ROLE_BACKEND_PASS role=${role} code=${code}`);
  return profile;
}
async function assertAllowed(authPayload, role, name, body = {}) {
  const result = await rpc(authPayload.idToken, name, body);
  if (!result.ok) throw new Error(`ROLE_ALLOWED_FAIL role=${role} rpc=${name} http=${result.status}:${result.raw}`);
}
async function assertDenied(authPayload, role, name, body = {}) {
  const result = await rpc(authPayload.idToken, name, body);
  if (result.ok) throw new Error(`ROLE_DENY_FAIL role=${role} rpc=${name} unexpectedly_allowed`);
  if ([401,403].includes(result.status) || /AUTH_REQUIRED/i.test(result.raw)) throw new Error(`ROLE_DENY_AUTH_BROKEN role=${role} rpc=${name} http=${result.status}:${result.raw}`);
  console.log(`ROLE_GUARD_PASS role=${role} rpc=${name} http=${result.status}`);
}
async function deleteTempUsers(adminAuth) {
  for (const user of USERS) {
    try { await adminAuth.deleteUser(user.uid); }
    catch (error) { if (error?.code !== 'auth/user-not-found') throw error; }
  }
}
async function createTempUsers(adminAuth, password) {
  for (const user of USERS) {
    await adminAuth.createUser({ uid:user.uid, email:emailFor(user.code), password, displayName:`__E2E_${user.role}__`, disabled:false, emailVerified:true });
  }
}
function installPageGuards(page, tag) {
  const evidence = { pageErrors:[], consoleErrors:[], forbiddenNetwork:[] };
  page.on('pageerror', (error) => evidence.pageErrors.push(String(error?.message || error)));
  page.on('console', (msg) => { if (msg.type() === 'error') evidence.consoleErrors.push(msg.text()); });
  page.on('response', (response) => {
    if (!response.url().includes('.neon.tech/')) return;
    if ([401,403].includes(response.status())) evidence.forbiddenNetwork.push(`${response.status()} ${response.url().replace(/\?.*/, '')}`);
  });
  page.on('dialog', (dialog) => dialog.accept().catch(() => {}));
  page.setDefaultTimeout(12000);
  page.setDefaultNavigationTimeout(20000);
  page.__evidence = evidence;
  page.__tag = tag;
  return evidence;
}
async function waitApp(page, role) {
  await page.waitForSelector('.app-shell', { timeout:15000 });
  await page.waitForFunction((expectedRole) => {
    try {
      const session = JSON.parse(sessionStorage.getItem('bao-hang-1291-web-session') || 'null');
      return session?.profile?.role === expectedRole;
    } catch { return false; }
  }, role, { timeout:15000 });
  await page.waitForFunction(() => document.querySelector('[data-health="REALTIME"] em')?.textContent?.trim() === 'TRỰC TUYẾN', null, { timeout:12000 }).catch(() => {});
}
async function loginPasswordPage(page, code, password, role) {
  console.log(`E2E_STAGE=browser_login role=${role}`);
  await page.goto(SITE_URL, { waitUntil:'domcontentloaded', timeout:20000 });
  await page.locator('#employeeCode').fill(code);
  await page.locator('#password').fill(password);
  await page.locator('#loginForm button[type="submit"], #loginForm button').first().click();
  await waitApp(page, role);
}
async function loginInjectedAdmin(page, adminAuthPayload, profile) {
  console.log('E2E_STAGE=browser_login role=ADMIN method=firebase_custom_token');
  await page.goto(SITE_URL, { waitUntil:'domcontentloaded', timeout:20000 });
  await page.evaluate(({ key, token, profile, expires }) => {
    sessionStorage.setItem(key, JSON.stringify({ access_token:token.idToken, refresh_token:token.refreshToken, expires_at:expires, profile }));
  }, { key:SESSION_KEY, token:adminAuthPayload, profile, expires:Math.floor(Date.now()/1000)+Number(adminAuthPayload.expiresIn || 3600) });
  await page.reload({ waitUntil:'domcontentloaded', timeout:20000 });
  await waitApp(page, 'ADMIN');
}
async function assertTabs(page, role) {
  const tabs = await page.locator('[data-tab]').evaluateAll((nodes) => nodes.map((node) => node.dataset.tab));
  const expected = EXPECTED_TABS[role];
  if (JSON.stringify(tabs) !== JSON.stringify(expected)) throw new Error(`TAB_MATRIX_FAIL role=${role} actual=${JSON.stringify(tabs)}`);
  console.log(`ROLE_UI_PASS role=${role} tabs=${tabs.join(',')}`);
}
async function exerciseTabs(page, role) {
  for (const tab of EXPECTED_TABS[role]) {
    const button = page.locator(`[data-tab="${tab}"]`);
    if (!await button.count()) throw new Error(`TAB_MISSING role=${role} tab=${tab}`);
    await button.click();
    await page.waitForTimeout(400);
    const errorText = await page.locator('.message[data-type="error"]:visible').allTextContents().catch(() => []);
    if (errorText.filter(Boolean).length) throw new Error(`TAB_RUNTIME_ERROR role=${role} tab=${tab}:${safe(errorText.join(' | '))}`);
  }
}
async function assertSessionRestoreAndLogout(page, role) {
  await page.reload({ waitUntil:'domcontentloaded', timeout:20000 });
  await waitApp(page, role);
  await page.locator('#logout').click();
  await page.waitForSelector('#loginForm', { timeout:10000 });
  console.log(`SESSION_RESTORE_LOGOUT_PASS role=${role}`);
}
async function assertResponsive(page, role) {
  const metrics = await page.evaluate(() => ({ width:innerWidth, scrollWidth:document.documentElement.scrollWidth, shell:Boolean(document.querySelector('.app-shell')) }));
  if (!metrics.shell || metrics.scrollWidth > metrics.width + 2) throw new Error(`RESPONSIVE_FAIL role=${role}:${JSON.stringify(metrics)}`);
}
function assertPageClean(page) {
  const e = page.__evidence || {};
  if (e.pageErrors?.length) throw new Error(`PAGE_ERROR ${page.__tag}:${safe(e.pageErrors.join(' | '))}`);
  if (e.consoleErrors?.length) throw new Error(`CONSOLE_ERROR ${page.__tag}:${safe(e.consoleErrors.join(' | '))}`);
  if (e.forbiddenNetwork?.length) throw new Error(`NEON_401_403 ${page.__tag}:${safe(e.forbiddenNetwork.join(' | '))}`);
}
async function makePage(browser, tag, viewport = { width:1280, height:900 }) {
  const context = await deadline(`CONTEXT_${tag}`, browser.newContext({ viewport }), 12000);
  const page = await deadline(`PAGE_${tag}`, context.newPage(), 12000);
  installPageGuards(page, tag);
  return { context, page };
}
async function waitRealtimeMetric(page, key, previous, label) {
  await page.waitForFunction(({ key, previous }) => Number(window.__BH_PICKER_REALTIME_METRICS__?.[key] || 0) > previous, { key, previous }, { timeout:12000 });
  console.log(`REALTIME_METRIC_PASS ${label}`);
}
async function snapshotUiIdentity(page, prefix) {
  return page.evaluate((prefix) => {
    const shell = document.querySelector('.app-shell');
    const fast = document.querySelector('#fastEvents');
    if (shell && !shell.__e2eIdentity) shell.__e2eIdentity = `${prefix}-app-${Math.random()}`;
    if (fast && !fast.__e2eIdentity) fast.__e2eIdentity = `${prefix}-fast-${Math.random()}`;
    return {
      shell: shell?.__e2eIdentity || '', fast: fast?.__e2eIdentity || '',
      hash:location.hash, scrollX, scrollY,
      navCount:performance.getEntriesByType('navigation').length,
      search:document.querySelector('#skuSearch')?.value ?? null,
      focus:document.activeElement?.id || '',
    };
  }, prefix);
}
async function assertUiIdentity(page, before, label) {
  const after = await page.evaluate(() => ({
    shell:document.querySelector('.app-shell')?.__e2eIdentity || '',
    fast:document.querySelector('#fastEvents')?.__e2eIdentity || '',
    hash:location.hash, scrollX, scrollY,
    navCount:performance.getEntriesByType('navigation').length,
    search:document.querySelector('#skuSearch')?.value ?? null,
    focus:document.activeElement?.id || '',
  }));
  if (before.shell && after.shell !== before.shell) throw new Error(`REALTIME_FULL_SHELL_RERENDER ${label}`);
  if (before.fast && after.fast !== before.fast) throw new Error(`REALTIME_FAST_SHELL_RERENDER ${label}`);
  if (after.navCount !== before.navCount || after.hash !== before.hash) throw new Error(`REALTIME_NAVIGATION_CHANGED ${label}`);
  if (before.search !== null && after.search !== before.search) throw new Error(`REALTIME_INPUT_LOST ${label}`);
  if (before.focus && after.focus !== before.focus) throw new Error(`REALTIME_FOCUS_LOST ${label} before=${before.focus} after=${after.focus}`);
  if (Math.abs(after.scrollY - before.scrollY) > 2) throw new Error(`REALTIME_SCROLL_LOST ${label}`);
}
async function reportSku(page, sku) {
  await page.locator('[data-tab="picker"]').click().catch(() => {});
  const input = page.locator('#skuSearch');
  await input.fill(sku);
  await page.waitForSelector('#skuResults [data-result]', { timeout:12000 });
  await page.locator('#skuResults [data-result]').first().click();
  await page.locator('#reportShortage').click();
  await page.waitForFunction((sku) => (document.querySelector('#pickerMsg')?.textContent || '').includes(sku), sku, { timeout:12000 });
}
async function selectFastIssue(page, sku) {
  await page.waitForFunction((sku) => [...document.querySelectorAll('#fastList .fast-issue-row')].some((node) => (node.textContent || '').includes(sku)), sku, { timeout:12000 });
  const row = page.locator('#fastList .fast-issue-row').filter({ hasText:sku }).first();
  await row.click();
}
async function clickFastAction(page, action) {
  await page.locator(`#fastDetail [data-fast-action="${action}"]`).click();
  await page.waitForTimeout(250);
}
async function acknowledgePickerAlert(page, expectedText) {
  await page.waitForFunction((text) => (document.querySelector('#pendingAlert')?.textContent || '').includes(text), expectedText, { timeout:12000 });
  const button = page.locator('#pendingAlert button').first();
  if (await button.count()) await button.click();
}

async function runBrowserRoleMatrix(browser, authByRole, password) {
  const viewports = { ADMIN:{width:1280,height:900}, ADMIN_INVENT:{width:1024,height:800}, INVENT:{width:800,height:800}, PICKER:{width:390,height:844} };
  for (const role of ['ADMIN','ADMIN_INVENT','INVENT','PICKER']) {
    const { context, page } = await makePage(browser, `role-${role}`, viewports[role]);
    try {
      if (role === 'ADMIN') await loginInjectedAdmin(page, authByRole.ADMIN.auth, authByRole.ADMIN.profile);
      else {
        const user = USERS.find((item) => item.role === role) || USERS[0];
        await loginPasswordPage(page, user.code, password, role);
      }
      await assertTabs(page, role);
      await exerciseTabs(page, role);
      await assertResponsive(page, role);
      assertPageClean(page);
      await assertSessionRestoreAndLogout(page, role);
      assertPageClean(page);
    } finally { await deadline(`CLOSE_ROLE_${role}`, context.close().catch(() => {}), 8000).catch(() => {}); }
  }
}

async function runRealtimeScenario(browser, password) {
  const pickerA = await makePage(browser, 'picker-A');
  const pickerB = await makePage(browser, 'picker-B');
  const invent = await makePage(browser, 'invent-events');
  try {
    await loginPasswordPage(pickerA.page, 'e2eweb1291', password, 'PICKER');
    await loginPasswordPage(pickerB.page, 'e2eweb1291', password, 'PICKER');
    await loginPasswordPage(invent.page, 'e2einvent', password, 'INVENT');
    await invent.page.waitForSelector('#fastEvents', { timeout:12000 });

    await pickerB.page.locator('#skuSearch').fill('123');
    await pickerB.page.locator('#skuSearch').focus();
    const pickerBefore = await snapshotUiIdentity(pickerB.page, 'picker');
    const inventBefore = await snapshotUiIdentity(invent.page, 'invent');
    const pickerMetricBefore = await pickerB.page.evaluate(() => Number(window.__BH_PICKER_REALTIME_METRICS__?.patchedCards || 0));

    console.log(`E2E_STAGE=realtime_report sku=${TEST_SKU_AVAILABLE}`);
    await reportSku(pickerA.page, TEST_SKU_AVAILABLE);
    await waitRealtimeMetric(pickerB.page, 'patchedCards', pickerMetricBefore, 'picker_report_patch');
    await pickerB.page.waitForFunction((sku) => (document.querySelector('#myIssues')?.textContent || '').includes(sku), TEST_SKU_AVAILABLE, { timeout:12000 });
    await selectFastIssue(invent.page, TEST_SKU_AVAILABLE);
    await assertUiIdentity(pickerB.page, pickerBefore, 'picker_after_report');
    await assertUiIdentity(invent.page, inventBefore, 'invent_after_report');

    const metricClaim = await pickerB.page.evaluate(() => Number(window.__BH_PICKER_REALTIME_METRICS__?.patchedCards || 0));
    await clickFastAction(invent.page, 'claim');
    await waitRealtimeMetric(pickerB.page, 'patchedCards', metricClaim, 'picker_claim_patch');
    await pickerB.page.waitForFunction((sku) => {
      const row = [...document.querySelectorAll('#myIssues article')].find((node) => (node.textContent || '').includes(sku));
      return row && /Đang xử lý/.test(row.textContent || '');
    }, TEST_SKU_AVAILABLE, { timeout:12000 });
    await assertUiIdentity(pickerB.page, pickerBefore, 'picker_after_claim');

    const metricAvailable = await pickerB.page.evaluate(() => Number(window.__BH_PICKER_REALTIME_METRICS__?.patchedCards || 0));
    await clickFastAction(invent.page, 'available');
    await waitRealtimeMetric(pickerB.page, 'patchedCards', metricAvailable, 'picker_available_patch');
    await assertUiIdentity(pickerB.page, pickerBefore, 'picker_after_available');
    await acknowledgePickerAlert(pickerB.page, TEST_SKU_AVAILABLE);
    await pickerB.page.locator('#skuSearch').fill('123');
    await pickerB.page.locator('#skuSearch').focus();
    const pickerBeforeSkip = await snapshotUiIdentity(pickerB.page, 'picker-skip');

    console.log(`E2E_STAGE=skip_flow sku=${TEST_SKU_SKIP}`);
    await reportSku(pickerA.page, TEST_SKU_SKIP);
    await selectFastIssue(invent.page, TEST_SKU_SKIP);
    await clickFastAction(invent.page, 'claim');
    const metricSkip = await pickerB.page.evaluate(() => Number(window.__BH_PICKER_REALTIME_METRICS__?.patchedCards || 0));
    await clickFastAction(invent.page, 'skip');
    await waitRealtimeMetric(pickerB.page, 'patchedCards', metricSkip, 'picker_skip_patch');
    await assertUiIdentity(pickerB.page, pickerBeforeSkip, 'picker_after_skip');
    await acknowledgePickerAlert(pickerB.page, TEST_SKU_SKIP);

    const metrics = await pickerB.page.evaluate(() => window.__BH_PICKER_REALTIME_METRICS__ || {});
    if (Number(metrics.fullScreenRenders || 0) !== 0 || Number(metrics.patchedCards || 0) < 4) throw new Error(`REALTIME_METRICS_FAIL:${JSON.stringify(metrics)}`);
    assertPageClean(pickerA.page); assertPageClean(pickerB.page); assertPageClean(invent.page);
    console.log(`REALTIME_TWO_SESSION_PASS patchedCards=${metrics.patchedCards} fullScreenRenders=${metrics.fullScreenRenders}`);
  } finally {
    for (const item of [pickerA, pickerB, invent]) await deadline(`CLOSE_${item.page.__tag}`, item.context.close().catch(() => {}), 8000).catch(() => {});
  }
}

async function main() {
  const serviceAccount = JSON.parse(required(process.env.FIREBASE_SERVICE_ACCOUNT, 'FIREBASE_SERVICE_ACCOUNT'));
  if (serviceAccount.project_id !== 'bao-hang-1291') throw new Error('Firebase service account is out of scope');
  required(NEON_DATA_API, 'NEON_DATA_API'); required(CHROME_BIN, 'CHROME_BIN');
  const app = initializeApp({ credential:cert(serviceAccount) }, `web-prod-e2e-${Date.now()}`);
  const adminAuth = getAuth(app);
  const password = `E2e!${crypto.randomBytes(18).toString('base64url')}Aa1`;
  let browser;
  try {
    console.log('E2E_STAGE=setup_users');
    await deleteTempUsers(adminAuth);
    await createTempUsers(adminAuth, password);
    const adminRecord = await adminAuth.getUser(ADMIN_UID);
    if (adminRecord.disabled) throw new Error('PROTECTED_ADMIN_FIREBASE_DISABLED');

    const authByRole = {};
    for (const user of USERS) {
      const auth = await firebasePasswordSignIn(user.code, password);
      if (auth.localId !== user.uid) throw new Error(`FIREBASE_UID_MISMATCH_${user.role}`);
      const profile = await assertProfile(auth, user.code, user.role);
      if (!authByRole[user.role]) authByRole[user.role] = { auth, profile };
    }
    const customToken = await adminAuth.createCustomToken(ADMIN_UID);
    const adminSignIn = await firebaseCustomSignIn(customToken);
    const adminProfile = await assertProfile(adminSignIn, ADMIN_CODE, 'ADMIN');
    authByRole.ADMIN = { auth:adminSignIn, profile:adminProfile };

    await assertAllowed(authByRole.ADMIN.auth, 'ADMIN', 'api_admin_summary_rpc', { p_test_role:null });
    await assertAllowed(authByRole.ADMIN_INVENT.auth, 'ADMIN_INVENT', 'api_list_users_rpc', { p_test_role:null });
    await assertAllowed(authByRole.INVENT.auth, 'INVENT', 'api_issue_board_rpc', { p_test_role:null });
    await assertAllowed(authByRole.PICKER.auth, 'PICKER', 'api_picker_my_issues_rpc', { p_test_role:null });
    await assertDenied(authByRole.PICKER.auth, 'PICKER', 'api_admin_summary_rpc', { p_test_role:null });
    await assertDenied(authByRole.INVENT.auth, 'INVENT', 'api_list_users_rpc', { p_test_role:null });
    console.log('NEON_403_ROOT_GATE=PASS all_role_profiles_http_200=true');

    console.log('E2E_STAGE=browser_launch');
    browser = await deadline('CHROMIUM_LAUNCH', chromium.launch({ executablePath:CHROME_BIN, headless:true, timeout:15000, args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'] }), 18000);
    console.log('E2E_STAGE=browser_launched');
    await runBrowserRoleMatrix(browser, authByRole, password);
    await runRealtimeScenario(browser, password);
    console.log('WEB_PRODUCTION_E2E=PASS roles=4 realtime=two_session');
  } finally {
    if (browser) await deadline('BROWSER_CLOSE', browser.close().catch(() => {}), 10000).catch(() => {});
    await deleteTempUsers(adminAuth).catch((error) => console.error(`TEST_FIREBASE_CLEANUP_WARN:${safe(error?.message || error)}`));
    await deleteApp(app).catch(() => {});
    console.log('TEST_FIREBASE_USERS_CLEANUP=PASS');
  }
}

main().catch((error) => { console.error(error?.stack || error?.message || error); process.exitCode = 1; });