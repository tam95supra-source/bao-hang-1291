import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { sendFcm } from "../_shared/fcm.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const LOG_BUCKET = "diagnostic-logs";
const MAX_LOG_BYTES = 2 * 1024 * 1024;

type Role = "ADMIN" | "ADMIN_INVENT" | "INVENT" | "PICKER";
type Profile = { id: string; employee_code: string; full_name: string; contractor: string; role: Role; active: boolean };
type Context = { userId: string; profile: Profile; effectiveRole: Role; client: SupabaseClient };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const ACTIVE_STATUSES = ["OPEN", "CLAIMED", "SEARCHING", "REPLENISHING"];

class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
function required(value: unknown, label: string): string { const result = String(value ?? "").trim(); if (!result) throw new HttpError(400, `${label} không được để trống`); return result; }
function employeeEmail(code: string): string { const raw = code.trim().toLowerCase(); const safe = raw.replace(/[^a-z0-9._-]/g, "-"); if (!safe || safe !== raw) throw new HttpError(400, "Mã nhân viên chỉ được dùng chữ, số, dấu chấm, gạch ngang hoặc gạch dưới"); return `${safe}@bao-hang-1291.local`; }
function normalizeSearch(value: string): string { return value.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/đ/g, "d").replace(/\s+/g, " ").trim(); }
function safeTestRole(raw: string | null): Role | null { const role = String(raw ?? "").trim().toUpperCase(); return (["ADMIN_INVENT", "INVENT", "PICKER"] as string[]).includes(role) ? role as Role : null; }

async function authenticated(req: Request): Promise<Context> {
  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) throw new HttpError(401, "Phiên đăng nhập không hợp lệ");
  const client = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) throw new HttpError(401, "Phiên đăng nhập đã hết hạn");
  const { data: profile, error: profileError } = await admin.from("profiles").select("*").eq("id", user.id).single();
  if (profileError || !profile?.active) throw new HttpError(403, "Tài khoản đã ngừng hoạt động");
  const typed = profile as Profile;
  const requestedTestRole = safeTestRole(req.headers.get("x-admin-test-role"));
  if (req.headers.get("x-admin-test-role") && !requestedTestRole) throw new HttpError(400, "Chế độ kiểm thử quyền không hợp lệ");
  if (requestedTestRole && typed.role !== "ADMIN") throw new HttpError(403, "Chỉ ADMIN được dùng chế độ kiểm thử quyền");
  return { userId: user.id, profile: typed, effectiveRole: requestedTestRole ?? typed.role, client };
}
function requireRole(context: Context, roles: Role[]) { if (!roles.includes(context.effectiveRole)) throw new HttpError(403, "Bạn không có quyền thực hiện thao tác này"); }

async function inventUserIds(): Promise<string[]> { const { data, error } = await admin.from("profiles").select("id").in("role", ["ADMIN", "ADMIN_INVENT", "INVENT"]).eq("active", true); if (error) throw error; return (data ?? []).map((row: any) => String(row.id)); }
async function reporterIds(issueId: string): Promise<string[]> { const { data, error } = await admin.from("issue_reports").select("reporter_id").eq("issue_id", issueId); if (error) throw error; return [...new Set<string>((data ?? []).map((row: any) => String(row.reporter_id)))]; }

async function notifyUsers(userIds: string[], issue: Record<string, unknown>, status: string, message: string, critical = false) {
  const unique = [...new Set(userIds)]; if (!unique.length) return;
  const titleMap: Record<string, string> = { OPEN: `Báo thiếu • SKU ${issue.sku}`, AVAILABLE: `Đã châm bù • SKU ${issue.sku}`, SKIP_ALLOWED: `Được phép SKIP • SKU ${issue.sku}`, CLAIMED: `Đã nhận xử lý • SKU ${issue.sku}` };
  const rows = unique.map((userId) => ({ issue_id: issue.id, target_user_id: userId, status, title: titleMap[status] ?? `${status} • SKU ${issue.sku}`, message, critical }));
  const { data: events, error } = await admin.from("notification_events").insert(rows).select("id,target_user_id"); if (error) throw error;
  const { data: devices, error: deviceError } = await admin.from("device_tokens").select("user_id,fcm_token").in("user_id", unique).eq("active", true); if (deviceError) throw deviceError;
  const tokens = new Map<string, string[]>(); (devices ?? []).forEach((device) => { const list = tokens.get(device.user_id) ?? []; list.push(device.fcm_token); tokens.set(device.user_id, list); });
  const sentEventIds: string[] = [];
  await Promise.all((events ?? []).map(async (event) => {
    const payload = { event_id: event.id, issue_id: String(issue.id), sku: String(issue.sku), product_name: String(issue.product_name ?? ""), status, message, critical: String(critical) };
    const results = await Promise.allSettled((tokens.get(event.target_user_id) ?? []).map((token) => sendFcm(token, payload)));
    if (results.some((item) => item.status === "fulfilled")) sentEventIds.push(event.id);
  }));
  if (sentEventIds.length) await admin.from("notification_events").update({ sent_at: new Date().toISOString(), send_count: 1 }).in("id", sentEventIds);
}

