import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { sendFcm } from "../_shared/fcm.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const LOG_BUCKET = "diagnostic-logs";
const MAX_LOG_BYTES = 2 * 1024 * 1024;
const ACTIVE_STATUSES = ["OPEN", "CLAIMED", "SEARCHING", "REPLENISHING"];
const SITE_ID = "1291";

type Role = "ADMIN" | "ADMIN_INVENT" | "INVENT" | "PICKER";
type Profile = { id: string; employee_code: string; full_name: string; contractor: string; role: Role; active: boolean };
type Context = { userId: string; profile: Profile; effectiveRole: Role; client: SupabaseClient };

class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
});
function required(value: unknown, label: string): string {
  const result = String(value ?? "").trim();
  if (!result) throw new HttpError(400, `${label} không được để trống`);
  return result;
}
function employeeEmail(code: string): string {
  const raw = code.trim().toLowerCase();
  const safe = raw.replace(/[^a-z0-9._-]/g, "-");
  if (!safe || safe !== raw) throw new HttpError(400, "Mã nhân viên chỉ được dùng chữ, số, dấu chấm, gạch ngang hoặc gạch dưới");
  return `${safe}@bao-hang-1291.local`;
}
function normalizeSearch(value: string): string {
  return value.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/đ/g, "d").replace(/\s+/g, " ").trim();
}
function safeTestRole(raw: string | null): Role | null {
  const role = String(raw ?? "").trim().toUpperCase();
  return (["ADMIN_INVENT", "INVENT", "PICKER"] as string[]).includes(role) ? role as Role : null;
}
function requireRole(context: Context, roles: Role[]) {
  if (!roles.includes(context.effectiveRole)) throw new HttpError(403, "Bạn không có quyền thực hiện thao tác này");
}
function numberValue(value: unknown, label: string, min = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min) throw new HttpError(400, `${label} không hợp lệ`);
  return parsed;
}
function b64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function fromB64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
async function sha256(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function authenticated(req: Request): Promise<Context> {
  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) throw new HttpError(401, "Phiên đăng nhập không hợp lệ");
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } }, auth: { persistSession: false },
  });
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

async function inventUserIds(): Promise<string[]> {
  const { data, error } = await admin.from("profiles").select("id").in("role", ["ADMIN", "ADMIN_INVENT", "INVENT"]).eq("active", true);
  if (error) throw error;
  return (data ?? []).map((row: any) => String(row.id));
}
async function reporterIds(issueId: string): Promise<string[]> {
  const { data, error } = await admin.from("issue_reports").select("reporter_id").eq("issue_id", issueId);
  if (error) throw error;
  return [...new Set<string>((data ?? []).map((row: any) => String(row.reporter_id)))];
}

async function notifyUsers(userIds: string[], issue: Record<string, unknown>, status: string, message: string, critical = false) {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (!unique.length) return;
  const issueVersion = Math.max(1, Number(issue.issue_version ?? 1));
  const titleMap: Record<string, string> = {
    OPEN: `Báo thiếu • SKU ${issue.sku}`,
    CLAIMED: `Đã nhận xử lý • SKU ${issue.sku}`,
    AVAILABLE: `Đã có hàng • SKU ${issue.sku}`,
    SKIP_ALLOWED: `Được phép SKIP • SKU ${issue.sku}`,
    REASSIGNED: `Điều phối xử lý • SKU ${issue.sku}`,
  };
  const rows = unique.map((userId) => ({
    issue_id: issue.id, target_user_id: userId, status,
    issue_version: issueVersion,
    title: titleMap[status] ?? `${status} • SKU ${issue.sku}`,
    message, critical,
  }));
  const { data: events, error } = await admin.from("notification_events").insert(rows).select("id,target_user_id");
  if (error) throw error;
  const { data: devices, error: deviceError } = await admin.from("device_tokens")
    .select("user_id,fcm_token").in("user_id", unique).eq("active", true);
  if (deviceError) throw deviceError;
  const tokens = new Map<string, { token: string }[]>();
  (devices ?? []).forEach((device) => {
    const list = tokens.get(device.user_id) ?? [];
    list.push({ token: device.fcm_token });
    tokens.set(device.user_id, list);
  });
  const acceptedEventIds: string[] = [];
  const invalidTokens = new Set<string>();
  await Promise.all((events ?? []).map(async (event) => {
    const payload = {
      event_id: event.id,
      issue_id: String(issue.id),
      issue_version: String(issueVersion),
      sku: String(issue.sku),
      product_name: String(issue.product_name ?? ""),
      status,
      message,
      critical: String(critical),
    };
    let accepted = false;
    const targets = tokens.get(event.target_user_id) ?? [];
    await Promise.all(targets.map(async ({ token }) => {
      try {
        const result = await sendFcm(token, payload, {
          ttlSeconds: critical ? 3600 : 1800,
          collapseKey: `issue-${issue.id}-${critical ? "picker" : "invent"}`,
          priority: critical || status === "OPEN" ? "high" : "normal",
        });
        accepted ||= result.accepted;
        if (result.invalidToken) invalidTokens.add(token);
      } catch (error) {
        console.warn("FCM send deferred", errorText(error));
      }
    }));
    if (accepted) acceptedEventIds.push(event.id);
  }));
  if (acceptedEventIds.length) {
    const now = new Date().toISOString();
    await admin.from("notification_events").update({ sent_at: now, fcm_accepted_at: now, send_count: 1 }).in("id", acceptedEventIds);
  }
  if (invalidTokens.size) await admin.from("device_tokens").update({ active: false }).in("fcm_token", [...invalidTokens]);
}

async function issueRows(ids?: string[], statuses?: string[], limit = 250) {
  let query = admin.from("issues").select("*").order("first_reported_at", { ascending: true }).limit(limit);
  if (ids?.length) query = query.in("id", ids);
  if (statuses?.length) query = query.in("status", statuses);
  const { data, error } = await query;
  if (error) throw error;
  const rows = data ?? [];
  const assigneeIds = [...new Set(rows.map((row) => row.claimed_by).filter(Boolean))];
  const names = new Map<string, string>();
  if (assigneeIds.length) {
    const { data: profiles } = await admin.from("profiles").select("id,full_name").in("id", assigneeIds);
    (profiles ?? []).forEach((profile) => names.set(profile.id, profile.full_name));
  }
  const issueIds = rows.map((row) => row.id);
  const latestReporter = new Map<string, string>();
  if (issueIds.length) {
    const { data: reports } = await admin.from("issue_reports").select("issue_id,reporter_id,reported_at")
      .in("issue_id", issueIds).order("reported_at", { ascending: false }).limit(2000);
    const reporterProfileIds = [...new Set((reports ?? []).map((row) => row.reporter_id))];
    const reporterNames = new Map<string, string>();
    if (reporterProfileIds.length) {
      const { data: ps } = await admin.from("profiles").select("id,full_name").in("id", reporterProfileIds);
      (ps ?? []).forEach((p) => reporterNames.set(p.id, p.full_name));
    }
    (reports ?? []).forEach((r) => {
      if (!latestReporter.has(r.issue_id)) latestReporter.set(r.issue_id, reporterNames.get(r.reporter_id) ?? "");
    });
  }
  const previousIds = [...new Set(rows.map((row) => row.previous_issue_id).filter(Boolean))];
  const previousResolved = new Map<string, string>();
  if (previousIds.length) {
    const { data: prev } = await admin.from("issues").select("id,resolved_at").in("id", previousIds);
    (prev ?? []).forEach((row) => previousResolved.set(row.id, row.resolved_at ?? ""));
  }
  return rows.map((row) => ({
    id: row.id,
    sku: row.sku,
    product_name: row.product_name_snapshot,
    status: row.status,
    report_count: row.report_count,
    reported_at: row.first_reported_at,
    updated_at: row.updated_at,
    resolved_at: row.resolved_at,
    claimed_at: row.claimed_at,
    issue_version: Number(row.issue_version ?? 1),
    previous_issue_id: row.previous_issue_id,
    recurrence_30m: Boolean(row.previous_issue_id && previousResolved.get(row.previous_issue_id) &&
      new Date(row.first_reported_at).getTime() <= new Date(previousResolved.get(row.previous_issue_id)!).getTime() + 30 * 60_000),
    assigned_name: row.claimed_by ? names.get(row.claimed_by) ?? "" : "",
    assigned_id: row.claimed_by ?? null,
    latest_reporter_name: latestReporter.get(row.id) ?? "",
    latest_message: "",
  }));
}

