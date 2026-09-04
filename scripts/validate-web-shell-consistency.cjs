'use strict';
const fs = require('fs');

const main = fs.readFileSync('web-admin/src/main.js', 'utf8');
const ops = fs.readFileSync('web-admin/src/ops-console.js', 'utf8');
const style = fs.readFileSync('web-admin/src/style.css', 'utf8');
const i18n = fs.readFileSync('web-admin/src/i18n.js', 'utf8');
const index = fs.readFileSync('web-admin/index.html', 'utf8');
const lazyPolicy = fs.readFileSync('web-admin/src/lazy-route-policy.js', 'utf8');
const eventsLanguageGuard = fs.readFileSync('web-admin/src/events-languagechange-stability.js', 'utf8');

const requiredMain = [
  "['overview','Tổng quan hôm nay','VẬN HÀNH']",
  "['events','Xử lý báo thiếu','VẬN HÀNH']",
  "['reports','Báo cáo vận hành','VẬN HÀNH']",
  "['users','Nhân sự & tài khoản','QUẢN LÝ']",
  "['services','Hạ tầng & chi phí','HẠ TẦNG']",
  "['server','Hạ tầng & chi phí','HẠ TẦNG']",
  "['logs','Nhật ký hệ thống','HẠ TẦNG']",
  "['config','Thời gian nghiệp vụ','THIẾT LẬP']",
  "['sla','Thời gian nghiệp vụ','THIẾT LẬP']",
  "['versions','Phiên bản ứng dụng','THIẾT LẬP']",
  'data-shell-generation="canonical-v2"',
  'renderNavigation(tabs)',
  "['users','services','server','sla','config'].includes(tab)",
  "server: () => requireRenderer(ops.server, 'Hạ tầng & chi phí')()",
];
for (const marker of requiredMain) if (!main.includes(marker)) throw new Error('CANONICAL_SHELL_MARKER_MISSING:' + marker);

const forbiddenMain = [
  "__BH_OPS_NORMALIZE__",
  "['overview','Tổng quan']",
  "['events','Sự kiện']",
  "['reports','Báo cáo']",
  "['users','Nhân sự & quyền']",
  "['services','Hệ thống & dung lượng']",
  "['logs','Nhật ký & kiểm tra']",
  "['config','Cấu hình']",
  "['versions','Phiên bản']",
];
for (const marker of forbiddenMain) if (main.includes(marker)) throw new Error('LEGACY_SHELL_MARKER_PRESENT:' + marker);
for (const marker of ['normalizeNavigation','__BH_OPS_NORMALIZE__','data-ops-tab']) if (ops.includes(marker)) throw new Error('LAZY_NAV_MUTATION_PRESENT:' + marker);
for (const marker of ['.nav-section-label', '.tabs button::before', 'content: none !important']) if (!style.includes(marker)) throw new Error('CANONICAL_NAV_STYLE_MISSING:' + marker);
for (const marker of ["['VẬN HÀNH','OPERATIONS']", "['QUẢN LÝ','MANAGEMENT']", "['HẠ TẦNG','INFRASTRUCTURE']", "['THIẾT LẬP','SETTINGS']", "['Phiên bản ứng dụng','App versions']"]) {
  if (!i18n.includes(marker)) throw new Error('CANONICAL_NAV_I18N_MISSING:' + marker);
}

const policyPos = index.indexOf('/src/lazy-route-policy.js');
const mainPos = index.indexOf('/src/main.js');
if (policyPos < 0 || mainPos < 0 || policyPos >= mainPos) throw new Error('ACTIVE_ROUTE_LAZY_POLICY_ORDER_INVALID');
for (const marker of ["mode: 'active-route-only'", 'speculativeWarm: false', 'blockedIdleTimeoutMs: 1800', 'Number(options?.timeout || 0) === 1800']) {
  if (!lazyPolicy.includes(marker)) throw new Error('ACTIVE_ROUTE_LAZY_POLICY_MISSING:' + marker);
}
if (!main.includes("window.requestIdleCallback(warm, { timeout: 1800 })")) throw new Error('SPECULATIVE_WARM_SIGNATURE_CHANGED_REVIEW_REQUIRED');

const eventsGuardPos = index.indexOf('/src/events-languagechange-stability.js');
const workflowPos = index.indexOf('/src/workflow-v3-overrides.js');
if (eventsGuardPos < 0 || workflowPos < 0 || eventsGuardPos >= workflowPos) throw new Error('EVENTS_LANGUAGE_GUARD_ORDER_INVALID');
for (const marker of [
  "event?.type === 'bh:languagechange'",
  "document.querySelector('.tabs button[data-tab=\"events\"].active')",
  'nativeDispatchEvent.call(this, event)',
  "__BH_EVENTS_LANGUAGECHANGE_STABILITY__ = 'dom-translated-before-event-v1'",
]) {
  if (!eventsLanguageGuard.includes(marker)) throw new Error('EVENTS_LANGUAGE_GUARD_MISSING:' + marker);
}
const translatePos = i18n.indexOf('translateTree(document.body);');
const languageEventPos = i18n.indexOf("window.dispatchEvent(new CustomEvent('bh:languagechange'");
if (translatePos < 0 || languageEventPos < 0 || translatePos >= languageEventPos) throw new Error('I18N_TRANSLATE_BEFORE_LANGUAGE_EVENT_REQUIRED');

console.log('WEB_SHELL_STATIC_CONSISTENCY=PASS generation=canonical-v2 lazy_nav_mutation=false legacy_labels=false active_route_lazy=PASS speculative_warm=false events_languagechange_guard=PASS');