async function issueRows(ids?: string[], statuses?: string[], limit = 250) {
  let query = admin.from("issues").select("*").order("first_reported_at", { ascending: true }).limit(limit);
  if (ids?.length) query = query.in("id", ids); if (statuses?.length) query = query.in("status", statuses);
  const { data, error } = await query; if (error) throw error; const rows = data ?? [];
  const assigneeIds = [...new Set(rows.map((row) => row.claimed_by).filter(Boolean))]; const names = new Map<string, string>();
  if (assigneeIds.length) { const { data: profiles } = await admin.from("profiles").select("id,full_name").in("id", assigneeIds); (profiles ?? []).forEach((profile) => names.set(profile.id, profile.full_name)); }
  const issueIds = rows.map((row) => row.id); const latestReporter = new Map<string, string>();
  if (issueIds.length) {
    const { data: reports } = await admin.from("issue_reports").select("issue_id,reporter_id,reported_at").in("issue_id", issueIds).order("reported_at", { ascending: false }).limit(2000);
    const reporterProfileIds = [...new Set((reports ?? []).map((row) => row.reporter_id))]; const reporterNames = new Map<string, string>();
    if (reporterProfileIds.length) { const { data: ps } = await admin.from("profiles").select("id,full_name").in("id", reporterProfileIds); (ps ?? []).forEach((p) => reporterNames.set(p.id, p.full_name)); }
    (reports ?? []).forEach((r) => { if (!latestReporter.has(r.issue_id)) latestReporter.set(r.issue_id, reporterNames.get(r.reporter_id) ?? ""); });
  }
  return rows.map((row) => ({ id: row.id, sku: row.sku, product_name: row.product_name_snapshot, status: row.status, report_count: row.report_count, reported_at: row.first_reported_at, updated_at: row.updated_at, resolved_at: row.resolved_at, claimed_at: row.claimed_at, assigned_name: row.claimed_by ? names.get(row.claimed_by) ?? "" : "", latest_reporter_name: latestReporter.get(row.id) ?? "", latest_message: "" }));
}

async function bootstrapAdmin(req: Request, body: Record<string, unknown>) {
  const expected = Deno.env.get("BOOTSTRAP_SECRET") ?? ""; if (!expected || req.headers.get("x-bootstrap-secret") !== expected) throw new HttpError(403, "Bootstrap secret không đúng");
  const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }); if ((count ?? 0) > 0) throw new HttpError(409, "Hệ thống đã có tài khoản; bootstrap bị khóa");
  const code = required(body.employee_code, "Mã nhân viên"); const password = required(body.password, "Mật khẩu"); if (password.length < 10) throw new HttpError(400, "Mật khẩu Admin cần ít nhất 10 ký tự");
  const { data, error } = await admin.auth.admin.createUser({ email: employeeEmail(code), password, email_confirm: true }); if (error || !data.user) throw error ?? new Error("Không tạo được Admin");
  const { error: insertError } = await admin.from("profiles").insert({ id: data.user.id, employee_code: code, full_name: required(body.full_name, "Họ tên"), contractor: String(body.contractor ?? ""), role: "ADMIN", active: true }); if (insertError) throw insertError;
  return { created: true, employee_code: code };
}

