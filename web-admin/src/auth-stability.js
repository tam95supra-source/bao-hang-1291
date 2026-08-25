import { createClient } from './backend-runtime.js';

// Install the canonical Firebase/Neon adapter first, then harden the two requests
// used by the login screen. The old direct profiles read is translated to the
// production session-profile RPC so auth and authorization have one source of truth.
createClient();

const BRIDGE_ORIGIN = 'https://backend.bao-hang-1291.invalid';
const BRIDGE_HOST = 'backend.bao-hang-1291.invalid';
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
  version: '2026-08-25.1',
  profileTransport: 'api_session_profile_rpc',
  loginDeadlineMs: LOGIN_DEADLINE_MS,
});