async function bootstrapAdmin(req: Request, body: Record<string, unknown>) {
  const expected = Deno.env.get("BOOTSTRAP_SECRET") ?? "";
  if (!expected || req.headers.get("x-bootstrap-secret") !== expected) throw new HttpError(403, "Bootstrap secret không đúng");
  const { count } = await admin.from("profiles").select("id", { count: "exact", head: true });
  if ((count ?? 0) > 0) throw new HttpError(409, "Hệ thống đã có tài khoản; bootstrap bị khóa");
  const code = required(body.employee_code, "Mã nhân viên");
  const password = required(body.password, "Mật khẩu");
  if (password.length < 10) throw new HttpError(400, "Mật khẩu Admin cần ít nhất 10 ký tự");
  const { data, error } = await admin.auth.admin.createUser({ email: employeeEmail(code), password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("Không tạo được Admin");
  const profile = {
    id: data.user.id, employee_code: code, full_name: required(body.full_name, "Họ tên"),
    contractor: String(body.contractor ?? ""), role: "ADMIN", active: true,
  };
  const { error: insertError } = await admin.from("profiles").insert(profile);
  if (insertError) throw insertError;
  await admin.from("sheet_export_queue").insert({ event_type: "USER_UPSERT", payload: { ...profile, updated_at: new Date().toISOString() } });
  return { created: true, employee_code: code };
}

async function importUsers(context: Context, items: Record<string, unknown>[]) {
  requireRole(context, ["ADMIN", "ADMIN_INVENT"]);
  let created = 0;
  let updated = 0;
  const errors: string[] = [];
  for (const [index, item] of items.entries()) {
    try {
      const code = required(item.employee_code, "Mã nhân viên").trim();
      const role = String(item.role ?? "").trim().toUpperCase() as Role;
      const allowedRoles = context.effectiveRole === "ADMIN" ? new Set(["ADMIN_INVENT", "INVENT", "PICKER"]) : new Set(["INVENT", "PICKER"]);
      if (!allowedRoles.has(role)) throw new Error(context.effectiveRole === "ADMIN" ? "Quyền chỉ được là ADMIN_INVENT, INVENT hoặc PICKER" : "Admin Event chỉ được quản lý Người báo hàng hoặc Picker");
      const { data: existing } = await admin.from("profiles").select("id,role").ilike("employee_code", code).maybeSingle();
      if (existing?.role === "ADMIN") throw new Error("Tài khoản ADMIN duy nhất được bảo vệ");
      if (context.effectiveRole === "ADMIN_INVENT" && existing && !["INVENT", "PICKER"].includes(existing.role)) throw new Error("Admin Event không được sửa tài khoản quyền cao");
      const profile = {
        employee_code: code,
        full_name: required(item.full_name, "Họ tên"),
        contractor: String(item.contractor ?? ""),
        role,
        active: Boolean(item.active),
        updated_at: new Date().toISOString(),
      };
      if (existing) {
        const { error } = await admin.from("profiles").update(profile).eq("id", existing.id);
        if (error) throw error;
        updated++;
      } else {
        const password = required(item.initial_password, "Mật khẩu khởi tạo");
        if (password.length < 8) throw new Error("Mật khẩu mới cần ít nhất 8 ký tự");
        const { data, error } = await admin.auth.admin.createUser({ email: employeeEmail(code), password, email_confirm: true });
        if (error || !data.user) throw error ?? new Error("Không tạo được tài khoản");
        const { error: insertError } = await admin.from("profiles").insert({ id: data.user.id, ...profile });
        if (insertError) throw insertError;
        created++;
      }
      await admin.from("sheet_export_queue").insert({ event_type: "USER_UPSERT", payload: profile });
    } catch (error) {
      errors.push(`Dòng ${index + 1}: ${errorText(error)}`);
    }
  }
  return { created, updated, failed: errors.length, errors: errors.slice(0, 30) };
}

async function listUsers(context: Context) {
  requireRole(context, ["ADMIN", "ADMIN_INVENT"]);
  let query = admin.from("profiles").select("id,employee_code,full_name,contractor,role,active", { count: "exact" }).order("employee_code").limit(2000);
  if (context.effectiveRole === "ADMIN_INVENT") query = query.in("role", ["INVENT", "PICKER"]);
  const { data, error, count } = await query;
  if (error) throw error;
  if ((count ?? 0) > 2000) throw new HttpError(409, "Số nhân sự vượt giới hạn 2000 tài khoản");
  return { users: data ?? [], count: count ?? 0 };
}

async function updateManagedUser(context: Context, body: Record<string, unknown>) {
  requireRole(context, ["ADMIN", "ADMIN_INVENT"]);
  const targetId = required(body.id, "User ID");
  const { data: target, error: targetError } = await admin.from("profiles")
    .select("id,employee_code,full_name,contractor,role,active").eq("id", targetId).single();
  if (targetError || !target) throw new HttpError(404, "Không tìm thấy tài khoản");
  if (context.effectiveRole === "ADMIN_INVENT" && !["INVENT", "PICKER"].includes(target.role)) throw new HttpError(403, "Admin Event chỉ được sửa Người báo hàng hoặc Picker");
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
    if (context.effectiveRole === "ADMIN_INVENT" && !["INVENT", "PICKER"].includes(role)) throw new HttpError(403, "Admin Event không được cấp quyền cao hơn quyền của mình");
  }
  if (employeeCode.toLowerCase() !== String(target.employee_code).toLowerCase()) {
    const { data: duplicate, error: duplicateError } = await admin.from("profiles").select("id")
      .ilike("employee_code", employeeCode).neq("id", targetId).maybeSingle();
    if (duplicateError) throw duplicateError;
    if (duplicate) throw new HttpError(409, "Mã nhân viên đã tồn tại");
  }
  const values = { employee_code: employeeCode, full_name: fullName, contractor, role, active, updated_at: new Date().toISOString() };
  const { data: updated, error: updateError } = await admin.from("profiles").update(values).eq("id", targetId)
    .select("id,employee_code,full_name,contractor,role,active").single();
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
  await admin.from("sheet_export_queue").insert({ event_type: "USER_UPSERT", payload: values });
  return { profile: updated };
}

async function syncSheet() {
  const url = Deno.env.get("GOOGLE_SHEET_WEBHOOK_URL") ?? "";
  const secret = Deno.env.get("GOOGLE_SHEET_WEBHOOK_SECRET") ?? "";
  if (!url || !secret) throw new HttpError(503, "Chưa cấu hình Google Sheet webhook");
  const { data: events, error } = await admin.from("sheet_export_queue").select("*").is("exported_at", null).order("id").limit(500);
  if (error) throw error;
  if (!events?.length) return { exported: 0, remaining: 0 };
  const response = await fetch(url, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ secret, events }),
  });
  const responseText = await response.text();
  if (!response.ok) throw new Error(`Google Sheet ${response.status}: ${responseText}`);
  const sheetResult = JSON.parse(responseText) as { ok?: boolean; error?: string };
  if (sheetResult.ok !== true) throw new Error(`Google Sheet từ chối đồng bộ: ${sheetResult.error ?? "Không rõ lỗi"}`);
  const ids = events.map((event) => event.id);
  await admin.from("sheet_export_queue").update({ exported_at: new Date().toISOString() }).in("id", ids);
  const { count } = await admin.from("sheet_export_queue").select("id", { count: "exact", head: true }).is("exported_at", null);
  return { exported: ids.length, remaining: count ?? 0 };
}