async function importUsers(items: Record<string, unknown>[]) {
  let created = 0; let updated = 0; const errors: string[] = []; const allowedRoles = new Set(["ADMIN_INVENT", "INVENT", "PICKER"]);
  for (const [index, item] of items.entries()) {
    try {
      const code = required(item.employee_code, "Mã nhân viên").trim(); const role = String(item.role ?? "").trim().toUpperCase(); if (!allowedRoles.has(role)) throw new Error("Quyền chỉ được là ADMIN_INVENT, INVENT hoặc PICKER");
      const { data: existing } = await admin.from("profiles").select("id,role").ilike("employee_code", code).maybeSingle(); if (existing?.role === "ADMIN") throw new Error("Tài khoản ADMIN duy nhất được bảo vệ và không thể sửa bằng import");
      const profile = { employee_code: code, full_name: required(item.full_name, "Họ tên"), contractor: String(item.contractor ?? ""), role, active: Boolean(item.active), updated_at: new Date().toISOString() };
      if (existing) { const { error } = await admin.from("profiles").update(profile).eq("id", existing.id); if (error) throw error; updated++; }
      else { const password = required(item.initial_password, "Mật khẩu khởi tạo"); if (password.length < 8) throw new Error("Mật khẩu mới cần ít nhất 8 ký tự"); const { data, error } = await admin.auth.admin.createUser({ email: employeeEmail(code), password, email_confirm: true }); if (error || !data.user) throw error ?? new Error("Không tạo được tài khoản"); const { error: insertError } = await admin.from("profiles").insert({ id: data.user.id, ...profile }); if (insertError) throw insertError; created++; }
      await admin.from("sheet_export_queue").insert({ event_type: "USER_UPSERT", payload: profile });
    } catch (error) { errors.push(`Dòng ${index + 1}: ${errorText(error)}`); }
  }
  return { created, updated, failed: errors.length, errors: errors.slice(0, 30) };
}

async function listUsers(context: Context) {
  requireRole(context, ["ADMIN", "ADMIN_INVENT"]);
  const { data, error, count } = await admin.from("profiles").select("id,employee_code,full_name,contractor,role,active", { count: "exact" }).order("employee_code").limit(2000);
  if (error) throw error;
  if ((count ?? 0) > 2000) throw new HttpError(409, "Số nhân sự vượt giới hạn 2000 tài khoản");
  return { users: data ?? [], count: count ?? 0 };
}

async function updateManagedUser(context: Context, body: Record<string, unknown>) {
  requireRole(context, ["ADMIN", "ADMIN_INVENT"]);
  const targetId = required(body.id, "User ID");
  const { data: target, error: targetError } = await admin.from("profiles").select("id,employee_code,full_name,contractor,role,active").eq("id", targetId).single();
  if (targetError || !target) throw new HttpError(404, "Không tìm thấy tài khoản");
  if (context.effectiveRole === "ADMIN_INVENT" && !["INVENT", "PICKER"].includes(target.role)) throw new HttpError(403, "Admin Invent chỉ được sửa tài khoản Báo hàng Invent hoặc Người lấy hàng");

  const employeeCode = required(body.employee_code, "Mã nhân viên");
  const fullName = required(body.full_name, "Họ tên");
  const contractor = String(body.contractor ?? "").trim();
  const role = String(body.role ?? target.role).trim().toUpperCase() as Role;
  const active = typeof body.active === "boolean" ? body.active : Boolean(target.active);
  const newPassword = String(body.new_password ?? "");
  if (!["ADMIN", "ADMIN_INVENT", "INVENT", "PICKER"].includes(role)) throw new HttpError(400, "Quyền không hợp lệ");
  if (newPassword && newPassword.length < 8) throw new HttpError(400, "Mật khẩu mới cần ít nhất 8 ký tự");

  if (target.role === "ADMIN") {
    if (context.effectiveRole !== "ADMIN") throw new HttpError(403, "Tài khoản ADMIN được bảo vệ");
    if (role !== "ADMIN" || !active) throw new HttpError(409, "ADMIN_PROTECTED");
  } else {
    if (role === "ADMIN") throw new HttpError(409, "ADMIN_ALREADY_EXISTS");
    if (context.effectiveRole === "ADMIN_INVENT" && !["INVENT", "PICKER"].includes(role)) throw new HttpError(403, "Admin Invent không được cấp quyền cao hơn quyền của mình");
  }

  if (employeeCode.toLowerCase() !== String(target.employee_code).toLowerCase()) {
    const { data: duplicate, error: duplicateError } = await admin.from("profiles").select("id").ilike("employee_code", employeeCode).neq("id", targetId).maybeSingle();
    if (duplicateError) throw duplicateError;
    if (duplicate) throw new HttpError(409, "Mã nhân viên đã tồn tại");
  }

  const values = { employee_code: employeeCode, full_name: fullName, contractor, role, active, updated_at: new Date().toISOString() };
  const { data: updated, error: updateError } = await admin.from("profiles").update(values).eq("id", targetId).select("id,employee_code,full_name,contractor,role,active").single();
  if (updateError || !updated) throw updateError ?? new Error("Không cập nhật được hồ sơ");

  const authValues: { email?: string; password?: string } = {};
  if (employeeCode.toLowerCase() !== String(target.employee_code).toLowerCase()) authValues.email = employeeEmail(employeeCode);
  if (newPassword) authValues.password = newPassword;
  if (Object.keys(authValues).length) {
    const { error: authError } = await admin.auth.admin.updateUserById(targetId, authValues);
    if (authError) {
      await admin.from("profiles").update({ employee_code: target.employee_code, full_name: target.full_name, contractor: target.contractor, role: target.role, active: target.active, updated_at: new Date().toISOString() }).eq("id", targetId);
      throw authError;
    }
  }
  const { error: queueError } = await admin.from("sheet_export_queue").insert({ event_type: "USER_UPSERT", payload: values });
  if (queueError) console.warn("USER_UPSERT queue deferred", errorText(queueError));
  return { profile: updated };
}

