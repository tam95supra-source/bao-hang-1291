'use strict';
const fs = require('fs');
const path = process.argv[2] || 'google-apps-script/DEPLOY_NEON.gs';
let source = fs.readFileSync(path, 'utf8');

function replaceFunction(startMarker, nextMarker, replacement) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(nextMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`WORKER_PATCH_ANCHOR_MISSING:${startMarker}`);
  source = source.slice(0, start) + replacement.trimEnd() + '\n\n' + source.slice(end + 1);
}

const listDevice = `function listDeviceLogs_(body) {
  requireUser_(String(body.id_token||''),['ADMIN','ADMIN_INVENT']);
  const requested=Number(body.page_size||body.limit||25);
  const pageSize=[25,50,100].indexOf(requested)>=0?requested:25;
  const page=Math.max(1,Math.floor(Number(body.page||1)));
  const files=getLogFolder_().getFiles();
  const rows=[];
  while(files.hasNext()){
    const file=files.next();
    const name=file.getName();
    if(!((name.indexOf('device_')===0||name.indexOf('log_')===0)&&name.slice(-9)==='.jsonl.gz'))continue;
    const meta=parseLogDescription_(file);
    rows.push({
      id:file.getId(),
      employee_code:String(meta.employee_code||((name.split('_')[1])||'')),
      device_name:String(meta.device_name||''),
      app_version:String(meta.app_version||''),
      created_at:file.getDateCreated().toISOString(),
      compressed_bytes:file.getSize(),
      sha256:String(meta.sha256||''),
      storage:'GOOGLE_DRIVE_ONLY'
    });
  }
  rows.sort(function(a,b){return String(b.created_at).localeCompare(String(a.created_at));});
  const total=rows.length;
  const totalPages=Math.max(1,Math.ceil(total/pageSize));
  const safePage=Math.min(page,totalPages);
  const offset=(safePage-1)*pageSize;
  return {
    ok:true,
    logs:rows.slice(offset,offset+pageSize),
    total:total,
    page:safePage,
    page_size:pageSize,
    total_pages:totalPages,
    has_previous:safePage>1,
    has_next:safePage<totalPages,
    retention_days:BH_DEVICE_LOG_RETENTION_DAYS,
    storage:'GOOGLE_DRIVE_ONLY'
  };
}`;

const listWeb = `function listWebLogs_(body) {
  requireUser_(String(body.id_token||''),['ADMIN','ADMIN_INVENT']);
  const requested=Number(body.page_size||body.limit||25);
  const pageSize=[25,50,100].indexOf(requested)>=0?requested:25;
  const page=Math.max(1,Math.floor(Number(body.page||1)));
  const files=getLogFolder_().getFiles();
  const rows=[];
  while(files.hasNext()){
    const file=files.next();
    const name=file.getName();
    if(name.indexOf('web_')!==0||name.slice(-9)!=='.jsonl.gz')continue;
    const meta=parseLogDescription_(file);
    rows.push({id:file.getId(),file_name:name,created_at:file.getDateCreated().toISOString(),updated_at:file.getLastUpdated().toISOString(),compressed_bytes:file.getSize(),mode:String(meta.mode||(name.indexOf('web_manual_')===0?'manual':'auto')),storage:'GOOGLE_DRIVE_ONLY'});
  }
  rows.sort(function(a,b){return String(b.created_at).localeCompare(String(a.created_at));});
  const total=rows.length;
  const totalPages=Math.max(1,Math.ceil(total/pageSize));
  const safePage=Math.min(page,totalPages);
  const offset=(safePage-1)*pageSize;
  return {
    ok:true,
    logs:rows.slice(offset,offset+pageSize),
    total:total,
    page:safePage,
    page_size:pageSize,
    total_pages:totalPages,
    has_previous:safePage>1,
    has_next:safePage<totalPages,
    retention_days:BH_WEB_LOG_RETENTION_DAYS,
    storage:'GOOGLE_DRIVE_ONLY'
  };
}`;

replaceFunction('function listDeviceLogs_(body) {', '\nfunction downloadLog_(body) {', listDevice);
replaceFunction('function listWebLogs_(body) {', '\nfunction downloadWebLog_(body) {', listWeb);

if (!source.includes('logs:rows.slice(offset,offset+pageSize)')) throw new Error('WORKER_SERVER_PAGINATION_PATCH_MISSING');
if ((source.match(/total_pages:totalPages/g) || []).length !== 2) throw new Error('WORKER_SERVER_PAGINATION_METADATA_MISSING');
new Function(source);
fs.writeFileSync(path, source, 'utf8');
console.log('WORKFLOW_V3_WORKER_LOG_PAGINATION_PATCH=PASS page_sizes=25,50,100 storage=GOOGLE_DRIVE_ONLY');
