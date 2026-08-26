'use strict';

const crypto = require('crypto');
const { initializeApp, cert, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { chromium } = require('playwright-core');

const SITE = 'https://bao-hang-1291.web.app/';
const APIKEY = 'AIzaSyB-n368fntzxsuuLlvte9NXhcuX0DDbTXM';
const NEON = process.env.NEON_DATA_API || '';
const CHROME = process.env.CHROME_BIN || '';
const RUN_MARKER = `e2e-two-session-${process.env.GITHUB_RUN_ID || 'local'}-${crypto.randomUUID()}`;
const SKU_AVAILABLE = '99001291';
const SKU_SKIP = '99001292';
const USERS = [
  { uid: '12910000-0000-4000-8000-00000000e2e1', code: 'e2eweb1291', role: 'PICKER', label: 'PICKER_1' },
  { uid: '12910000-0000-4000-8000-00000000e2e2', code: 'e2epicker2', role: 'PICKER', label: 'PICKER_2' },
  { uid: '12910000-0000-4000-8000-00000000e2e3', code: 'e2einvent', role: 'INVENT', label: 'INVENT' },
  { uid: '12910000-0000-4000-8000-00000000e2e4', code: 'e2eadmininvent', role: 'ADMIN_INVENT', label: 'ADMIN_INVENT' },
];
const email = (code) => `${code.toLowerCase()}@bao-hang-1291.local`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const safe = (value) => String(value || '')
  .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
  .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, '[JWT_REDACTED]')
  .replace(/refresh_token=[^&\s]+/gi, 'refresh_token=[REDACTED]')
  .slice(0, 1200);