async function syncSheet() {
  const url = Deno.env.get("GOOGLE_SHEET_WEBHOOK_URL") ?? ""; const secret = Deno.env.get("GOOGLE_SHEET_WEBHOOK_SECRET") ?? ""; if (!url || !secret) throw new HttpError(503, "Chưa cấu hình Google Sheet webhook");
  const { data: events, error } = await admin.from("sheet_export_queue").select("*").is("exported_at", null).order("id").limit(500); if (error) throw error; if (!events?.length) return { exported: 0, remaining: 0 };
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ secret, events }) }); const responseText = await response.text(); if (!response.ok) throw new Error(`Google Sheet ${response.status}: ${responseText}`);
  const sheetResult = JSON.parse(responseText) as { ok?: boolean; error?: string }; if (sheetResult.ok !== true) throw new Error(`Google Sheet từ chối đồng bộ: ${sheetResult.error ?? "Không rõ lỗi"}`);
  const ids = events.map((event) => event.id); await admin.from("sheet_export_queue").update({ exported_at: new Date().toISOString() }).in("id", ids); const { count } = await admin.from("sheet_export_queue").select("id", { count: "exact", head: true }).is("exported_at", null); return { exported: ids.length, remaining: count ?? 0 };
}

async function resendPendingCritical() {
  const { data: cfg, error: cfgError } = await admin.from("app_config").select("picker_ack_reminder_minutes").eq("singleton", true).single(); if (cfgError) throw cfgError;
  const reminderMinutes = Math.max(1, Number(cfg?.picker_ack_reminder_minutes ?? 3)); const cutoff = new Date(Date.now() - reminderMinutes * 60_000).toISOString(); const recent = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const { data: events, error } = await admin.from("notification_events").select("id,issue_id,target_user_id,status,message,sent_at,send_count").eq("critical", true).is("acknowledged_at", null).gte("created_at", recent).or(`sent_at.is.null,sent_at.lt.${cutoff}`).limit(200); if (error) throw error;
  for (const event of events ?? []) {
    const issue = (await issueRows([event.issue_id]))[0]; if (!issue || issue.status !== event.status) { await admin.from("notification_events").update({ acknowledged_at: new Date().toISOString() }).eq("id", event.id); continue; }
    const { data: devices } = await admin.from("device_tokens").select("fcm_token").eq("user_id", event.target_user_id).eq("active", true);
    const payload = { event_id: event.id, issue_id: String(issue.id), sku: String(issue.sku), product_name: String(issue.product_name ?? ""), status: String(event.status), message: String(event.message), critical: "true" };
    await Promise.allSettled((devices ?? []).map((device) => sendFcm(device.fcm_token, payload))); await admin.from("notification_events").update({ sent_at: new Date().toISOString(), send_count: Number(event.send_count ?? 0) + 1 }).eq("id", event.id);
  }
}

async function slaTick(req: Request) {
  const expected = Deno.env.get("CRON_SECRET") ?? ""; if (!expected || req.headers.get("x-cron-secret") !== expected) throw new HttpError(403, "Cron secret không đúng");
  const { data: events, error } = await admin.rpc("process_sla"); if (error) throw error;
  for (const event of events ?? []) { const issue = (await issueRows([event.issue_id]))[0]; if (!issue) continue; await notifyUsers(await inventUserIds(), issue, issue.status, `SKU ${issue.sku} đã quá thời gian xử lý; cần phản hồi ngay.`); }
  await resendPendingCritical(); try { await syncSheet(); } catch (error) { console.warn("Sheet sync deferred", errorText(error)); }
  return { processed: events?.length ?? 0, critical_reminder_checked: true };
}

