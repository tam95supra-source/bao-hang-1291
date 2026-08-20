from pathlib import Path

# backend-runtime.js: wait until Firebase persistent auth has restored before refreshing.
p=Path('web-admin/src/backend-runtime.js')
s=p.read_text()
old="""async function refreshFirebase(body) {
  const refreshToken = String(body.refresh_token || '')
  const { auth } = await firebaseRuntime()
  if (auth.currentUser) {"""
new="""async function refreshFirebase(body) {
  const refreshToken = String(body.refresh_token || '')
  const { auth } = await firebaseRuntime()
  if (typeof auth.authStateReady === 'function') await auth.authStateReady()
  if (auth.currentUser) {"""
if old in s:
    s=s.replace(old,new,1)
elif "if (typeof auth.authStateReady === 'function') await auth.authStateReady()" not in s:
    raise SystemExit('FIREBASE_AUTH_READY_ANCHOR_NOT_FOUND')
p.write_text(s)

# main.js: one in-memory session owner; force-refresh on cold load and retry AUTH_REQUIRED once.
p=Path('web-admin/src/main.js')
s=p.read_text()
old="""async function refreshSessionIfNeeded() {
  if (!state.session) throw new Error('Phiên đăng nhập không tồn tại.');
  const now = Math.floor(Date.now() / 1000);
  if ((state.session.expires_at || 0) > now + 120) return;
  const token = await authToken({ refresh_token: state.session.refresh_token }, 'refresh_token');
  saveSession({ ...state.session, access_token: token.access_token, refresh_token: token.refresh_token || state.session.refresh_token, expires_at: now + Number(token.expires_in || 3600) });
  realtimeClient.realtime.setAuth(state.session.access_token);
}"""
new="""async function refreshSessionIfNeeded(force = false) {
  if (!state.session) throw new Error('Phiên đăng nhập không tồn tại.');
  const now = Math.floor(Date.now() / 1000);
  if (!force && (state.session.expires_at || 0) > now + 120) return state.session;
  const token = await authToken({ refresh_token: state.session.refresh_token }, 'refresh_token');
  if (!token?.access_token) throw new Error('Không thể làm mới phiên đăng nhập.');
  saveSession({ ...state.session, access_token: token.access_token, refresh_token: token.refresh_token || state.session.refresh_token, expires_at: now + Number(token.expires_in || 3600) });
  realtimeClient.realtime.setAuth(state.session.access_token);
  return state.session;
}
window.__BH_AUTH__ = {
  ensureSession: async (force = false) => { await refreshSessionIfNeeded(force); return state.session; },
  getSession: () => state.session,
};
async function responseNeedsAuthRefresh(response) {
  if (response.status === 401) return true;
  const text = await response.clone().text().catch(() => '');
  return /(^|[^A-Z_])AUTH_REQUIRED([^A-Z_]|$)/.test(text);
}"""
if old in s:
    s=s.replace(old,new,1)
elif 'window.__BH_AUTH__' not in s or 'responseNeedsAuthRefresh' not in s:
    raise SystemExit('MAIN_REFRESH_SESSION_ANCHOR_NOT_FOUND')

old="""async function api(action, payload = {}) {
  await refreshSessionIfNeeded();
  const headers = { 'content-type': 'application/json', apikey: BRIDGE_PUBLIC_KEY, authorization: `Bearer ${state.session.access_token}` };
  if (state.testRole) headers['x-admin-test-role'] = state.testRole;
  const response = await fetch(`${API_BASE}/${encodeURIComponent(action)}`, { method: 'POST', headers, body: JSON.stringify(payload) });
  if (response.status === 401) {
    clearSession();
    renderLogin('Phiên đăng nhập đã hết hạn.');
    throw new Error('Phiên đăng nhập đã hết hạn.');
  }
  return parseResponse(response);
}"""
new="""async function api(action, payload = {}, allowAuthRetry = true) {
  await refreshSessionIfNeeded(false);
  const headers = { 'content-type': 'application/json', apikey: BRIDGE_PUBLIC_KEY, authorization: `Bearer ${state.session.access_token}` };
  if (state.testRole) headers['x-admin-test-role'] = state.testRole;
  const response = await fetch(`${API_BASE}/${encodeURIComponent(action)}`, { method: 'POST', headers, body: JSON.stringify(payload) });
  if (await responseNeedsAuthRefresh(response)) {
    if (allowAuthRetry) {
      try {
        await refreshSessionIfNeeded(true);
        return api(action, payload, false);
      } catch (_) {}
    }
    clearSession();
    renderLogin('Phiên đăng nhập cần xác thực lại.');
    throw new Error('Phiên đăng nhập cần xác thực lại.');
  }
  return parseResponse(response);
}"""
if old in s:
    s=s.replace(old,new,1)
elif 'allowAuthRetry = true' not in s:
    raise SystemExit('MAIN_API_RETRY_ANCHOR_NOT_FOUND')

