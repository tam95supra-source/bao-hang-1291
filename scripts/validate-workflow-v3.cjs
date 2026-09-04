'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const index = read('web-admin/index.html');
const ui = read('web-admin/src/workflow-v3-overrides.js');
const post = read('web-admin/src/workflow-v3-post-main.js');
const sql = read('ops/neon/20260904_workflow_v3_no_claim.sql');
const follow = read('ops/neon/20260904_workflow_v3_followup.sql');
const workerPatch = read('ops/patch_workflow_v3_worker.cjs');
const acceptancePatch = read('scripts/patch-final-fast-events-harness.cjs');
function must(condition, message) { if (!condition) { console.error(`WORKFLOW_V3_GUARD=FAIL ${message}`); process.exit(1); } }

const overridePos = index.indexOf('/src/workflow-v3-overrides.js');
const mainPos = index.indexOf('/src/main.js');
const postPos = index.indexOf('/src/workflow-v3-post-main.js');
must(overridePos >= 0 && mainPos >= 0 && postPos >= 0 && overridePos < mainPos && mainPos < postPos, 'required module order is override < main < post-main');

for (const file of ['web-admin/src/workflow-v3-overrides.js','web-admin/src/workflow-v3-post-main.js','scripts/patch-final-fast-events-harness.cjs','ops/patch_workflow_v3_worker.cjs']) {
  execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio:'inherit' });
}

for (const label of ['Đang xử lý','Đã có hàng','Đã bỏ qua','Picker thu hồi']) must(ui.includes(label), `missing app-matched tab: ${label}`);
for (const removed of ['data-wv3-action="claim"','data-wv3-action="reassign"','Nhận xử lý</button>','Điều phối lại</button>']) must(!ui.includes(removed), `removed receive-flow UI returned: ${removed}`);
for (const timing of ['Tự động cho phép bỏ qua','Nhắc team Inventory xử lý','Nhắc Picker xác nhận']) must(ui.includes(timing), `missing timing control: ${timing}`);
must(ui.includes('api_issue_history_page_rpc'), 'report history must use server pagination');
must(ui.includes('[25,50,100]'), 'report pagination page sizes missing');
must(ui.includes('__BH_FAST_ISSUE_SIGNAL__') && ui.includes('issue-delta'), 'card-only realtime protection missing');

for (const removedAction of ["'claim-issue'", "'reassign-issue'"]) must(post.includes(removedAction), `post-main removed-action boundary missing: ${removedAction}`);
must(post.includes("error:'RECEIVE_FLOW_REMOVED'"), 'post-main receive-flow 410 guard missing');
must(post.includes("mode:'server'") && post.includes('pageSizes:[25,50,100]'), 'server log pager contract missing');
must(post.includes('api_audit_history_page_rpc') && post.includes("action === 'list-logs'") && post.includes("action === 'list-web-logs'"), 'paged diagnostics source routing missing');

must(sql.includes('RECEIVE_FLOW_REMOVED'), 'backend receive-flow guard missing');
must(sql.includes('Đã quá hạn Inventory xử lí lúc '), 'auto-skip deadline note missing');
must(sql.includes('api_reports_summary_v2_rpc'), 'operations report v2 missing');
must(sql.includes('api_issue_history_page_rpc'), 'history pagination RPC missing');
must(sql.includes('api_audit_history_page_rpc'), 'audit pagination RPC missing');

must(follow.includes('resolved_at=deadline_at'), 'auto-skip resolved_at must equal business deadline');
must(follow.includes("p.role IN ('ADMIN','ADMIN_INVENT','INVENT')"), 'Inventory reminder must include ADMIN, ADMIN_INVENT and INVENT');
must(follow.includes("'CẦN XỬ LÝ • SKU '"), 'Inventory reminder title contract missing');
must(follow.includes('reminder_interval_minutes') && follow.includes('next_inventory_at') && follow.includes('next_auto_skip_at'), 'reminder/scheduler interval corrections missing');
must(follow.includes('p_inventory_reminder_minutes integer'), 'four-field operational config compatibility overload missing');

must(workerPatch.includes('page_size:pageSize') && workerPatch.includes('total_pages:totalPages'), 'Google Drive log pagination metadata missing');
must(workerPatch.includes('logs:rows.slice(offset,offset+pageSize)'), 'Google Drive log result must be server-sliced');
must(workerPatch.includes('[25,50,100]'), 'Google Drive log page sizes missing');

must(acceptancePatch.includes('NO_CLAIM_UI=PASS'), 'production acceptance must assert no receiving/claim UI');
must(acceptancePatch.includes('data-wv3-select') && acceptancePatch.includes('data-wv3-action'), 'production acceptance must target Workflow V3 renderer');
must(acceptancePatch.includes('CLAIM_FLOW_STILL_PRESENT_IN_FINAL_HARNESS'), 'production acceptance must fail if claim flow survives patching');

console.log('WORKFLOW_V3_GUARD=PASS tabs=4 timings=3 claim_ui=0 removed_action_boundary=PASS server_pagination=PASS sla_deadline=PASS reminders=PASS realtime=PASS acceptance=workflow-v3');