async function cleanupDiagnosticLogs() {
  const { data: cfg } = await admin.from("app_config").select("diagnostic_log_retention_days").eq("singleton", true).single(); const days = Math.max(1, Number(cfg?.diagnostic_log_retention_days ?? 14)); const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data: logs, error } = await admin.from("diagnostic_logs").select("id,object_path").lt("created_at", cutoff).limit(1000); if (error) throw error; const paths = (logs ?? []).map((row) => row.object_path);
  if (paths.length) { const { error: removeError } = await admin.storage.from(LOG_BUCKET).remove(paths); if (removeError) throw removeError; await admin.from("diagnostic_logs").delete().in("id", (logs ?? []).map((row) => row.id)); }
  return paths.length;
}
async function cleanup(req: Request) { const expected = Deno.env.get("CRON_SECRET") ?? ""; if (!expected || req.headers.get("x-cron-secret") !== expected) throw new HttpError(403, "Cron secret không đúng"); const deletedLogs = await cleanupDiagnosticLogs(); const { data, error } = await admin.rpc("purge_old_data"); if (error) throw error; return { deleted_issues: data ?? 0, deleted_logs: deletedLogs }; }
async function configureSchedule(req: Request) { const expected = Deno.env.get("CRON_SECRET") ?? ""; if (!expected || req.headers.get("x-cron-secret") !== expected) throw new HttpError(403, "Cron secret không đúng"); const { data, error } = await admin.rpc("configure_automation", { p_project_url: SUPABASE_URL, p_cron_secret: expected }); if (error) throw error; return { configured: Boolean(data), interval_minutes: 1 }; }

async function uploadDiagnosticLog(context: Context, body: Record<string, unknown>) {
  const encoded = required(body.gzip_base64, "Dữ liệu log"); let bytes: Uint8Array;
  try { const binary = atob(encoded); bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0)); } catch { throw new HttpError(400, "Dữ liệu log base64 không hợp lệ"); }
  if (bytes.length < 1 || bytes.length > MAX_LOG_BYTES) throw new HttpError(413, "Log sau nén phải từ 1 byte đến 2 MB");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)); const actualSha = [...digest].map((b) => b.toString(16).padStart(2, "0")).join(""); const expectedSha = required(body.sha256, "SHA-256").toLowerCase(); if (actualSha !== expectedSha) throw new HttpError(400, "SHA-256 của log không khớp");
  const date = new Date().toISOString().slice(0, 10); const path = `${context.userId}/${date}/${crypto.randomUUID()}.log.gz`;
  const { error: uploadError } = await admin.storage.from(LOG_BUCKET).upload(path, bytes, { contentType: "application/gzip", upsert: false }); if (uploadError) throw uploadError;
  const row = { user_id: context.userId, employee_code: context.profile.employee_code, role: context.profile.role, device_name: String(body.device_name ?? "").slice(0, 200), app_version: String(body.app_version ?? "").slice(0, 80), object_path: path, compressed_bytes: bytes.length, sha256: actualSha, client_created_at: body.client_created_at ? String(body.client_created_at) : null };
  const { data, error } = await admin.from("diagnostic_logs").insert(row).select("id,created_at").single(); if (error) { await admin.storage.from(LOG_BUCKET).remove([path]); throw error; }
  return { uploaded: true, id: data.id, bytes: bytes.length, sha256: actualSha, created_at: data.created_at };
}
async function listDiagnosticLogs(context: Context, body: Record<string, unknown>) {
  requireRole(context, ["ADMIN", "ADMIN_INVENT"]); const limit = Math.min(500, Math.max(1, Number(body.limit ?? 200)));
  let query = admin.from("diagnostic_logs").select("id,employee_code,role,device_name,app_version,compressed_bytes,sha256,client_created_at,created_at,download_count,last_downloaded_at").order("created_at", { ascending: false }).limit(limit);
  const employee = String(body.employee_code ?? "").trim(); if (employee) query = query.ilike("employee_code", `%${employee.replace(/[%_]/g, "")}%`);
  const { data, error } = await query; if (error) throw error; return { logs: data ?? [] };
}
async function diagnosticLogDownload(context: Context, body: Record<string, unknown>) {
  requireRole(context, ["ADMIN", "ADMIN_INVENT"]); const id = required(body.id, "Log ID"); const { data: row, error } = await admin.from("diagnostic_logs").select("id,object_path,download_count").eq("id", id).single(); if (error || !row) throw new HttpError(404, "Không tìm thấy log");
  const { data: signed, error: signedError } = await admin.storage.from(LOG_BUCKET).createSignedUrl(row.object_path, 120, { download: true }); if (signedError) throw signedError;
  await admin.from("diagnostic_logs").update({ download_count: Number(row.download_count ?? 0) + 1, last_downloaded_at: new Date().toISOString(), last_downloaded_by: context.userId }).eq("id", id); return { url: signed.signedUrl, expires_in: 120 };
}

