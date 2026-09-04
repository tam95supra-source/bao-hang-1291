// BÁO HÀNG 1291 — route-scoped lazy loading policy.
// main.js already lazy-imports the module required by the active route.
// Its historical idle warm-up uses requestIdleCallback({timeout:1800}) to import
// every role-visible module in the background. Those speculative imports can run
// module initialization against an unrelated route DOM (for example #/sku),
// causing detached/null-root side effects and unnecessary network/CPU work.
//
// Keep requestIdleCallback available for all other callers; suppress only the
// canonical speculative warm-up signature. Active-route imports continue via
// ensureTabModule() before the renderer executes.
const nativeRequestIdleCallback = typeof globalThis.requestIdleCallback === 'function'
  ? globalThis.requestIdleCallback.bind(globalThis)
  : null;

if (nativeRequestIdleCallback) {
  globalThis.requestIdleCallback = (callback, options = {}) => {
    if (Number(options?.timeout || 0) === 1800) return 0;
    return nativeRequestIdleCallback(callback, options);
  };
}

globalThis.__BH_ROUTE_LAZY_POLICY__ = Object.freeze({
  mode: 'active-route-only',
  speculativeWarm: false,
  blockedIdleTimeoutMs: 1800,
});
