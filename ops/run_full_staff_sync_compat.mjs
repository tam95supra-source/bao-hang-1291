const nativeFetch = globalThis.fetch;
const NEON_PREFIX = 'https://ep-morning-bread-az3w94qb.apirest.c-3.ap-southeast-1.aws.neon.tech/neondb/rest/v1/';
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : String(input?.url || input);
  if (!url.startsWith(NEON_PREFIX)) return nativeFetch(input, init);
  const headers = new Headers(init.headers || {});
  if (!headers.has('apikey')) headers.set('apikey', 'compat-public');
  return nativeFetch(input, { ...init, headers });
};
await import('./full_staff_sync.mjs');