async function route(req: Request) {
  const action = new URL(req.url).pathname.split("/").filter(Boolean).pop() ?? ""; const body = req.method === "POST" ? await req.json().catch(() => ({})) as Record<string, unknown> : {};
  if (action === "bootstrap-admin") return bootstrapAdmin(req, body); if (action === "sla-tick") return slaTick(req); if (action === "cleanup") return cleanup(req); if (action === "configure-schedule") return configureSchedule(req);
  const context = await authenticated(req);
  switch (action) {
    case "session-profile": return { profile: context.profile, effective_role: context.effectiveRole };
    case "search-skus": {
      const q = normalizeSearch(required(body.query, "Từ khóa")); const tokens = q.split(" ").filter(Boolean).slice(0, 6); let query = admin.from("sku_catalog").select("sku,product_name").limit(Math.min(50, Math.max(1, Number(body.limit ?? 20))));
      for (const token of tokens) query = query.ilike("search_text", `%${token.replace(/[%_]/g, "")}%`); const { data, error } = await query.order("sku"); if (error) throw error;
      const ranked = (data ?? []).sort((a, b) => { const aa = normalizeSearch(`${a.sku} ${a.product_name}`); const bb = normalizeSearch(`${b.sku} ${b.product_name}`); const score = (v: string, sku: string) => sku.toLowerCase() === q ? 0 : sku.toLowerCase().startsWith(q) ? 1 : sku.toLowerCase().includes(q) ? 2 : v.startsWith(q) ? 3 : 4; return score(aa, a.sku) - score(bb, b.sku) || a.sku.localeCompare(b.sku); }); return { items: ranked };
    }
    case "report-shortage": {
      requireRole(context, ["PICKER", "ADMIN"]); const { data, error } = await admin.rpc("report_shortage_atomic", { p_sku: required(body.sku, "SKU"), p_reporter: context.userId, p_client_request_id: String(body.client_request_id ?? "") || null }); if (error) throw error;
      const issue = data.issue; const message = data.already_reported ? `SKU ${issue.sku} vừa có thêm lượt báo; tổng ${issue.report_count} lượt.` : `Picker ${context.profile.full_name} báo thiếu SKU ${issue.sku}.`; if (!data.duplicate_request) await notifyUsers(await inventUserIds(), issue, "OPEN", message); return data;
    }
    case "active-issues": requireRole(context, ["ADMIN", "ADMIN_INVENT", "INVENT"]); return { issues: await issueRows(undefined, ACTIVE_STATUSES) };
    case "issue-board": { requireRole(context, ["ADMIN", "ADMIN_INVENT", "INVENT"]); const [open, skipped, available] = await Promise.all([issueRows(undefined, ACTIVE_STATUSES, 250), issueRows(undefined, ["SKIP_ALLOWED"], 250), issueRows(undefined, ["AVAILABLE"], 250)]); return { open, skipped: skipped.reverse(), available: available.reverse() }; }
    case "my-issues": { const { data, error } = await admin.from("issue_reports").select("issue_id").eq("reporter_id", context.userId).order("reported_at", { ascending: false }).limit(200); if (error) throw error; const ids = [...new Set<string>((data ?? []).map((row: any) => String(row.issue_id)))]; return { issues: ids.length ? (await issueRows(ids)).reverse() : [] }; }
    case "claim-issue": { requireRole(context, ["ADMIN", "ADMIN_INVENT", "INVENT"]); const { data, error } = await admin.rpc("update_issue_atomic", { p_issue_id: required(body.issue_id, "Issue ID"), p_actor: context.userId, p_action: "CLAIM" }); if (error) throw error; return { issue: data }; }
    case "update-issue": {
      requireRole(context, ["ADMIN", "ADMIN_INVENT", "INVENT"]); const actionValue = required(body.action, "Hành động").toUpperCase(); if (!["AVAILABLE", "NOT_FOUND", "CLAIM"].includes(actionValue) && !(actionValue === "CLOSE" && context.effectiveRole === "ADMIN")) throw new HttpError(400, "Hành động không hợp lệ");
      const { data, error } = await admin.rpc("update_issue_atomic", { p_issue_id: required(body.issue_id, "Issue ID"), p_actor: context.userId, p_action: actionValue }); if (error) throw error;
      if (["AVAILABLE", "SKIP_ALLOWED"].includes(data.status)) await admin.from("notification_events").update({ acknowledged_at: new Date().toISOString() }).eq("issue_id", data.id).eq("critical", true).is("acknowledged_at", null);
      const critical = ["AVAILABLE", "SKIP_ALLOWED"].includes(data.status); const messages: Record<string, string> = { AVAILABLE: `SKU ${data.sku} đã có hàng/châm bù. Vui lòng quay lại vị trí lấy hàng.`, SKIP_ALLOWED: `Không tìm thấy SKU ${data.sku}. Bạn được phép SKIP SKU này.` }; if (critical) await notifyUsers(await reporterIds(data.id), data, data.status, messages[data.status], true); return { issue: data };
    }
    case "pending-alerts": {
      const { data, error } = await admin.from("notification_events").select("id,issue_id,status,title,message,critical,created_at,sent_at").eq("target_user_id", context.userId).eq("critical", true).is("acknowledged_at", null).order("created_at").limit(50); if (error) throw error;
      const ids = [...new Set<string>((data ?? []).map((row: any) => String(row.issue_id ?? "")).filter(Boolean))]; const issues = ids.length ? await issueRows(ids) : []; const byId = new Map<string, any>(issues.map((issue: any) => [String(issue.id), issue])); return { events: (data ?? []).filter((event) => byId.get(event.issue_id)?.status === event.status).map((event) => ({ ...event, issue: byId.get(event.issue_id) })) };
    }
    case "ack-alert": { const { data, error } = await admin.from("notification_events").update({ acknowledged_at: new Date().toISOString() }).eq("id", required(body.event_id, "Event ID")).eq("target_user_id", context.userId).select("id"); if (error) throw error; if (!data?.length) throw new HttpError(404, "Không tìm thấy cảnh báo cần xác nhận"); return { acknowledged: true }; }
    case "register-device": { const token = required(body.fcm_token, "FCM token"); const { error } = await admin.from("device_tokens").upsert({ fcm_token: token, user_id: context.userId, platform: String(body.platform ?? "android"), device_name: String(body.device_name ?? ""), app_version: String(body.app_version ?? ""), active: true, last_seen_at: new Date().toISOString() }, { onConflict: "fcm_token" }); if (error) throw error; return { registered: true }; }
    case "sync-catalog": { const limit = Math.min(1000, Math.max(1, Number(body.limit ?? 1000))); const syncUntil = String(body.sync_until ?? new Date().toISOString()); let query = admin.from("sku_catalog").select("sku,product_name,updated_at").lte("updated_at", syncUntil).order("sku").limit(limit); if (body.updated_since) query = query.gt("updated_at", String(body.updated_since)); if (body.after_sku) query = query.gt("sku", String(body.after_sku)); const { data, error } = await query; if (error) throw error; return { items: data ?? [], has_more: (data?.length ?? 0) === limit, sync_until: syncUntil }; }
    case "get-config": { requireRole(context, ["ADMIN"]); const { data, error } = await admin.from("app_config").select("*").eq("singleton", true).single(); if (error) throw error; return data; }
    case "save-config": {
      requireRole(context, ["ADMIN"]); const values = { acknowledge_minutes: Number(body.acknowledge_minutes), reminder_minutes: Number(body.reminder_minutes), replenish_minutes: Number(body.replenish_minutes), picker_ack_reminder_minutes: Number(body.picker_ack_reminder_minutes ?? 3), diagnostic_log_retention_days: Number(body.diagnostic_log_retention_days ?? 14), updated_by: context.userId, updated_at: new Date().toISOString() };
      if ([values.acknowledge_minutes, values.reminder_minutes, values.replenish_minutes].some((v) => !Number.isInteger(v) || v < 1 || v > 480)) throw new HttpError(400, "Cấu hình SLA phải từ 1 đến 480 phút"); if (!Number.isInteger(values.picker_ack_reminder_minutes) || values.picker_ack_reminder_minutes < 1 || values.picker_ack_reminder_minutes > 60) throw new HttpError(400, "Nhắc Picker phải từ 1 đến 60 phút"); if (!Number.isInteger(values.diagnostic_log_retention_days) || values.diagnostic_log_retention_days < 1 || values.diagnostic_log_retention_days > 60) throw new HttpError(400, "Lưu log phải từ 1 đến 60 ngày"); const { data, error } = await admin.from("app_config").update(values).eq("singleton", true).select().single(); if (error) throw error; return data;
    }
    case "list-users": return listUsers(context);
    case "update-user": return updateManagedUser(context, body);
    case "import-skus": { requireRole(context, ["ADMIN", "ADMIN_INVENT"]); const items = Array.isArray(body.items) ? body.items as Record<string, unknown>[] : []; if (!items.length || items.length > 1000) throw new HttpError(400, "Mỗi lô cần 1–1000 SKU"); const now = new Date().toISOString(); const rows = items.map((item) => ({ sku: required(item.sku, "SKU").trim(), product_name: required(item.product_name, "Tên sản phẩm").trim(), last_imported_at: now, updated_at: now })); const { error } = await admin.from("sku_catalog").upsert(rows, { onConflict: "sku" }); if (error) throw error; return { imported: rows.length }; }
    case "import-users": { requireRole(context, ["ADMIN"]); const items = Array.isArray(body.items) ? body.items as Record<string, unknown>[] : []; if (!items.length || items.length > 200) throw new HttpError(400, "Mỗi lô cần 1–200 nhân sự"); return importUsers(items); }
    case "sync-google-sheet": requireRole(context, ["ADMIN", "ADMIN_INVENT"]); return syncSheet();
    case "reports-summary": {
      requireRole(context, ["ADMIN", "ADMIN_INVENT"]); const since = new Date(Date.now() - 30 * 86_400_000).toISOString(); const { data, error } = await admin.from("issues").select("sku,status,report_count,first_reported_at,resolved_at").gte("first_reported_at", since).limit(5000); if (error) throw error; const rows = data ?? []; const byStatus: Record<string, number> = {}; const skuCounts = new Map<string, number>(); const durations: number[] = [];
      rows.forEach((row) => { byStatus[row.status] = (byStatus[row.status] ?? 0) + 1; skuCounts.set(row.sku, (skuCounts.get(row.sku) ?? 0) + Number(row.report_count ?? 1)); if (row.resolved_at) durations.push((new Date(row.resolved_at).getTime() - new Date(row.first_reported_at).getTime()) / 60000); }); const top_skus = [...skuCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([sku, reports]) => ({ sku, reports })); return { days: 30, issues: rows.length, reports: rows.reduce((s, r) => s + Number(r.report_count ?? 1), 0), by_status: byStatus, average_resolution_minutes: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null, top_skus };
    }
    case "issue-history": { requireRole(context, ["ADMIN", "ADMIN_INVENT"]); const { data, error } = await admin.from("issues").select("id").order("created_at", { ascending: false }).limit(Math.min(500, Math.max(1, Number(body.limit ?? 200)))); if (error) throw error; const ids = (data ?? []).map((row: any) => String(row.id)); return { issues: ids.length ? (await issueRows(ids)).reverse() : [] }; }
    case "audit-history": { requireRole(context, ["ADMIN", "ADMIN_INVENT"]); const { data, error } = await admin.from("issue_audit").select("id,issue_id,actor_id,action,from_status,to_status,detail,created_at").order("created_at", { ascending: false }).limit(Math.min(1000, Math.max(1, Number(body.limit ?? 300)))); if (error) throw error; return { audit: data ?? [] }; }
    case "upload-log": return uploadDiagnosticLog(context, body);
    case "list-logs": return listDiagnosticLogs(context, body);
    case "download-log": return diagnosticLogDownload(context, body);
    default: throw new HttpError(404, "Không tìm thấy chức năng");
  }
}

Deno.serve(async (req) => {
  try { if (req.method !== "POST") throw new HttpError(405, "Chỉ hỗ trợ POST"); return json(await route(req)); }
  catch (error) {
    console.error(error); const status = error instanceof HttpError ? error.status : 500; const raw = errorText(error);
    const messages: Record<string, string> = { SKU_NOT_FOUND: "SKU không có trong danh mục đã đồng bộ", ALREADY_CLAIMED: "SKU đã có Invent khác nhận xử lý", ISSUE_OWNED_BY_ANOTHER_USER: "SKU đang do Invent khác xử lý", ISSUE_ALREADY_RESOLVED: "SKU này đã được xử lý xong", INVALID_TRANSITION: "Không thể chuyển trạng thái SKU theo thao tác này", INVALID_ACTION: "Thao tác cập nhật không hợp lệ", ADMIN_PROTECTED: "Tài khoản ADMIN duy nhất được hệ thống bảo vệ", ADMIN_ALREADY_EXISTS: "Hệ thống chỉ cho phép duy nhất một ADMIN" };
    const friendly = Object.entries(messages).find(([key]) => raw.includes(key))?.[1] ?? raw; return json({ error: friendly }, status);
  }
});
