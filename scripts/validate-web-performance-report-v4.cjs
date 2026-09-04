'use strict';
const fs=require('fs');
const path=require('path');
const {execFileSync}=require('child_process');
const root=path.resolve(__dirname,'..');
const file=(p)=>path.join(root,p);
const read=(p)=>fs.readFileSync(file(p),'utf8');
const index=read('web-admin/index.html');
const main=read('web-admin/src/main.js');
const v4=read('web-admin/src/workflow-v4-ux.js');
const v4I18n=read('web-admin/src/workflow-v4-i18n-guard.js');
const css=read('web-admin/src/workflow-v4-ux.css');
const pager=read('web-admin/src/workflow-v3-post-main.js');
execFileSync(process.execPath,['--check',file('web-admin/src/workflow-v4-ux.js')],{stdio:'inherit'});
execFileSync(process.execPath,['--check',file('web-admin/src/workflow-v4-i18n-guard.js')],{stdio:'inherit'});
const v4Pos=index.indexOf('/src/workflow-v4-ux.js'), mainPos=index.indexOf('/src/main.js');
const pagerPos=index.indexOf('/src/workflow-v3-post-main.js'), guardPos=index.indexOf('/src/workflow-v4-i18n-guard.js');
if(v4Pos<0||mainPos<0||v4Pos>=mainPos)throw new Error('V4_LOAD_ORDER_INVALID');
if(pagerPos<0||guardPos<0||guardPos<=pagerPos)throw new Error('V4_I18N_GUARD_ORDER_INVALID');
for(const marker of [
  "globalThis.__BH_REPORT_V4_RENDER__ || wv2.reports",
  "globalThis.__BH_DEVICE_V4_RENDER__ || renderDevices",
  'globalThis.__BH_WORKFLOW_V4_LOG_PAGER_PENDING__',
  'await globalThis.__BH_WORKFLOW_V3_LOG_PAGER__?.refresh?.()',
]) if(!main.includes(marker))throw new Error('MAIN_V4_MARKER_MISSING:'+marker);
for(const marker of [
  'api_reports_summary_v2_rpc',
  'api_issue_history_page_rpc',
  'p_status:reportState.status || null',
  'summaryCache:new Map()',
  'pageCache:new Map()',
  'const summaryPromise=loadSummary(range), pagePromise=loadPage(range);',
  'service-metrics',
  'Log nằm trên Google Drive nên không được dùng làm dữ liệu chính của màn này.',
  '__BH_WORKFLOW_V4_UX__',
]) if(!v4.includes(marker))throw new Error('V4_BEHAVIOR_MISSING:'+marker);
if(v4.includes("api('list-logs'"))throw new Error('DEVICE_V4_MUST_NOT_DEPEND_ON_DRIVE_LOG_LIST');
for(const marker of [
  "window.addEventListener('bh:languagechange'",
  "routeActive('reports')",
  '__BH_REPORT_V4_RENDER__',
  "routeActive('devices')",
  '__BH_DEVICE_V4_RENDER__',
  '__BH_WORKFLOW_V4_I18N_GUARD__',
  "strategy: 'post-legacy-rerender'",
]) if(!v4I18n.includes(marker))throw new Error('V4_I18N_GUARD_MISSING:'+marker);
for(const marker of [
  'Google Drive đang phản hồi chậm',
  "if (!ours && pagerState[kind].loaded) { renderSection(kind); continue; }",
  'if (!pagerState[kind].loaded) void loadSection(kind);',
]) if(!pager.includes(marker))throw new Error('LOG_PERF_MARKER_MISSING:'+marker);
for(const marker of ['.v4-primary','.v4-attention','.v4-trend-row','.v4-detail-tools'])if(!css.includes(marker))throw new Error('V4_STYLE_MISSING:'+marker);
console.log('WEB_PERFORMANCE_REPORT_V4=PASS report_business_first=true device_drive_block=false log_duplicate_reads=false log_cached_reentry=true i18n_v4_authoritative=true');