async function resendPendingCritical() {
  const { data: cfg, error: cfgError } = await admin.from("app_config").select("picker_ack_reminder_minutes").eq("singleton", true).single();
  if (cfgError) throw cfgError;
  const reminderMinutes = Math.max(1, Number(cfg?.picker_ack_reminder_minutes ?? 3));
  const cutoff = new Date(Date.now() - reminderMinutes * 60_000).toISOString();
  const recent = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const { data: events, error } = await admin.from("notification_events")
    .select("id,issue_id,issue_version,target_user_id,status,message,sent_at,send_count")
    .eq("critical", true).is("acknowledged_at", null).gte("created_at", recent)
    .or(`sent_at.is.null,sent_at.lt.${cutoff}`).limit(200);
  if (error) throw error;
  for (const event of events ?? []) {
    const issue = (await issueRows([event.issue_id]))[0];
    if (!issue || issue.status !== event.status || Number(issue.issue_version) !== Number(event.issue_version)) {
      await admin.from("notification_events").update({ acknowledged_at: new Date().toISOString() }).eq("id", event.id);
      continue;
    }
    const { data: devices } = await admin.from("device_tokens").select("fcm_token").eq("user_id", event.target_user_id).eq("active", true);
    const payload = {
      event_id: event.id, issue_id: String(issue.id), issue_version: String(issue.issue_version), sku: String(issue.sku),
      product_name: String(issue.product_name ?? ""), status: String(event.status), message: String(event.message), critical: "true",
    };
    let accepted = false;
    const invalid: string[] = [];
    for (const device of devices ?? []) {
      try {
        const result = await sendFcm(device.fcm_token, payload, { ttlSeconds: 3600, collapseKey: `issue-${issue.id}-picker`, priority: "high" });
        accepted ||= result.accepted;
        if (result.invalidToken) invalid.push(device.fcm_token);
      } catch (error) { console.warn("FCM resend deferred", errorText(error)); }
    }
    if (invalid.length) await admin.from("device_tokens").update({ active: false }).in("fcm_token", invalid);
    if (accepted) {
      const now = new Date().toISOString();
      await admin.from("notification_events").update({ sent_at: now, fcm_accepted_at: now, send_count: Number(event.send_count ?? 0) + 1 }).eq("id", event.id);
    }
  }
}

async function slaTick(req: Request) {
  const expected = Deno.env.get("CRON_SECRET") ?? "";
  if (!expected || req.headers.get("x-cron-secret") !== expected) throw new HttpError(403, "Cron secret không đúng");
  const { data: events, error } = await admin.rpc("process_sla");
  if (error) throw error;
  for (const event of events ?? []) {
    const issue = (await issueRows([event.issue_id]))[0];
    if (!issue) continue;
    await notifyUsers(await inventUserIds(), issue, issue.status, `SKU ${issue.sku} đã quá thời gian xử lý; cần phản hồi ngay.`);
  }
  await resendPendingCritical();
  try { await syncSheet(); } catch (error) { console.warn("Sheet sync deferred", errorText(error)); }
  return { processed: events?.length ?? 0, critical_reminder_checked: true };
}

async function cleanupDiagnosticLogs() {
  const { data: cfg } = await admin.from("app_config").select("diagnostic_log_retention_days").eq("singleton", true).single();
  const days = Math.max(1, Number(cfg?.diagnostic_log_retention_days ?? 14));
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data: logs, error } = await admin.from("diagnostic_logs").select("id,object_path").lt("created_at", cutoff).limit(1000);
  if (error) throw error;
  const paths = (logs ?? []).map((row) => row.object_path);
  if (paths.length) {
    const { error: removeError } = await admin.storage.from(LOG_BUCKET).remove(paths);
    if (removeError) throw removeError;
    await admin.from("diagnostic_logs").delete().in("id", (logs ?? []).map((row) => row.id));
  }
  return paths.length;
}
async function cleanup(req: Request) {
  const expected = Deno.env.get("CRON_SECRET") ?? "";
  if (!expected || req.headers.get("x-cron-secret") !== expected) throw new HttpError(403, "Cron secret không đúng");
  const deletedLogs = await cleanupDiagnosticLogs();
  const { data, error } = await admin.rpc("purge_old_data");
  if (error) throw error;
  return { deleted_issues: data ?? 0, deleted_logs: deletedLogs };
}
async function configureSchedule(req: Request) {
  const expected = Deno.env.get("CRON_SECRET") ?? "";
  if (!expected || req.headers.get("x-cron-secret") !== expected) throw new HttpError(403, "Cron secret không đúng");
  const { data, error } = await admin.rpc("configure_automation", { p_project_url: SUPABASE_URL, p_cron_secret: expected });
  if (error) throw error;
  return { configured: Boolean(data), interval_minutes: 1 };
}