async function stage(name, timeoutMs, fn) {
  console.log(`TS_STAGE=${name}:BEGIN timeout_ms=${timeoutMs}`);
  let timer;
  try {
    const result = await Promise.race([
      fn(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`TIMEOUT_${name}`)), timeoutMs); }),
    ]);
    console.log(`TS_STAGE=${name}:PASS`);
    return result;
  } catch (error) {
    console.error(`TS_STAGE=${name}:FAIL ${safe(error?.message || error)}`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTimed(url, init = {}, timeoutMs = 15000) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

async function passwordToken(code, password) {
  const response = await fetchTimed(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${APIKEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: email(code), password, returnSecureToken: true }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.idToken || !payload.localId) throw new Error(`PASSWORD_LOGIN_${code}_HTTP_${response.status}:${safe(payload?.error?.message)}`);
  return payload;
}

async function neonRpc(token, name, body = {}) {
  const response = await fetchTimed(`${NEON}/rpc/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: safe(text) }; }
  if (!response.ok) throw new Error(`NEON_${name}_HTTP_${response.status}:${safe(text)}`);
  return payload;
}

async function deleteExactFirebaseUsers(auth) {
  for (const user of USERS) {
    try {
      const existing = await auth.getUser(user.uid);
      const expectedEmail = email(user.code);
      const markerOk = existing.email === expectedEmail && String(existing.displayName || '').startsWith('__E2E_');
      if (!markerOk) throw new Error(`FIREBASE_DELETE_MARKER_MISMATCH uid=${user.uid} email=${safe(existing.email)} display=${safe(existing.displayName)}`);
      await auth.deleteUser(user.uid);
    } catch (error) {
      if (error?.code !== 'auth/user-not-found') throw error;
    }
  }
}

async function createExactFirebaseUsers(auth, password) {
  for (const user of USERS) {
    await auth.createUser({
      uid: user.uid,
      email: email(user.code),
      password,
      emailVerified: true,
      disabled: false,
      displayName: `__E2E_TWO_SESSION_${user.label}__`,
    });
  }
}

async function assertFirebaseUsersGone(auth) {
  let remaining = 0;
  for (const user of USERS) {
    try {
      const existing = await auth.getUser(user.uid);
      if (existing) remaining += 1;
    } catch (error) {
      if (error?.code !== 'auth/user-not-found') throw error;
    }
  }
  if (remaining !== 0) throw new Error(`TEST_FIREBASE_USERS_REMAINING=${remaining}`);
  console.log('TEST_FIREBASE_USERS_REMAINING=0');
}

function attachGuards(page, tag) {
  const state = { forbidden: [], fatal: [], dialogs: [] };
  page.on('pageerror', (error) => state.fatal.push(`pageerror:${safe(error?.message || error)}`));
  page.on('response', (response) => {
    if (response.url().includes('.neon.tech/') && [401, 403].includes(response.status())) {
      state.forbidden.push(`${response.status()} ${response.url().replace(/\?.*/, '')}`);
    }
  });
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/AUTH_REQUIRED|not owner|not_owner/i.test(text)) state.fatal.push(`console:${safe(text)}`);
  });
  page.on('dialog', async (dialog) => {
    const message = dialog.message();
    state.dialogs.push(message);
    if (/AUTH_REQUIRED|not owner|not_owner|không có quyền|forbidden/i.test(message)) state.fatal.push(`dialog:${safe(message)}`);
    await dialog.accept().catch(() => {});
  });
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(20000);
  page.__ts = { tag, state };
}

function assertPageClean(page) {
  const { tag, state } = page.__ts;
  if (state.forbidden.length) throw new Error(`FORBIDDEN_${tag}:${safe(state.forbidden.join('|'))}`);
  if (state.fatal.length) throw new Error(`PAGE_FATAL_${tag}:${safe(state.fatal.join('|'))}`);
}

async function makeContext(browser, tag, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  attachGuards(page, tag);
  return { context, page };
}

async function waitApp(page, role) {
  await page.waitForFunction((expectedRole) => {
    const shell = document.querySelector('.app-shell');
    if (!shell) return false;
    try {
      return JSON.parse(sessionStorage.getItem('bao-hang-1291-web-session') || 'null')?.profile?.role === expectedRole;
    } catch { return false; }
  }, role, { timeout: 20000 });
}

async function loginBrowser(page, user, password, markerName) {
  await page.goto(SITE, { waitUntil: 'domcontentloaded' });
  await page.locator('#employeeCode').fill(user.code);
  await page.locator('#password').fill(password);
  await page.locator('#loginForm button').first().click();
  await waitApp(page, user.role);
  const uid = await page.evaluate(() => {
    try { return JSON.parse(sessionStorage.getItem('bao-hang-1291-web-session') || 'null')?.profile?.id || ''; } catch { return ''; }
  });
  if (uid !== user.uid) throw new Error(`${markerName}_UID_MISMATCH got=${safe(uid)}`);
  assertPageClean(page);
  console.log(`${markerName}=PASS uid=${uid} role=${user.role}`);
}

async function reportSku(page, sku) {
  await page.locator('[data-tab="picker"]').click().catch(() => {});
  const search = page.locator('#skuSearch');
  await search.fill(sku);
  await page.waitForFunction((value) => [...document.querySelectorAll('#skuResults [data-result]')].some((n) => (n.textContent || '').includes(value)), sku, { timeout: 15000 });
  await page.locator('#skuResults [data-result]').filter({ hasText: sku }).first().click();
  await page.locator('#reportShortage').click();
  await page.waitForFunction((value) => (document.querySelector('#pickerMsg')?.textContent || '').includes(value), sku, { timeout: 15000 });
  await page.waitForFunction((value) => [...document.querySelectorAll('#myIssues [data-picker-issue]')].some((n) => (n.textContent || '').includes(value)), sku, { timeout: 15000 });
}

async function refreshInvent(page) {
  await page.locator('[data-tab="events"]').click().catch(() => {});
  await page.waitForSelector('#fastEvents');
  const refresh = page.locator('#fastRefresh');
  if (await refresh.count()) await refresh.click();
}

async function selectInventIssue(page, sku) {
  await refreshInvent(page);
  await page.waitForFunction((value) => [...document.querySelectorAll('#fastList [data-fast-select]')].some((n) => (n.textContent || '').includes(value)), sku, { timeout: 15000 });
  const row = page.locator('#fastList [data-fast-select]').filter({ hasText: sku }).first();
  await row.click();
  return row.getAttribute('data-fast-select');
}

async function pickerIssue(page, sku) {
  return page.evaluate((value) => {
    const node = [...document.querySelectorAll('#myIssues [data-picker-issue]')].find((n) => (n.textContent || '').includes(value));
    return node ? { id: node.dataset.pickerIssue || '', version: Number(node.dataset.pickerVersion || 0) } : null;
  }, sku);
}

async function metrics(page) {
  return page.evaluate(() => ({ ...(window.__BH_PICKER_REALTIME_METRICS__ || {}) }));
}

async function waitMetric(page, key, previous) {
  await page.waitForFunction(({ key, previous }) => Number(window.__BH_PICKER_REALTIME_METRICS__?.[key] || 0) > previous, { key, previous }, { timeout: 15000 });
}

async function clickInventAction(page, action) {
  const button = page.locator(`#fastDetail [data-fast-action="${action}"]`);
  await button.waitFor({ state: 'visible', timeout: 12000 });
  await button.click();
  await sleep(300);
  assertPageClean(page);
}

async function waitAlert(page, sku) {
  await page.waitForFunction((value) => (document.querySelector('#pendingAlert')?.textContent || '').includes(value), sku, { timeout: 15000 });
  const count = await page.locator('#pendingAlert').count();
  if (count !== 1) throw new Error(`ALERT_CONTAINER_COUNT_${sku}_${count}`);
}

async function dismissAlert(page) {
  const button = page.locator('#pendingAlert button').first();
  if (await button.count()) await button.click();
}

async function prepareUiPreservation(page) {
  await page.locator('#skuSearch').fill('123');
  await page.locator('#skuSearch').focus();
  return page.evaluate(() => {
    const shell = document.querySelector('.app-shell');
    if (shell && !shell.__twoSessionIdentity) shell.__twoSessionIdentity = `shell-${Math.random()}`;
    const cards = [...document.querySelectorAll('#myIssues [data-picker-issue]')];
    for (const card of cards) if (!card.__twoSessionIdentity) card.__twoSessionIdentity = `card-${Math.random()}`;
    return {
      shell: shell?.__twoSessionIdentity || '',
      hash: location.hash,
      scrollY: window.scrollY,
      navCount: performance.getEntriesByType('navigation').length,
      input: document.querySelector('#skuSearch')?.value || '',
      focus: document.activeElement?.id || '',
      cards: cards.map((n) => ({ id: n.dataset.pickerIssue || '', dom: n.__twoSessionIdentity || '' })),
    };
  });
}

async function assertUiPreserved(page, before, unrelatedIssueId) {
  const after = await page.evaluate(() => ({
    shell: document.querySelector('.app-shell')?.__twoSessionIdentity || '',
    hash: location.hash,
    scrollY: window.scrollY,
    navCount: performance.getEntriesByType('navigation').length,
    input: document.querySelector('#skuSearch')?.value || '',
    focus: document.activeElement?.id || '',
    cards: [...document.querySelectorAll('#myIssues [data-picker-issue]')].map((n) => ({ id: n.dataset.pickerIssue || '', dom: n.__twoSessionIdentity || '' })),
  }));
  if (after.shell !== before.shell) throw new Error('FULL_SHELL_RERENDERED');
  if (after.hash !== before.hash || after.navCount !== before.navCount) throw new Error('HASH_OR_NAV_CHANGED');
  if (Math.abs(after.scrollY - before.scrollY) > 2) throw new Error('SCROLL_CHANGED');
  if (after.input !== before.input || after.focus !== before.focus) throw new Error('INPUT_OR_FOCUS_CHANGED');
  const beforeOther = before.cards.find((x) => x.id === unrelatedIssueId)?.dom;
  const afterOther = after.cards.find((x) => x.id === unrelatedIssueId)?.dom;
  if (beforeOther && beforeOther !== afterOther) throw new Error('UNRELATED_CARD_RERENDERED');
}

async function assertPickerIsolation(token, forbiddenIssueIds) {
  const payload = await neonRpc(token, 'api_picker_my_issues_rpc', { p_test_role: null });
  const text = JSON.stringify(payload);
  for (const id of forbiddenIssueIds) if (id && text.includes(id)) throw new Error(`PICKER_SCOPE_LEAK issue=${id}`);
  console.log('PICKER_SCOPE_ISOLATION=PASS');
}

async function main() {
  if (!NEON || !CHROME) throw new Error('TARGET_ENV_MISSING');
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (serviceAccount.project_id !== 'bao-hang-1291') throw new Error('FIREBASE_PROJECT_SCOPE_MISMATCH');

  const app = initializeApp({ credential: cert(serviceAccount) }, `two-session-${Date.now()}`);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const signalRef = db.doc('realtime/issues');
  const signalBefore = await signalRef.get();
  const signalSnapshot = { exists: signalBefore.exists, data: signalBefore.exists ? signalBefore.data() : null };
  const password = `Ts!${crypto.randomBytes(18).toString('base64url')}Aa1`;
  let browser;
  let A;
  let B;
  let firebaseCleanupOk = false;
  let signalRestoreOk = false;

  try {
    await stage('FIREBASE_FIXTURE_RESET', 20000, async () => {
      await deleteExactFirebaseUsers(auth);
      await createExactFirebaseUsers(auth, password);
    });

    const tokenPicker2 = await stage('PICKER2_TOKEN', 15000, async () => {
      const result = await passwordToken('e2epicker2', password);
      if (result.localId !== USERS[1].uid) throw new Error('PICKER2_UID_MISMATCH');
      return result.idToken;
    });

    browser = await stage('BROWSER_LAUNCH', 22000, () => chromium.launch({
      executablePath: CHROME,
      headless: true,
      timeout: 20000,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    }));
    A = await stage('SESSION_A_CONTEXT', 10000, () => makeContext(browser, 'session-A-invent', { width: 1024, height: 800 }));
    B = await stage('SESSION_B_CONTEXT', 10000, () => makeContext(browser, 'session-B-picker', { width: 420, height: 860 }));

    await stage('LOGIN_A', 25000, () => loginBrowser(A.page, USERS[2], password, 'TWO_SESSION_LOGIN_A'));
    await stage('LOGIN_B', 25000, () => loginBrowser(B.page, USERS[0], password, 'TWO_SESSION_LOGIN_B'));

    await stage('REPORT_FIXTURES', 30000, async () => {
      await reportSku(B.page, SKU_AVAILABLE);
      await reportSku(B.page, SKU_SKIP);
    });

    const availablePicker = await pickerIssue(B.page, SKU_AVAILABLE);
    const skipPicker = await pickerIssue(B.page, SKU_SKIP);
    if (!availablePicker?.id || !skipPicker?.id || availablePicker.id === skipPicker.id) throw new Error('PICKER_FIXTURE_ENTITY_MISSING');

    const availableInventId = await stage('ENTITY_BIND', 20000, () => selectInventIssue(A.page, SKU_AVAILABLE));
    if (availableInventId !== availablePicker.id) throw new Error(`ENTITY_MISMATCH picker=${availablePicker.id} invent=${availableInventId}`);
    console.log(`REALTIME_ENTITY_MATCH=PASS entity_id=${availablePicker.id}`);

    const uiBefore = await prepareUiPreservation(B.page);
    const metricsBeforeClaim = await metrics(B.page);
    await stage('AVAILABLE_CLAIM', 20000, async () => {
      await clickInventAction(A.page, 'claim');
      await waitMetric(B.page, 'patchedCards', Number(metricsBeforeClaim.patchedCards || 0));
    });
    await assertUiPreserved(B.page, uiBefore, skipPicker.id);

    const metricsBeforeAvailable = await metrics(B.page);
    await stage('AVAILABLE_ACTION', 20000, async () => {
      await clickInventAction(A.page, 'available');
      await waitMetric(B.page, 'patchedCards', Number(metricsBeforeAvailable.patchedCards || 0));
      await waitAlert(B.page, SKU_AVAILABLE);
    });
    await assertUiPreserved(B.page, uiBefore, skipPicker.id);
    console.log('REALTIME_WITHOUT_FULL_RELOAD=PASS');
    console.log('CARD_ONLY_PATCH=PASS');
    console.log('INPUT_FOCUS_SCROLL_HASH_PRESERVED=PASS');
    await dismissAlert(B.page);

    const currentAvailable = await pickerIssue(B.page, SKU_AVAILABLE);
    if (!currentAvailable?.id) throw new Error('AVAILABLE_ENTITY_DISAPPEARED');
    const acceptedVersion = 1000000 + Math.max(1, currentAvailable.version || 1);
    const eventId = `${RUN_MARKER}-duplicate`;
    const beforeSynthetic = await metrics(B.page);
    await stage('SYNTHETIC_ACCEPT', 18000, async () => {
      await signalRef.set({ event_id: eventId, event_type: 'issue_changed', topic: 'issues', entity_id: currentAvailable.id, entity_version: acceptedVersion, source: RUN_MARKER, client_at: new Date() });
      await waitMetric(B.page, 'events', Number(beforeSynthetic.events || 0));
    });
    const afterAccept = await metrics(B.page);
    await stage('DUPLICATE_EVENT', 18000, async () => {
      await signalRef.set({ event_id: eventId, event_type: 'issue_changed', topic: 'issues', entity_id: currentAvailable.id, entity_version: acceptedVersion, source: RUN_MARKER, client_at: new Date() });
      await waitMetric(B.page, 'duplicateIgnored', Number(beforeSynthetic.duplicateIgnored || 0));
    });
    const availableCount = await B.page.locator('#myIssues [data-picker-issue]').filter({ hasText: SKU_AVAILABLE }).count();
    if (availableCount !== 1) throw new Error(`DUPLICATE_CARD_COUNT=${availableCount}`);
    const afterDuplicate = await metrics(B.page);
    if (Number(afterDuplicate.alerts || 0) - Number(afterAccept.alerts || 0) > 0) throw new Error('DUPLICATE_NOTIFICATION_CREATED');
    console.log('DUPLICATE_EVENT_IGNORED=PASS duplicate_card=1 duplicate_notification=0');

    const versionBeforeStale = Number((await pickerIssue(B.page, SKU_AVAILABLE))?.version || 0);
    await stage('STALE_EVENT', 18000, async () => {
      await signalRef.set({ event_id: `${RUN_MARKER}-stale`, event_type: 'issue_changed', topic: 'issues', entity_id: currentAvailable.id, entity_version: acceptedVersion - 1, source: RUN_MARKER, client_at: new Date() });
      await waitMetric(B.page, 'staleIgnored', Number(beforeSynthetic.staleIgnored || 0));
    });
    const versionAfterStale = Number((await pickerIssue(B.page, SKU_AVAILABLE))?.version || 0);
    if (versionAfterStale !== versionBeforeStale) throw new Error(`STALE_OVERWROTE_VERSION before=${versionBeforeStale} after=${versionAfterStale}`);
    console.log('STALE_EVENT_IGNORED=PASS');

    const skipInventId = await stage('SKIP_ENTITY_SELECT', 20000, () => selectInventIssue(A.page, SKU_SKIP));
    if (skipInventId !== skipPicker.id) throw new Error(`SKIP_ENTITY_MISMATCH picker=${skipPicker.id} invent=${skipInventId}`);
    const metricsBeforeSkipClaim = await metrics(B.page);
    await stage('SKIP_CLAIM', 20000, async () => {
      await clickInventAction(A.page, 'claim');
      await waitMetric(B.page, 'patchedCards', Number(metricsBeforeSkipClaim.patchedCards || 0));
    });
    const metricsBeforeSkip = await metrics(B.page);
    await stage('SKIP_ACTION', 20000, async () => {
      await clickInventAction(A.page, 'skip');
      await waitMetric(B.page, 'patchedCards', Number(metricsBeforeSkip.patchedCards || 0));
      await waitAlert(B.page, SKU_SKIP);
    });
    await assertUiPreserved(B.page, uiBefore, '');
    await dismissAlert(B.page);
    assertPageClean(A.page);
    assertPageClean(B.page);
    console.log('AVAILABLE_SKIP_AUTHZ=PASS actor_role=INVENT auth_required=false not_owner=false');

    await stage('PICKER_SCOPE', 15000, () => assertPickerIsolation(tokenPicker2, [availablePicker.id, skipPicker.id]));
    const finalMetrics = await metrics(B.page);
    if (Number(finalMetrics.fullScreenRenders || 0) !== 0) throw new Error(`FULL_SCREEN_RENDER_COUNT=${finalMetrics.fullScreenRenders}`);
    if (Number(finalMetrics.duplicateIgnored || 0) < 1 || Number(finalMetrics.staleIgnored || 0) < 1) throw new Error(`REALTIME_METRICS_INCOMPLETE:${safe(JSON.stringify(finalMetrics))}`);
    console.log(`TWO_SESSION_REALTIME=PASS marker=${RUN_MARKER} events=${Number(finalMetrics.events || 0)} patchedCards=${Number(finalMetrics.patchedCards || 0)} duplicateIgnored=${Number(finalMetrics.duplicateIgnored || 0)} staleIgnored=${Number(finalMetrics.staleIgnored || 0)} fullScreenRenders=${Number(finalMetrics.fullScreenRenders || 0)}`);
  } finally {
    if (A?.context) await A.context.close().catch(() => {});
    if (B?.context) await B.context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});

    try {
      await db.runTransaction(async (transaction) => {
        const current = await transaction.get(signalRef);
        const data = current.exists ? current.data() : null;
        if (data?.source === RUN_MARKER || String(data?.event_id || '').startsWith(RUN_MARKER)) {
          if (signalSnapshot.exists) transaction.set(signalRef, signalSnapshot.data);
          else transaction.delete(signalRef);
        }
      });
      signalRestoreOk = true;
      console.log('FIRESTORE_SIGNAL_RESTORE=PASS');
    } catch (error) {
      console.error(`FIRESTORE_SIGNAL_RESTORE=FAIL ${safe(error?.message || error)}`);
    }

    try {
      await deleteExactFirebaseUsers(auth);
      await assertFirebaseUsersGone(auth);
      firebaseCleanupOk = true;
    } catch (error) {
      console.error(`FIREBASE_FIXTURE_CLEANUP=FAIL ${safe(error?.message || error)}`);
    }

    await deleteApp(app).catch(() => {});
    if (!signalRestoreOk || !firebaseCleanupOk) process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(`TARGETED_TWO_SESSION_FAILURE ${safe(error?.stack || error)}`);
  process.exitCode = process.exitCode || 1;
});