old="""async function issueWithdraw(action, payload = {}) {
  await refreshSessionIfNeeded();
  const headers = { 'content-type': 'application/json', apikey: BRIDGE_PUBLIC_KEY, authorization: `Bearer ${state.session.access_token}` };
  if (state.testRole) headers['x-admin-test-role'] = state.testRole;
  const response = await fetch(`${BACKEND_BRIDGE_URL}/api/issue-withdraw/${encodeURIComponent(action)}`, { method: 'POST', headers, body: JSON.stringify(payload) });
  return parseResponse(response);
}"""
new="""async function issueWithdraw(action, payload = {}, allowAuthRetry = true) {
  await refreshSessionIfNeeded(false);
  const headers = { 'content-type': 'application/json', apikey: BRIDGE_PUBLIC_KEY, authorization: `Bearer ${state.session.access_token}` };
  if (state.testRole) headers['x-admin-test-role'] = state.testRole;
  const response = await fetch(`${BACKEND_BRIDGE_URL}/api/issue-withdraw/${encodeURIComponent(action)}`, { method: 'POST', headers, body: JSON.stringify(payload) });
  if (await responseNeedsAuthRefresh(response)) {
    if (allowAuthRetry) {
      try {
        await refreshSessionIfNeeded(true);
        return issueWithdraw(action, payload, false);
      } catch (_) {}
    }
    clearSession();
    renderLogin('Phiên đăng nhập cần xác thực lại.');
    throw new Error('Phiên đăng nhập cần xác thực lại.');
  }
  return parseResponse(response);
}"""
if old in s:
    s=s.replace(old,new,1)
elif 'issueWithdraw(action, payload = {}, allowAuthRetry = true)' not in s:
    raise SystemExit('WITHDRAW_AUTH_RETRY_ANCHOR_NOT_FOUND')

old="""state.session = readSession();
if (state.session) renderApp(); else renderLogin();"""
new="""async function bootstrapApp() {
  state.session = readSession();
  if (!state.session) { renderLogin(); return; }
  try {
    // A stored access token is not trusted on cold load. Refresh Firebase first,
    // then validate the profile before rendering any authenticated view/RPC.
    await refreshSessionIfNeeded(true);
    const userId = state.session?.profile?.id;
    if (!userId) throw new Error('SESSION_PROFILE_MISSING');
    const profile = await fetchProfile(state.session.access_token, userId);
    if (!profile.active) throw new Error('USER_INACTIVE');
    saveSession({ ...state.session, profile });
    renderApp();
  } catch (_) {
    clearSession();
    renderLogin('Phiên đăng nhập cần xác thực lại.');
  }
}
bootstrapApp();"""
if old in s:
    s=s.replace(old,new,1)
elif 'async function bootstrapApp()' not in s:
    raise SystemExit('BOOTSTRAP_ANCHOR_NOT_FOUND')
p.write_text(s)

# ops-console.js: delegate to main session owner and retry AUTH_REQUIRED once.
p=Path('web-admin/src/ops-console.js')
s=p.read_text()
old="""async function refreshSessionIfNeeded() {
  const session = readSession();
  if (!session) throw new Error('Phiên đăng nhập không tồn tại.');
  const now = Math.floor(Date.now() / 1000);
  if ((session.expires_at || 0) > now + 90) return session;
  const response = await fetch(`${BACKEND_BRIDGE_URL}/auth/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: BRIDGE_PUBLIC_KEY },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error_description || data.message || 'Phiên đăng nhập đã hết hạn.');
  const updated = {
    ...session,
    access_token: data.access_token,
    refresh_token: data.refresh_token || session.refresh_token,
    expires_at: now + Number(data.expires_in || 3600),
  };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(updated));
  return updated;
}"""
new="""async function refreshSessionIfNeeded(force = false) {
  if (globalThis.__BH_AUTH__?.ensureSession) return globalThis.__BH_AUTH__.ensureSession(force);
  const session = readSession();
  if (!session) throw new Error('Phiên đăng nhập không tồn tại.');
  const now = Math.floor(Date.now() / 1000);
  if (!force && (session.expires_at || 0) > now + 90) return session;
  const response = await fetch(`${BACKEND_BRIDGE_URL}/auth/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: BRIDGE_PUBLIC_KEY },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error(data.error_description || data.message || 'Phiên đăng nhập đã hết hạn.');
  const updated = { ...session, access_token: data.access_token, refresh_token: data.refresh_token || session.refresh_token, expires_at: now + Number(data.expires_in || 3600) };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(updated));
  return updated;
}"""
if old in s:
    s=s.replace(old,new,1)
elif 'globalThis.__BH_AUTH__?.ensureSession' not in s:
    raise SystemExit('OPS_REFRESH_DELEGATE_ANCHOR_NOT_FOUND')

old="""async function request(base, action, payload = {}) {
  const session = await refreshSessionIfNeeded();"""
new="""async function request(base, action, payload = {}, allowAuthRetry = true) {
  const session = await refreshSessionIfNeeded(false);"""
if old in s:
    s=s.replace(old,new,1)
elif 'allowAuthRetry = true' not in s:
    raise SystemExit('OPS_REQUEST_SIGNATURE_ANCHOR_NOT_FOUND')
old="""  if (!response.ok) throw new Error(data.error || data.message || `Lỗi máy chủ ${response.status}`);
  return data;
}"""
new="""  const authRequired = response.status === 401 || /(^|[^A-Z_])AUTH_REQUIRED([^A-Z_]|$)/.test(String(data.error || data.message || ''));
  if (authRequired && allowAuthRetry && globalThis.__BH_AUTH__?.ensureSession) {
    await refreshSessionIfNeeded(true);
    return request(base, action, payload, false);
  }
  if (!response.ok) throw new Error(authRequired ? 'Phiên đăng nhập cần xác thực lại.' : (data.error || data.message || `Lỗi máy chủ ${response.status}`));
  return data;
}"""
# only replace first occurrence, which is request()
if old in s:
    s=s.replace(old,new,1)
elif 'const authRequired = response.status === 401' not in s:
    raise SystemExit('OPS_REQUEST_RETRY_ANCHOR_NOT_FOUND')
p.write_text(s)