async function uploadDiagnosticLog(context: Context, body: Record<string, unknown>) {
  const encoded = required(body.gzip_base64, "Dữ liệu log");
  let bytes: Uint8Array;
  try { bytes = fromB64(encoded); } catch { throw new HttpError(400, "Dữ liệu log base64 không hợp lệ"); }
  if (bytes.length < 1 || bytes.length > MAX_LOG_BYTES) throw new HttpError(413, "Log sau nén phải từ 1 byte đến 2 MB");
  const actualSha = await sha256(bytes);
  const expectedSha = required(body.sha256, "SHA-256").toLowerCase();
  if (actualSha !== expectedSha) throw new HttpError(400, "SHA-256 của log không khớp");
  const date = new Date().toISOString().slice(0, 10);
  const path = `${context.userId}/${date}/${crypto.randomUUID()}.log.gz`;
  const { error: uploadError } = await admin.storage.from(LOG_BUCKET).upload(path, bytes, { contentType: "application/gzip", upsert: false });
  if (uploadError) throw uploadError;
  const row = {
    user_id: context.userId, employee_code: context.profile.employee_code, role: context.profile.role,
    device_name: String(body.device_name ?? "").slice(0, 200), app_version: String(body.app_version ?? "").slice(0, 80),
    object_path: path, compressed_bytes: bytes.length, sha256: actualSha,
    client_created_at: body.client_created_at ? String(body.client_created_at) : null,
  };
  const { data, error } = await admin.from("diagnostic_logs").insert(row).select("id,created_at").single();
  if (error) { await admin.storage.from(LOG_BUCKET).remove([path]); throw error; }
  return { uploaded: true, id: data.id, bytes: bytes.length, sha256: actualSha, created_at: data.created_at };
}
async function listDiagnosticLogs(context: Context, body: Record<string, unknown>) {
  requireRole(context, ["ADMIN", "ADMIN_INVENT"]);
  const limit = Math.min(500, Math.max(1, Number(body.limit ?? 200)));
  let query = admin.from("diagnostic_logs").select("id,employee_code,role,device_name,app_version,compressed_bytes,sha256,client_created_at,created_at,download_count,last_downloaded_at").order("created_at", { ascending: false }).limit(limit);
  const employee = String(body.employee_code ?? "").trim();
  if (employee) query = query.ilike("employee_code", `%${employee.replace(/[%_]/g, "")}%`);
  const { data, error } = await query;
  if (error) throw error;
  return { logs: data ?? [] };
}
async function diagnosticLogDownload(context: Context, body: Record<string, unknown>) {
  requireRole(context, ["ADMIN", "ADMIN_INVENT"]);
  const id = required(body.id, "Log ID");
  const { data: row, error } = await admin.from("diagnostic_logs").select("id,object_path,download_count").eq("id", id).single();
  if (error || !row) throw new HttpError(404, "Không tìm thấy log");
  const { data: signed, error: signedError } = await admin.storage.from(LOG_BUCKET).createSignedUrl(row.object_path, 120, { download: true });
  if (signedError) throw signedError;
  await admin.from("diagnostic_logs").update({ download_count: Number(row.download_count ?? 0) + 1, last_downloaded_at: new Date().toISOString(), last_downloaded_by: context.userId }).eq("id", id);
  return { url: signed.signedUrl, expires_in: 120 };
}

async function aesKey(): Promise<CryptoKey> {
  const master = Deno.env.get("SUPRA_CREDENTIAL_MASTER_KEY") ?? "";
  if (master.length < 32) throw new HttpError(503, "SUPRA_CREDENTIAL_MASTER_KEY chưa được cấu hình an toàn");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(master));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function encryptCredential(bundle: Record<string, unknown>): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(bundle));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(), plaintext));
  return `v1:${b64(iv)}:${b64(encrypted)}`;
}
async function inventoryConnectionStatus(context: Context) {
  requireRole(context, ["ADMIN", "ADMIN_INVENT"]);
  const { data, error } = await admin.rpc("get_supra_connection_service", { p_site: SITE_ID });
  if (error) throw error;
  const c = data ?? {};
  return {
    warehouse_site_id: c.warehouse_site_id ?? SITE_ID,
    warehouse_code: c.warehouse_code ?? "",
    client_code: c.client_code ?? "",
    enabled: Boolean(c.enabled),
    status: c.status ?? "DISABLED",
    credential_version: Number(c.credential_version ?? 0),
    contract_verified: Boolean(c.source_contract?.verified === true),
    last_tested_at: c.last_tested_at ?? null,
    last_test_error: context.effectiveRole === "ADMIN" ? c.last_test_error ?? "" : "",
    updated_at: c.updated_at ?? null,
  };
}
async function updateInventoryCredential(context: Context, body: Record<string, unknown>) {
  requireRole(context, ["ADMIN"]);
  const credentials = body.credentials;
  if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) throw new HttpError(400, "Bộ credential Supra không hợp lệ");
  const allowed = ["authorization", "token", "apisid", "appid", "sid", "scid", "usid", "warehouse"];
  const clean: Record<string, string> = {};
  for (const key of allowed) {
    const value = String((credentials as Record<string, unknown>)[key] ?? "").trim();
    if (value) clean[key] = value;
  }
  for (const key of ["authorization", "token", "apisid", "sid", "scid", "usid"]) if (!clean[key]) throw new HttpError(400, `Credential Supra thiếu ${key}`);
  const cipher = await encryptCredential(clean);
  const { data, error } = await admin.rpc("set_supra_connection_service", {
    p_site: SITE_ID, p_ciphertext: cipher, p_updated_by: context.userId, p_enabled: false,
    p_status: "SOURCE_CONTRACT_UNVERIFIED", p_source_contract: { verified: false },
  });
  if (error) throw error;
  return { ...data, credential_saved: true, credential_visible: false, requires_read_only_poc: true };
}

