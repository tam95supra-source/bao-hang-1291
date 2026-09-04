'use strict';
const fs=require('fs');

const files=[
  'web-admin/src/main.js',
  'web-admin/src/ops-console.js',
  'web-admin/src/warehouse-ui-v2.js',
  'web-admin/src/web-fast-ui.js',
  'web-admin/src/picker-realtime.js',
];
const i18n=fs.readFileSync('web-admin/src/i18n.js','utf8');
const vi=/[ÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠƯàáâãèéêìíòóôõùúăđĩũơưẠ-ỹ]/;

const keys=new Set();
for(const m of i18n.matchAll(/\[\s*(?:"([^"]*)"|'((?:\\'|[^'])*)')\s*,/g)){
  keys.add((m[1]??m[2]).replace(/\\'/g,"'"));
}
if(!keys.size)throw new Error('I18N_MAP_KEYS_MISSING');

function candidates(source){
  const out=new Set();
  const add=(value)=>{
    const s=String(value||'').replace(/\s+/g,' ').trim();
    if(!s||!vi.test(s)||keys.has(s))return;
    if(s.includes(').replace(/')||s.includes('RegExp')||s.includes('Regex('))return;
    if(/[<>{}]/.test(s))return;
    out.add(s);
  };
  for(const m of source.matchAll(/>([^<>{}\n]{1,260})</g))add(m[1]);
  for(const m of source.matchAll(/'([^'\n]{2,260})'/g))add(m[1]);
  return out;
}
const missing=[];
for(const file of files){
  const source=fs.readFileSync(file,'utf8');
  for(const text of candidates(source))missing.push(file+': '+text);
}
const allowed=[
  'web-admin/src/ops-console.js: Thay nguồn nhân sự sang Google Sheet/tab này?\\n\\nNhân sự không còn trong nguồn mới sẽ bị khóa và xóa hẳn nếu chưa từng phát sinh lịch sử. Lịch sử báo hàng cũ vẫn được giữ.',
];
const uncovered=missing.filter(x=>!allowed.includes(x));
if(uncovered.length)throw new Error('I18N_STATIC_COVERAGE_MISSING='+JSON.stringify(uncovered.slice(0,40)));

const bad=[
  'Waiting for pickup',
  'Pickup target (minutes)',
  'Pickup time',
  'Event administrator',
  "['Nhật ký & kiểm tra','Logs & audit']",
  "['BÁO HÀNG 1291','SHORTAGE REPORT 1291']",
];
for(const marker of bad)if(i18n.includes(marker))throw new Error('I18N_BAD_CONTEXT_PRESENT:'+marker);

const required=[
  "const PHRASE_EN = new Map([",
  "if (EN.has(core)) return leading + EN.get(core) + trailing;",
  "getMissingTranslations: () => [...missingSeen]",
  "function setTextIfChanged(node, value)",
  "node.textContent !== value",
  "function setAttributeIfChanged(node, name, value)",
  "node.getAttribute(name) !== value",
  "setTextIfChanged(label, english ? 'Language' : 'Ngôn ngữ')",
  "'Vietnamese' : 'Tiếng Việt Nam'",
  "'English' : 'Tiếng Anh'",
  "if (select.value !== language) select.value = language",
];
for(const marker of required)if(!i18n.includes(marker))throw new Error('I18N_ENGINE_MARKER_MISSING:'+marker);

const mutationLoopRisks=[
  "if (label) label.textContent = english ? 'Language' : 'Ngôn ngữ'",
  "if (vi) vi.textContent = english ? 'Vietnamese' : 'Tiếng Việt Nam'",
  "if (en) en.textContent = english ? 'English' : 'Tiếng Anh'",
];
for(const marker of mutationLoopRisks)if(i18n.includes(marker))throw new Error('I18N_MUTATION_LOOP_RISK_PRESENT:'+marker);

const logger=fs.readFileSync('web-admin/src/web-logger.js','utf8');
for(const forbidden of ['route_change','visibility_change','ui_click','console.warn =','page_start'])if(logger.includes(forbidden))throw new Error('WEB_LOG_SPAM_PATH_PRESENT:'+forbidden);
for(const requiredLogger of ['AUTO_FLUSH_INTERVAL_MS = 60 * 60 * 1000','AUTO_FILE_MIN_INTERVAL_MS = 30 * 60 * 1000','createWebDiagnosticLog','mode = \'auto\'','manual_diagnostic_snapshot'])if(!logger.includes(requiredLogger))throw new Error('WEB_LOG_POLICY_MISSING:'+requiredLogger);

const runtime=fs.readFileSync('web-admin/src/backend-runtime.js','utf8');
if(!runtime.includes("if (action === 'list-logs') return worker('list-device-logs', body, init)"))throw new Error('DRIVE_DEVICE_LIST_ROUTE_MISSING');
if(runtime.includes("case 'list-logs': return ['api_list_logs_rpc'"))throw new Error('SERVICE_DEVICE_LOG_LIST_STILL_ACTIVE');
if(!runtime.includes('GOOGLE_WORKER_INVALID_RESPONSE'))throw new Error('GOOGLE_HTML_RESPONSE_GUARD_MISSING');

const main=fs.readFileSync('web-admin/src/main.js','utf8');
for(const marker of ['TẠO FILE LOG ĐẦY ĐỦ','createWebDiagnosticLog()','Promise.allSettled','Nhật ký hệ thống'])if(!main.includes(marker))throw new Error('WEB_LOG_UI_MARKER_MISSING:'+marker);
if(main.includes('setTimeout(() => void flushWebLogs(), 1500)'))throw new Error('LOGIN_LOG_SPAM_FLUSH_PRESENT');

console.log('WEB_I18N_STATIC_COVERAGE=PASS files='+files.length+' missing=0');
console.log('WEB_I18N_CONTEXT_GATE=PASS bad_context=0 mutation_loop_risk=0');
console.log('WEB_LOG_POLICY_GATE=PASS sparse_auto=true manual=true malformed_html_guard=true drive_list=true');
