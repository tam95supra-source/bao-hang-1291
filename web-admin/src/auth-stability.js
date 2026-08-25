import { createClient } from './backend-runtime.js';

// Install the canonical Firebase/Neon adapter first, then harden the requests
// used by login/session restore. A refresh token is exchanged directly with
// Firebase Secure Token so a cold browser load never waits on in-memory Auth
// state before the production ID token can be validated by Neon.
createClient();

const BRIDGE_ORIGIN = 'https://backend.bao-hang-1291.invalid';
const BRIDGE_HOST = 'backend.bao-hang-1291.invalid';
const FIREBASE_API_KEY = 'AIzaSyB-n368fntzxsuuLlvte9NXhcuX0DDbTXM';
const LOGIN_DEADLINE_MS = 12_000;
const bridgeFetch = globalThis.fetch.bind(globalThis);

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function friendlyTimeout(label) {
  return `${label} quá thời gian phản hồi. Vui lòng thử lại.`;
}

async function withDeadline(promise, label, timeoutMs = LOGIN_DEADLINE_MS) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(friendlyTimeout(label))), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function parseBody(init) {
  if (!init?.body || typeof init.body !== 'string') return {};
  try { return JSON.parse(init.body); } catch { return {}; }
}

async function refreshFirebaseSession(init) {
  const refreshToken = String(parseBody(init).refresh_token || '').trim();
  if (!refreshToken) return jsonResponse({ error: 'TOKEN_REFRESH_REQUIRED', message: 'TOKEN_REFRESH_REQUIRED' }, 400);

  const response = await withDeadline(
    bridgeFetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(FIREBASE_API_KEY)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    }),
    'Làm mới phiên đăng nhập',
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.id_token) {
    const raw = String(payload?.error?.message || payload?.error || `TOKEN_REFRESH_HTTP_${response.status}`);
    return jsonResponse({ error: raw, message: raw }, response.status || 400);
  }
  return jsonResponse({
    access_token: payload.id_token,
    refresh_token: payload.refresh_token || refreshToken,
    expires_in: Number(payload.expires_in || 3600),
    token_type: 'bearer',
    user: { id: payload.user_id || '' },
  });
}

async function stableLoginFetch(input, init = {}) {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  if (url.hostname !== BRIDGE_HOST) return bridgeFetch(input, init);

  if (url.pathname === '/data/profiles') {
    try {
      const headers = new Headers(init.headers || {});
      headers.set('content-type', 'application/json');
      headers.delete('apikey');
      const response = await withDeadline(
        bridgeFetch(`${BRIDGE_ORIGIN}/api/web-api/session-profile`, {
          method: 'POST',
          headers,
          body: JSON.stringify({}),
        }),
        'Tải hồ sơ đăng nhập',
      );
      if (!response.ok) return response;
      const payload = await response.json();
      const profile = payload?.profile || null;
      return jsonResponse(profile ? [profile] : [], 200);
    } catch (error) {
      const message = error?.message || friendlyTimeout('Tải hồ sơ đăng nhập');
      return jsonResponse({ error: message, message }, 504);
    }
  }

  if (url.pathname === '/auth/token') {
    try {
      const grantType = url.searchParams.get('grant_type') || '';
      if (grantType === 'refresh_token') return await refreshFirebaseSession(init);
      return await withDeadline(bridgeFetch(input, init), 'Xác thực đăng nhập');
    } catch (error) {
      const message = error?.message || friendlyTimeout('Xác thực đăng nhập');
      return jsonResponse({ error: message, message }, 504);
    }
  }

  return bridgeFetch(input, init);
}

globalThis.fetch = stableLoginFetch;
globalThis.__BH_AUTH_STABILITY__ = Object.freeze({
  version: '2026-08-26.1',
  profileTransport: 'api_session_profile_rpc',
  refreshTransport: 'firebase_secure_token',
  loginDeadlineMs: LOGIN_DEADLINE_MS,
});