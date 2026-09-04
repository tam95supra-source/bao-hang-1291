function routeActive(tab) {
  if (typeof globalThis.__BH_ROUTE_ACTIVE__ === 'function') return globalThis.__BH_ROUTE_ACTIVE__(tab);
  return Boolean(document.querySelector(`.tabs [data-tab="${tab}"].active`));
}

let rerenderSeq = 0;
window.addEventListener('bh:languagechange', () => {
  const seq = ++rerenderSeq;
  // V3 also schedules a zero-delay rerender for legacy routes. This module is loaded
  // last, so its timer runs after V3 and restores the authoritative V4 renderer.
  setTimeout(() => {
    if (seq !== rerenderSeq) return;
    if (routeActive('reports') && typeof globalThis.__BH_REPORT_V4_RENDER__ === 'function') {
      void globalThis.__BH_REPORT_V4_RENDER__();
      return;
    }
    if (routeActive('devices') && typeof globalThis.__BH_DEVICE_V4_RENDER__ === 'function') {
      void globalThis.__BH_DEVICE_V4_RENDER__();
    }
  }, 0);
});

globalThis.__BH_WORKFLOW_V4_I18N_GUARD__ = Object.freeze({
  reports: true,
  devices: true,
  strategy: 'post-legacy-rerender',
});
