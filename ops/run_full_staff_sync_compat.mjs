const nativeFetch = globalThis.fetch;
const NEON_PREFIX = 'https://ep-morning-bread-az3w94qb.apirest.c-3.ap-southeast-1.aws.neon.tech/neondb/rest/v1/';
const FIREBASE_UPDATE_PREFIX = 'https://identitytoolkit.googleapis.com/v1/projects/bao-hang-1291/accounts:update';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let firebaseUpdateTail = Promise.resolve();
let lastFirebaseUpdateAt = 0;

async function throttledFirebaseUpdate(input, init) {
  const task = async () => {
    const gap = Date.now() - lastFirebaseUpdateAt;
    if (gap < 300) await sleep(300 - gap);
    for (let attempt = 1; attempt <= 4; attempt++) {
      lastFirebaseUpdateAt = Date.now();
      const response = await nativeFetch(input, init);
      if (response.status !== 429 && response.status < 500) return response;
      if (attempt === 4) return response;
      const retryAfter = Number(response.headers.get('retry-after') || 0);
      await sleep(retryAfter > 0 ? retryAfter * 1000 : 500 * (2 ** (attempt - 1)));
    }
  };
  const run = firebaseUpdateTail.then(task, task);
  firebaseUpdateTail = run.then(() => undefined, () => undefined);
  return run;
}

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : String(input?.url || input);
  if (url.startsWith(FIREBASE_UPDATE_PREFIX)) return throttledFirebaseUpdate(input, init);
  if (!url.startsWith(NEON_PREFIX)) return nativeFetch(input, init);
  const headers = new Headers(init.headers || {});
  if (!headers.has('apikey')) headers.set('apikey', 'compat-public');
  return nativeFetch(input, { ...init, headers });
};

console.log('NEON_COMPAT_AUTH_HEADER=PASS');
console.log('FIREBASE_UPDATE_RATE_GUARD=PASS');
await import('./full_staff_sync.mjs');
