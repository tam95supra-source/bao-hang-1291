function routeActive(tab) {
  if (typeof globalThis.__BH_ROUTE_ACTIVE__ === 'function') return globalThis.__BH_ROUTE_ACTIVE__(tab);
  return Boolean(document.querySelector(`.tabs [data-tab="${tab}"].active`));
}
let v5RerenderSeq = 0;
window.addEventListener('bh:languagechange', () => {
  const seq = ++v5RerenderSeq;
  setTimeout(() => {
    if (seq !== v5RerenderSeq) return;
    if (routeActive('overview') && typeof globalThis.__BH_OVERVIEW_V5_RENDER__ === 'function') {
      void globalThis.__BH_OVERVIEW_V5_RENDER__();
      return;
    }
    if (routeActive('reports') && typeof globalThis.__BH_REPORT_V5_RENDER__ === 'function') {
      void globalThis.__BH_REPORT_V5_RENDER__();
    }
  }, 0);
});
globalThis.__BH_DASHBOARD_V5_I18N_GUARD__ = Object.freeze({overview:true,reports:true,strategy:'post-v3-v4-rerender'});