function freshness(capturedAt: string | null, freshMinutes: number, staleMinutes: number): "UNKNOWN" | "FRESH" | "AGING" | "STALE" {
  if (!capturedAt) return "UNKNOWN";
  const age = (Date.now() - new Date(capturedAt).getTime()) / 60_000;
  if (!Number.isFinite(age)) return "UNKNOWN";
  if (age <= freshMinutes) return "FRESH";
  if (age <= staleMinutes) return "AGING";
  return "STALE";
}
async function inventoryConfig() {
  const { data, error } = await admin.from("app_config").select("inventory_fresh_minutes,inventory_stale_minutes,inventory_auto_sync_enabled,inventory_sync_interval_minutes,inventory_operating_start_hour,inventory_operating_end_hour").eq("singleton", true).single();
  if (error) throw error;
  return data;
}
async function inventoryStatus(context: Context, body: Record<string, unknown>) {
  const sku = required(body.sku, "SKU");
  const [cfg, current] = await Promise.all([
    inventoryConfig(),
    admin.from("inventory_current").select("sku,snapshot_id,snapshot_captured_at,pickable_bin_qty,pickable_pending_out_qty,pickable_available_qty,other_stock_qty").eq("warehouse_site_id", SITE_ID).eq("sku", sku).maybeSingle(),
  ]);
  if (current.error) throw current.error;
  if (!current.data) return { sku, freshness_status: "UNKNOWN", stock_status: "NO_DATA", snapshot_captured_at: null };
  const fresh = freshness(current.data.snapshot_captured_at, Number(cfg.inventory_fresh_minutes), Number(cfg.inventory_stale_minutes));
  const stockStatus = fresh === "STALE" ? "STALE" : Number(current.data.pickable_available_qty) > 0 ? "AVAILABLE" : "ZERO";
  const base: Record<string, unknown> = { sku, freshness_status: fresh, stock_status: stockStatus, snapshot_captured_at: current.data.snapshot_captured_at, snapshot_id: current.data.snapshot_id };
  if (context.effectiveRole !== "PICKER") Object.assign(base, {
    pickable_bin_qty: current.data.pickable_bin_qty,
    pickable_pending_out_qty: current.data.pickable_pending_out_qty,
    pickable_available_qty: current.data.pickable_available_qty,
    other_stock_qty: current.data.other_stock_qty,
  });
  return base;
}
async function inventoryCurrent(context: Context, body: Record<string, unknown>) {
  requireRole(context, ["ADMIN", "ADMIN_INVENT", "INVENT"]);
  const limit = Math.min(500, Math.max(1, Number(body.limit ?? 100)));
  let query = admin.from("inventory_current").select("sku,snapshot_id,snapshot_captured_at,pickable_bin_qty,pickable_pending_out_qty,pickable_available_qty,other_stock_qty")
    .eq("warehouse_site_id", SITE_ID).order("sku").limit(limit);
  const q = String(body.query ?? "").trim().replace(/[%_]/g, "");
  if (q) query = query.ilike("sku", `%${q}%`);
  const { data, error } = await query;
  if (error) throw error;
  const cfg = await inventoryConfig();
  return { items: (data ?? []).map((row) => ({ ...row, freshness_status: freshness(row.snapshot_captured_at, Number(cfg.inventory_fresh_minutes), Number(cfg.inventory_stale_minutes)) })) };
}
async function inventorySummary(context: Context) {
  requireRole(context, ["ADMIN", "ADMIN_INVENT"]);
  const [cfg, currentCount, snapshot, jobs, connection] = await Promise.all([
    inventoryConfig(),
    admin.from("inventory_current").select("sku", { count: "exact", head: true }).eq("warehouse_site_id", SITE_ID),
    admin.from("inventory_snapshots").select("id,source,source_endpoint,source_captured_at,sha256,normalized_row_count,published_at").eq("warehouse_site_id", SITE_ID).order("published_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("inventory_sync_jobs").select("id,state,requested_source,requested_at,started_at,finished_at,page_count,raw_row_count,normalized_row_count,error_code,error_message").eq("warehouse_site_id", SITE_ID).order("requested_at", { ascending: false }).limit(20),
    inventoryConnectionStatus(context),
  ]);
  for (const result of [currentCount, snapshot, jobs]) if (result.error) throw result.error;
  const snap = snapshot.data;
  return {
    current_sku_count: currentCount.count ?? 0,
    snapshot: snap ? { ...snap, freshness_status: freshness(snap.source_captured_at, Number(cfg.inventory_fresh_minutes), Number(cfg.inventory_stale_minutes)), sha256_short: String(snap.sha256).slice(0, 12) } : null,
    jobs: jobs.data ?? [],
    connection,
    config: cfg,
  };
}
async function startRecoveryInventory(context: Context, body: Record<string, unknown>) {
  requireRole(context, ["ADMIN", "ADMIN_INVENT"]);
  const requestId = required(body.client_request_id, "client_request_id");
  const { data: existing, error: existingError } = await admin.from("inventory_sync_jobs").select("*").eq("client_request_id", requestId).maybeSingle();
  if (existingError) throw existingError;
  if (existing) return { job: existing, duplicate_request: true };
  const { data: active, error: activeError } = await admin.from("inventory_sync_jobs").select("*").eq("warehouse_site_id", SITE_ID).in("state", ["QUEUED", "CONNECTING", "FETCHING", "VALIDATING", "PUBLISHING"]).maybeSingle();
  if (activeError) throw activeError;
  if (active) return { job: active, duplicate_request: false, existing_active_job: true };
  const { data: job, error } = await admin.from("inventory_sync_jobs").insert({
    client_request_id: requestId, warehouse_site_id: SITE_ID, warehouse_code: "HY1", source: "MANUAL_XLSX",
    source_endpoint: "RECOVERY_XLSX", requested_by: context.userId, requested_source: "RECOVERY", state: "FETCHING", started_at: new Date().toISOString(),
  }).select().single();
  if (error) throw error;
  await admin.from("inventory_sync_audit").insert({ job_id: job.id, actor_id: context.userId, action: "RECOVERY_STARTED", detail: {} });
  return { job, duplicate_request: false };
}
async function stageRecoveryInventory(context: Context, body: Record<string, unknown>) {
  requireRole(context, ["ADMIN", "ADMIN_INVENT"]);
  const jobId = required(body.job_id, "Job ID");
  const items = Array.isArray(body.items) ? body.items as Record<string, unknown>[] : [];
  if (!items.length || items.length > 1000) throw new HttpError(400, "Mỗi batch tồn bin cần 1–1000 dòng");
  const normalized: Record<string, unknown>[] = [];
  for (const [index, item] of items.entries()) {
    const sku = required(item.sku, `SKU dòng ${index + 1}`);
    const rowKey = required(item.row_key ?? `${body.batch_index ?? 0}-${index}`, "row_key");
    const binQty = numberValue(item.bin_qty, "Tồn Bin", 0);
    const pending = numberValue(item.pending_out_qty ?? 0, "Tồn chờ Xuất", 0);
    const storageType = String(item.storage_type ?? "").trim();
    const binCode = String(item.bin_code ?? "").trim();
    const isPickable = Boolean(item.is_pickable);
    const canonical = JSON.stringify({ row_key: rowKey, sku, bin_code: binCode, storage_type: storageType, is_pickable: isPickable, bin_qty: binQty, pending_out_qty: pending });
    normalized.push({ row_key: rowKey, sku, bin_code: binCode, storage_type: storageType, is_pickable: isPickable, bin_qty: binQty, pending_out_qty: pending, raw_row_hash: await sha256(canonical) });
  }
  const { data, error } = await admin.rpc("stage_inventory_items_service", { p_job_id: jobId, p_rows: normalized });
  if (error) throw error;
  const { data: count } = await admin.rpc("inventory_staging_count_service", { p_job_id: jobId });
  await admin.from("inventory_sync_jobs").update({ raw_row_count: count ?? 0, normalized_row_count: count ?? 0, heartbeat_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", jobId);
  return { staged: data ?? 0, total_staged: count ?? 0 };
}
async function finalizeRecoveryInventory(context: Context, body: Record<string, unknown>) {
  requireRole(context, ["ADMIN", "ADMIN_INVENT"]);
  const jobId = required(body.job_id, "Job ID");
  const { data: digestInput, error: digestError } = await admin.rpc("inventory_staging_digest_input_service", { p_job_id: jobId });
  if (digestError) throw digestError;
  if (!digestInput) throw new HttpError(409, "Chưa có dữ liệu staging để publish");
  const { data: count, error: countError } = await admin.rpc("inventory_staging_count_service", { p_job_id: jobId });
  if (countError) throw countError;
  const capturedAt = body.source_captured_at ? new Date(String(body.source_captured_at)).toISOString() : new Date().toISOString();
  const hash = await sha256(String(digestInput));
  const { error: updateError } = await admin.from("inventory_sync_jobs").update({
    state: "VALIDATING", source_captured_at: capturedAt, sha256: hash, page_count: 1,
    raw_row_count: Number(count ?? 0), normalized_row_count: Number(count ?? 0), updated_at: new Date().toISOString(),
  }).eq("id", jobId).eq("requested_by", context.userId);
  if (updateError) throw updateError;
  const { data, error } = await admin.rpc("finalize_inventory_snapshot", { p_job_id: jobId });
  if (error) throw error;
  return data;
}
async function startSupraInventory(context: Context, body: Record<string, unknown>) {
  requireRole(context, ["ADMIN", "ADMIN_INVENT"]);
  const status = await inventoryConnectionStatus(context);
  if (!status.credential_version) throw new HttpError(409, "SUPRA_CREDENTIAL_REQUIRED");
  if (!status.contract_verified) throw new HttpError(409, "SOURCE_CONTRACT_UNVERIFIED");
  if (!status.enabled || status.status !== "CONNECTED") throw new HttpError(409, "SUPRA_CONNECTION_NOT_READY");
  // The source handover intentionally requires a read-only POC before the production JSON contract is activated.
  // No guessed pagination or field mapping is allowed here.
  throw new HttpError(409, "SUPRA_POC_REQUIRED");
}
async function cancelInventoryJob(context: Context, body: Record<string, unknown>) {
  requireRole(context, ["ADMIN", "ADMIN_INVENT"]);
  const id = required(body.job_id, "Job ID");
  const { data, error } = await admin.from("inventory_sync_jobs").update({ state: "CANCELLED", finished_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id).in("state", ["QUEUED", "CONNECTING", "FETCHING", "VALIDATING"]).select("id,state");
  if (error) throw error;
  if (!data?.length) throw new HttpError(409, "Job không còn ở trạng thái có thể hủy");
  await admin.from("inventory_sync_audit").insert({ job_id: id, actor_id: context.userId, action: "CANCELLED", detail: {} });
  return { cancelled: true, job_id: id };
}

async function route(req: Request) {
  const action = new URL(req.url).pathname.split("/").filter(Boolean).pop() ?? "";
  const body = req.method === "POST" ? await req.json().catch(() => ({})) as Record<string, unknown> : {};
  if (action === "bootstrap-admin") return bootstrapAdmin(req, body);
  if (action === "sla-tick") return slaTick(req);
  if (action === "cleanup") return cleanup(req);
  if (action === "configure-schedule") return configureSchedule(req);
  const context = await authenticated(req);
  switch (action) {
    case "session-profile": return { profile: context.profile, effective_role: context.effectiveRole };
    case "search-skus": {
      const q = normalizeSearch(required(body.query, "Từ khóa"));
      const tokens = q.split(" ").filter(Boolean).slice(0, 6);
      let query = admin.from("sku_catalog").select("sku,product_name").limit(Math.min(50, Math.max(1, Number(body.limit ?? 20))));
      for (const token of tokens) query = query.ilike("search_text", `%${token.replace(/[%_]/g, "")}%`);
      const { data, error } = await query.order("sku");
      if (error) throw error;
      const ranked = (data ?? []).sort((a, b) => {
        const aa = normalizeSearch(`${a.sku} ${a.product_name}`);
        const bb = normalizeSearch(`${b.sku} ${b.product_name}`);
        const score = (v: string, sku: string) => sku.toLowerCase() === q ? 0 : sku.toLowerCase().startsWith(q) ? 1 : sku.toLowerCase().includes(q) ? 2 : v.startsWith(q) ? 3 : 4;
        return score(aa, a.sku) - score(bb, b.sku) || a.sku.localeCompare(b.sku);
      });
      return { items: ranked };
    }
    case "report-shortage": {
      requireRole(context, ["PICKER", "ADMIN"]);
      const { data, error } = await admin.rpc("report_shortage_atomic", { p_sku: required(body.sku, "SKU"), p_reporter: context.userId, p_client_request_id: String(body.client_request_id ?? "") || null });
      if (error) throw error;
      const issue = data.issue;
      const message = data.already_reported ? `SKU ${issue.sku} vừa có thêm lượt báo; tổng ${issue.report_count} lượt.` : `Picker ${context.profile.full_name} báo thiếu SKU ${issue.sku}.`;
      if (!data.duplicate_request) await notifyUsers(await inventUserIds(), issue, "OPEN", message);
      return data;
    }
    case "active-issues": requireRole(context, ["ADMIN", "ADMIN_INVENT", "INVENT"]); return { issues: await issueRows(undefined, ACTIVE_STATUSES) };
    case "issue-board": {
      requireRole(context, ["ADMIN", "ADMIN_INVENT", "INVENT"]);
      const [open, claimed, recent] = await Promise.all([
        issueRows(undefined, ["OPEN"], 250),
        issueRows(undefined, ["CLAIMED", "SEARCHING", "REPLENISHING"], 250),
        issueRows(undefined, ["AVAILABLE", "SKIP_ALLOWED"], 250),
      ]);
      const mine = context.effectiveRole === "INVENT" ? claimed.filter((issue: any) => issue.assigned_id === context.userId) : claimed;
      return { open, claimed: mine, recent: recent.reverse(), skipped: recent.filter((i: any) => i.status === "SKIP_ALLOWED").reverse(), available: recent.filter((i: any) => i.status === "AVAILABLE").reverse() };
    }
    case "my-issues": {
      const { data, error } = await admin.from("issue_reports").select("issue_id").eq("reporter_id", context.userId).order("reported_at", { ascending: false }).limit(200);
      if (error) throw error;
      const ids = [...new Set<string>((data ?? []).map((row: any) => String(row.issue_id)))];
      return { issues: ids.length ? (await issueRows(ids)).reverse() : [] };
    }
    case "issue-detail": {
      const id = required(body.issue_id, "Issue ID");
      const issue = (await issueRows([id]))[0];
      if (!issue) throw new HttpError(404, "Không tìm thấy báo thiếu");
      if (context.effectiveRole === "PICKER") {
        const { count } = await admin.from("issue_reports").select("id", { count: "exact", head: true }).eq("issue_id", id).eq("reporter_id", context.userId);
        if (!(count ?? 0)) throw new HttpError(403, "Bạn không có quyền xem báo thiếu này");
      }
      return { issue };
    }
    case "claim-issue": {
      requireRole(context, ["ADMIN", "ADMIN_INVENT", "INVENT"]);
      const { data, error } = await admin.rpc("update_issue_atomic", { p_issue_id: required(body.issue_id, "Issue ID"), p_actor: context.userId, p_action: "CLAIM" });
      if (error) throw error;
      await notifyUsers(await inventUserIds(), data, "CLAIMED", `${context.profile.full_name} đã nhận xử lý SKU ${data.sku}.`);
      return { issue: data };
    }
    case "reassign-issue": {
      requireRole(context, ["ADMIN", "ADMIN_INVENT"]);
      const newAssignee = required(body.new_assignee_id, "Người nhận mới");
      const reason = required(body.reason, "Lý do điều phối");
      const before = (await issueRows([required(body.issue_id, "Issue ID")]))[0];
      const { data, error } = await admin.rpc("reassign_issue_atomic", { p_issue_id: body.issue_id, p_actor: context.userId, p_new_assignee: newAssignee, p_reason: reason });
      if (error) throw error;
      const recipients = [newAssignee, before?.assigned_id].filter(Boolean) as string[];
      await notifyUsers(recipients, data, "CLAIMED", `SKU ${data.sku} được điều phối cho người xử lý mới. Lý do: ${reason}`);
      return { issue: data };
    }
    case "update-issue": {
      requireRole(context, ["ADMIN", "ADMIN_INVENT", "INVENT"]);
      const actionValue = required(body.action, "Hành động").toUpperCase();
      if (!["AVAILABLE", "NOT_FOUND"].includes(actionValue) && !(actionValue === "CLOSE" && context.effectiveRole === "ADMIN")) throw new HttpError(400, "Hành động không hợp lệ");
      const { data, error } = await admin.rpc("update_issue_atomic", { p_issue_id: required(body.issue_id, "Issue ID"), p_actor: context.userId, p_action: actionValue });
      if (error) throw error;
      if (["AVAILABLE", "SKIP_ALLOWED"].includes(data.status)) {
        await admin.from("notification_events").update({ acknowledged_at: new Date().toISOString() }).eq("issue_id", data.id).eq("critical", true).is("acknowledged_at", null);
        const messages: Record<string, string> = {
          AVAILABLE: `SKU ${data.sku} đã có hàng/châm bù. Vui lòng quay lại vị trí lấy hàng.`,
          SKIP_ALLOWED: `Không tìm thấy SKU ${data.sku}. Bạn được phép SKIP SKU này.`,
        };
        await notifyUsers(await reporterIds(data.id), data, data.status, messages[data.status], true);
      }
      return { issue: data };
    }
    case "pending-alerts": {
      const { data, error } = await admin.from("notification_events").select("id,issue_id,issue_version,status,title,message,critical,created_at,sent_at,fcm_accepted_at")
        .eq("target_user_id", context.userId).eq("critical", true).is("acknowledged_at", null).order("created_at").limit(50);
      if (error) throw error;
      const ids = [...new Set<string>((data ?? []).map((row: any) => String(row.issue_id ?? "")).filter(Boolean))];
      const issues = ids.length ? await issueRows(ids) : [];
      const byId = new Map<string, any>(issues.map((issue: any) => [String(issue.id), issue]));
      return { events: (data ?? []).filter((event) => {
        const issue = byId.get(event.issue_id);
        return issue?.status === event.status && Number(issue.issue_version) === Number(event.issue_version);
      }).map((event) => ({ ...event, issue: byId.get(event.issue_id) })) };
    }
    case "mark-alert-received": {
      const id = required(body.event_id, "Event ID");
      const now = new Date().toISOString();
      const { data, error } = await admin.from("notification_events").update({ client_received_at: now }).eq("id", id).eq("target_user_id", context.userId).is("client_received_at", null).select("id");
      if (error) throw error;
      return { recorded: Boolean(data?.length), at: now };
    }
    case "mark-alert-displayed": {
      const id = required(body.event_id, "Event ID");
      const now = new Date().toISOString();
      const { data, error } = await admin.from("notification_events").update({ displayed_at: now }).eq("id", id).eq("target_user_id", context.userId).is("displayed_at", null).select("id");
      if (error) throw error;
      return { recorded: Boolean(data?.length), at: now };
    }
    case "ack-alert": {
      const eventId = required(body.event_id, "Event ID");
      const { data: event, error: eventError } = await admin.from("notification_events").select("id,issue_id,issue_version,status").eq("id", eventId).eq("target_user_id", context.userId).single();
      if (eventError || !event) throw new HttpError(404, "Không tìm thấy cảnh báo cần xác nhận");
      const issue = (await issueRows([event.issue_id]))[0];
      if (!issue || issue.status !== event.status || Number(issue.issue_version) !== Number(event.issue_version)) throw new HttpError(409, "Cảnh báo đã cũ; trạng thái SKU đã thay đổi");
      const { error } = await admin.from("notification_events").update({ acknowledged_at: new Date().toISOString() }).eq("id", eventId).eq("target_user_id", context.userId);
      if (error) throw error;
      return { acknowledged: true };
    }
    case "register-device": {
      const token = required(body.fcm_token, "FCM token");
      const { error } = await admin.from("device_tokens").upsert({ fcm_token: token, user_id: context.userId, platform: String(body.platform ?? "android"), device_name: String(body.device_name ?? ""), app_version: String(body.app_version ?? ""), active: true, last_seen_at: new Date().toISOString() }, { onConflict: "fcm_token" });
      if (error) throw error;
      return { registered: true };
    }
    case "sync-catalog": {
      const limit = Math.min(1000, Math.max(1, Number(body.limit ?? 1000)));
      const syncUntil = String(body.sync_until ?? new Date().toISOString());
      let query = admin.from("sku_catalog").select("sku,product_name,updated_at").lte("updated_at", syncUntil).order("sku").limit(limit);
      if (body.updated_since) query = query.gt("updated_at", String(body.updated_since));
      if (body.after_sku) query = query.gt("sku", String(body.after_sku));
      const { data, error } = await query;
      if (error) throw error;
      return { items: data ?? [], has_more: (data?.length ?? 0) === limit, sync_until: syncUntil };
    }
    case "get-operational-config": {
      requireRole(context, ["ADMIN", "ADMIN_INVENT"]);
      const { data, error } = await admin.from("app_config").select("acknowledge_minutes,reminder_minutes,replenish_minutes,picker_ack_reminder_minutes").eq("singleton", true).single();
      if (error) throw error;
      return data;
    }
    case "save-operational-config": {
      requireRole(context, ["ADMIN", "ADMIN_INVENT"]);
      const values = {
        acknowledge_minutes: Number(body.acknowledge_minutes), reminder_minutes: Number(body.reminder_minutes),
        replenish_minutes: Number(body.replenish_minutes), picker_ack_reminder_minutes: Number(body.picker_ack_reminder_minutes ?? 3),
        updated_by: context.userId, updated_at: new Date().toISOString(),
      };
      if ([values.acknowledge_minutes, values.reminder_minutes, values.replenish_minutes].some((v) => !Number.isInteger(v) || v < 1 || v > 480)) throw new HttpError(400, "Cấu hình SLA phải từ 1 đến 480 phút");
      if (!Number.isInteger(values.picker_ack_reminder_minutes) || values.picker_ack_reminder_minutes < 1 || values.picker_ack_reminder_minutes > 60) throw new HttpError(400, "Nhắc Picker phải từ 1 đến 60 phút");
      const { data, error } = await admin.from("app_config").update(values).eq("singleton", true).select("acknowledge_minutes,reminder_minutes,replenish_minutes,picker_ack_reminder_minutes").single();
      if (error) throw error;
      return data;
    }
    case "get-config": {
      requireRole(context, ["ADMIN"]);
      const { data, error } = await admin.from("app_config").select("*").eq("singleton", true).single();
      if (error) throw error;
      return data;
    }
    case "save-config": {
      requireRole(context, ["ADMIN"]);
      const values: Record<string, unknown> = {
        acknowledge_minutes: Number(body.acknowledge_minutes), reminder_minutes: Number(body.reminder_minutes), replenish_minutes: Number(body.replenish_minutes),
        picker_ack_reminder_minutes: Number(body.picker_ack_reminder_minutes ?? 3), diagnostic_log_retention_days: Number(body.diagnostic_log_retention_days ?? 14),
        retention_days: Number(body.retention_days ?? 60), inventory_auto_sync_enabled: Boolean(body.inventory_auto_sync_enabled),
        inventory_sync_interval_minutes: Number(body.inventory_sync_interval_minutes ?? 10), inventory_operating_start_hour: Number(body.inventory_operating_start_hour ?? 0),
        inventory_operating_end_hour: Number(body.inventory_operating_end_hour ?? 23), inventory_fresh_minutes: Number(body.inventory_fresh_minutes ?? 10), inventory_stale_minutes: Number(body.inventory_stale_minutes ?? 30),
        updated_by: context.userId, updated_at: new Date().toISOString(),
      };
      if ([values.acknowledge_minutes, values.reminder_minutes, values.replenish_minutes].some((v) => !Number.isInteger(v) || Number(v) < 1 || Number(v) > 480)) throw new HttpError(400, "Cấu hình SLA phải từ 1 đến 480 phút");
      if (!Number.isInteger(values.picker_ack_reminder_minutes) || Number(values.picker_ack_reminder_minutes) < 1 || Number(values.picker_ack_reminder_minutes) > 60) throw new HttpError(400, "Nhắc Picker phải từ 1 đến 60 phút");
      if (!Number.isInteger(values.diagnostic_log_retention_days) || Number(values.diagnostic_log_retention_days) < 1 || Number(values.diagnostic_log_retention_days) > 60) throw new HttpError(400, "Lưu log phải từ 1 đến 60 ngày");
      if (!Number.isInteger(values.retention_days) || Number(values.retention_days) < 7 || Number(values.retention_days) > 365) throw new HttpError(400, "Retention nghiệp vụ phải từ 7 đến 365 ngày");
      if (!Number.isInteger(values.inventory_sync_interval_minutes) || Number(values.inventory_sync_interval_minutes) < 10 || Number(values.inventory_sync_interval_minutes) > 120) throw new HttpError(400, "Chu kỳ tồn bin phải từ 10 đến 120 phút");
      if (Number(values.inventory_fresh_minutes) >= Number(values.inventory_stale_minutes)) throw new HttpError(400, "Ngưỡng stale phải lớn hơn ngưỡng fresh");
      const { data, error } = await admin.from("app_config").update(values).eq("singleton", true).select().single();
      if (error) throw error;
      return data;
    }
    case "list-users": return listUsers(context);
    case "update-user": return updateManagedUser(context, body);
    case "import-skus": {
      requireRole(context, ["ADMIN", "ADMIN_INVENT"]);
      const items = Array.isArray(body.items) ? body.items as Record<string, unknown>[] : [];
      if (!items.length || items.length > 1000) throw new HttpError(400, "Mỗi lô cần 1–1000 SKU");
      const now = new Date().toISOString();
      const rows = items.map((item) => ({ sku: required(item.sku, "SKU").trim(), product_name: required(item.product_name, "Tên sản phẩm").trim(), last_imported_at: now, updated_at: now }));
      const { error } = await admin.from("sku_catalog").upsert(rows, { onConflict: "sku" });
      if (error) throw error;
      return { imported: rows.length };
    }
    case "import-users": {
      const items = Array.isArray(body.items) ? body.items as Record<string, unknown>[] : [];
      if (!items.length || items.length > 200) throw new HttpError(400, "Mỗi lô cần 1–200 nhân sự");
      return importUsers(context, items);
    }
    case "sync-google-sheet": requireRole(context, ["ADMIN", "ADMIN_INVENT"]); return syncSheet();
    case "reports-summary": {
      requireRole(context, ["ADMIN", "ADMIN_INVENT"]);
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const { data, error } = await admin.from("issues").select("sku,status,report_count,first_reported_at,resolved_at,claimed_at,previous_issue_id").gte("first_reported_at", since).limit(5000);
      if (error) throw error;
      const rows = data ?? [];
      const byStatus: Record<string, number> = {};
      const skuCounts = new Map<string, number>();
      const durations: number[] = [];
      const claimDurations: number[] = [];
      rows.forEach((row) => {
        byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
        skuCounts.set(row.sku, (skuCounts.get(row.sku) ?? 0) + Number(row.report_count ?? 1));
        if (row.resolved_at) durations.push((new Date(row.resolved_at).getTime() - new Date(row.first_reported_at).getTime()) / 60000);
        if (row.claimed_at) claimDurations.push((new Date(row.claimed_at).getTime() - new Date(row.first_reported_at).getTime()) / 60000);
      });
      const percentile = (values: number[], p: number) => values.length ? [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor((values.length - 1) * p))] : null;
      const top_skus = [...skuCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([sku, reports]) => ({ sku, reports }));
      return {
        days: 30, issues: rows.length, reports: rows.reduce((s, r) => s + Number(r.report_count ?? 1), 0), by_status: byStatus,
        average_resolution_minutes: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
        median_resolution_minutes: percentile(durations, .5) == null ? null : Math.round(percentile(durations, .5)!),
        p95_resolution_minutes: percentile(durations, .95) == null ? null : Math.round(percentile(durations, .95)!),
        median_claim_minutes: percentile(claimDurations, .5) == null ? null : Math.round(percentile(claimDurations, .5)!),
        recurrent_episodes: rows.filter((row) => row.previous_issue_id).length, top_skus,
      };
    }
    case "issue-history": {
      requireRole(context, ["ADMIN", "ADMIN_INVENT"]);
      const { data, error } = await admin.from("issues").select("id").order("created_at", { ascending: false }).limit(Math.min(500, Math.max(1, Number(body.limit ?? 200))));
      if (error) throw error;
      const ids = (data ?? []).map((row: any) => String(row.id));
      return { issues: ids.length ? (await issueRows(ids)).reverse() : [] };
    }
    case "audit-history": {
      requireRole(context, ["ADMIN", "ADMIN_INVENT"]);
      const { data, error } = await admin.from("issue_audit").select("id,issue_id,actor_id,action,from_status,to_status,detail,created_at").order("created_at", { ascending: false }).limit(Math.min(1000, Math.max(1, Number(body.limit ?? 300))));
      if (error) throw error;
      return { audit: data ?? [] };
    }
    case "upload-log": return uploadDiagnosticLog(context, body);
    case "list-logs": return listDiagnosticLogs(context, body);
    case "download-log": return diagnosticLogDownload(context, body);
    case "inventory-status": return inventoryStatus(context, body);
    case "inventory-current": return inventoryCurrent(context, body);
    case "inventory-summary": return inventorySummary(context);
    case "inventory-connection-status": return inventoryConnectionStatus(context);
    case "inventory-credential-update": return updateInventoryCredential(context, body);
    case "inventory-sync-start": return startSupraInventory(context, body);
    case "inventory-recovery-start": return startRecoveryInventory(context, body);
    case "inventory-recovery-stage": return stageRecoveryInventory(context, body);
    case "inventory-recovery-finalize": return finalizeRecoveryInventory(context, body);
    case "inventory-job-cancel": return cancelInventoryJob(context, body);
    default: throw new HttpError(404, "Không tìm thấy chức năng");
  }
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") throw new HttpError(405, "Chỉ hỗ trợ POST");
    return json(await route(req));
  } catch (error) {
    console.error(error instanceof HttpError ? error.message : error);
    const status = error instanceof HttpError ? error.status : 500;
    const raw = errorText(error);
    const messages: Record<string, string> = {
      SKU_NOT_FOUND: "SKU không có trong danh mục đã đồng bộ",
      ALREADY_CLAIMED: "SKU đã có người khác nhận xử lý",
      ISSUE_NOT_OWNED: "SKU chưa thuộc phần xử lý của bạn",
      ISSUE_OWNED_BY_ANOTHER_USER: "SKU đang do người khác xử lý",
      ISSUE_ALREADY_RESOLVED: "SKU này đã được xử lý xong",
      INVALID_TRANSITION: "Không thể chuyển trạng thái SKU theo thao tác này",
      INVALID_ACTION: "Thao tác cập nhật không hợp lệ",
      REASSIGN_REASON_REQUIRED: "Điều phối lại phải có lý do",
      INVALID_ASSIGNEE: "Người nhận mới không hợp lệ hoặc đã bị khóa",
      ADMIN_PROTECTED: "Tài khoản ADMIN duy nhất được hệ thống bảo vệ",
      ADMIN_ALREADY_EXISTS: "Hệ thống chỉ cho phép duy nhất một ADMIN",
      SUPRA_CREDENTIAL_REQUIRED: "Chưa có credential Supra trên server",
      SOURCE_CONTRACT_UNVERIFIED: "Contract dữ liệu Supra chưa được POC read-only xác minh",
      SUPRA_CONNECTION_NOT_READY: "Kết nối Supra chưa sẵn sàng",
      SUPRA_POC_REQUIRED: "Cần hoàn tất POC read-only của API Supra trước khi bật đồng bộ tự động",
      ROW_COUNT_MISMATCH: "Số dòng staging không khớp; snapshot cũ vẫn được giữ nguyên",
    };
    const friendly = Object.entries(messages).find(([key]) => raw.includes(key))?.[1] ?? (status >= 500 ? "Lỗi máy chủ; dữ liệu hiện hành chưa bị thay đổi" : raw);
    return json({ error: friendly, code: Object.keys(messages).find((key) => raw.includes(key)) ?? undefined }, status);
  }
});
