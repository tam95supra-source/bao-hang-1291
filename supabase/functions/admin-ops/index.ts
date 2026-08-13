import { createClient } from "jsr:@supabase/supabase-js@2";
import { sendFcm } from "../_shared/fcm.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const PROTECTED_ADMIN_CODE = "6281280";
const productionOrigins = new Set(["https://bao-hang-1291.web.app", "https://bao-hang-1291.firebaseapp.com"]);
const previewOrigin = /^https:\/\/bao-hang-1291--[a-z0-9-]+\.web\.app$/i;

type Role = "ADMIN" | "ADMIN_INVENT" | "INVENT" | "PICKER";
type Profile = {
  id: string;
  employee_code: string;
  full_name: string;
  role: Role;
  active: boolean;
};
type Context = { userId: string; profile: Profile; effectiveRole: Role };

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const isAllowedOrigin = (origin: string) => productionOrigins.has(origin) || previewOrigin.test(origin);
function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const headers: Record<string, string> = {
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, apikey, content-type, x-admin-test-role",
    "access-control-max-age": "86400",
    "vary": "Origin",
  };
  if (origin && isAllowedOrigin(origin)) headers["access-control-allow-origin"] = origin;
  return headers;
}
function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
function required(value: unknown, label: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new HttpError(400, `${label} không được để trống`);
  return text;
}
function employeeEmail(code: string): string {
  const raw = code.trim().toLowerCase();
  if (!raw || !/^[a-z0-9._-]+$/.test(raw)) throw new HttpError(400, "Mã nhân viên chỉ được dùng chữ, số, dấu chấm, gạch ngang hoặc gạch dưới");
  return `${raw}@bao-hang-1291.local`;
}
function allowedManagedRoles(role: Role): Role[] {
  if (role === "ADMIN") return ["ADMIN_INVENT", "INVENT", "PICKER"];
  if (role === "ADMIN_INVENT") return ["INVENT", "PICKER"];
  return [];
}
function requireManagement(context: Context) {
  if (!["ADMIN", "ADMIN_INVENT"].includes(context.effectiveRole)) throw new HttpError(403, "Bạn không có quyền quản lý tài khoản");
}
function requireOperational(context: Context) {
  if (!["ADMIN", "ADMIN_INVENT", "INVENT"].includes(context.effectiveRole)) throw new HttpError(403, "Bạn không có quyền xử lý báo thiếu");
}
async function authenticated(req: Request): Promise<Context> {
  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) throw new HttpError(401, "Phiên đăng nhập không hợp lệ");
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) throw new HttpError(401, "Phiên đăng nhập đã hết hạn");
  const { data, error: profileError } = await admin.from("profiles")
    .select("id,employee_code,full_name,role,active").eq("id", user.id).single();
  if (profileError || !data?.active) throw new HttpError(403, "Tài khoản đã ngừng hoạt động");
  const profile = data as Profile;
  const requested = String(req.headers.get("x-admin-test-role") ?? "").trim().toUpperCase();
  let effectiveRole = profile.role;
  if (requested) {
    if (profile.role !== "ADMIN" || !["ADMIN_INVENT", "INVENT", "PICKER"].includes(requested)) throw new HttpError(403, "Chế độ kiểm thử quyền không hợp lệ");
    effectiveRole = requested as Role;
  }
  return { userId: user.id, profile, effectiveRole };
}

async function manualUser(context: Context, id: string) {
  const { data, error } = await admin.from("profiles")
    .select("id,employee_code,full_name,contractor,role,active,source_kind,source_position,protected_account")
    .eq("id", id).single();
  if (error || !data) throw new HttpError(404, "Không tìm thấy tài khoản");
  if (data.protected_account || data.employee_code === PROTECTED_ADMIN_CODE || data.role === "ADMIN") throw new HttpError(409, "Tài khoản Admin hệ thống được bảo vệ");
  if (data.source_kind === "GSHEET") throw new HttpError(409, "Nhân sự từ Google Sheet chỉ được thay đổi tại nguồn");
  if (data.source_kind !== "MANUAL") throw new HttpError(409, "Chỉ quản lý được tài khoản tạo thêm ngoài Google Sheet");
  if (!allowedManagedRoles(context.effectiveRole).includes(data.role as Role)) throw new HttpError(403, "Bạn không được quản lý tài khoản có quyền này");
  return data;
}
async function queueUser(profile: Record<string, unknown>) {
  const { error } = await admin.from("sheet_export_queue").insert({
    event_type: "USER_UPSERT",
    payload: { ...profile, updated_at: new Date().toISOString() },
  });
  if (error) console.warn("USER_UPSERT report queue deferred", errorText(error));
}
async function createManualUser(context: Context, body: Record<string, unknown>) {
  requireManagement(context);
  const employeeCode = required(body.employee_code, "Mã nhân viên");
  const fullName = required(body.full_name, "Họ tên");
  const password = required(body.password, "Mật khẩu");
  if (password.length < 8) throw new HttpError(400, "Mật khẩu cần ít nhất 8 ký tự");
  if (employeeCode === PROTECTED_ADMIN_CODE) throw new HttpError(409, "Mã nhân viên này được bảo vệ");
  const role = String(body.role ?? "").trim().toUpperCase() as Role;
  if (!allowedManagedRoles(context.effectiveRole).includes(role)) throw new HttpError(403, "Quyền được chọn vượt phạm vi quản lý của bạn");
  const { data: duplicate, error: duplicateError } = await admin.from("profiles").select("id,source_kind").ilike("employee_code", employeeCode).maybeSingle();
  if (duplicateError) throw duplicateError;
  if (duplicate) throw new HttpError(409, duplicate.source_kind === "GSHEET" ? "Mã nhân viên đã thuộc nguồn Google Sheet" : "Mã nhân viên đã tồn tại");
  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email: employeeEmail(employeeCode), password, email_confirm: true,
  });
  if (authError || !created.user) throw authError ?? new Error("Không tạo được tài khoản đăng nhập");
  const profile = {
    id: created.user.id,
    employee_code: employeeCode,
    full_name: fullName,
    contractor: "",
    role,
    active: true,
    source_kind: "MANUAL",
    source_position: "",
    source_last_seen_at: null,
    protected_account: false,
    updated_at: new Date().toISOString(),
  };
  const { error: insertError } = await admin.from("profiles").insert(profile);
  if (insertError) {
    const { error: cleanupError } = await admin.auth.admin.deleteUser(created.user.id);
    if (cleanupError) console.error("Manual account auth rollback failed", errorText(cleanupError));
    throw insertError;
  }
  await queueUser(profile);
  return { created: true, profile };
}
async function updateManualUser(context: Context, body: Record<string, unknown>) {
  requireManagement(context);
  const id = required(body.id, "User ID");
  const target = await manualUser(context, id);
  const employeeCode = required(body.employee_code, "Mã nhân viên");
  const fullName = required(body.full_name, "Họ tên");
  const role = String(body.role ?? target.role).trim().toUpperCase() as Role;
  const password = String(body.new_password ?? "");
  if (!allowedManagedRoles(context.effectiveRole).includes(role)) throw new HttpError(403, "Quyền được chọn vượt phạm vi quản lý của bạn");
  if (password && password.length < 8) throw new HttpError(400, "Mật khẩu mới cần ít nhất 8 ký tự");
  if (employeeCode === PROTECTED_ADMIN_CODE) throw new HttpError(409, "Mã nhân viên này được bảo vệ");
  if (employeeCode.toLowerCase() !== String(target.employee_code).toLowerCase()) {
    const { data: duplicate, error } = await admin.from("profiles").select("id").ilike("employee_code", employeeCode).neq("id", id).maybeSingle();
    if (error) throw error;
    if (duplicate) throw new HttpError(409, "Mã nhân viên đã tồn tại");
  }
  const values = {
    employee_code: employeeCode,
    full_name: fullName,
    contractor: "",
    role,
    active: typeof body.active === "boolean" ? body.active : Boolean(target.active),
    source_kind: "MANUAL",
    source_position: "",
    updated_at: new Date().toISOString(),
  };
  const { data: updated, error: updateError } = await admin.from("profiles").update(values).eq("id", id)
    .select("id,employee_code,full_name,contractor,role,active,source_kind,source_position,protected_account").single();
  if (updateError || !updated) throw updateError ?? new Error("Không cập nhật được hồ sơ");
  const authValues: { email?: string; password?: string } = {};
  if (employeeCode.toLowerCase() !== String(target.employee_code).toLowerCase()) authValues.email = employeeEmail(employeeCode);
  if (password) authValues.password = password;
  if (Object.keys(authValues).length) {
    const { error: authError } = await admin.auth.admin.updateUserById(id, authValues);
    if (authError) {
      const { error: rollbackError } = await admin.from("profiles").update({
        employee_code: target.employee_code,
        full_name: target.full_name,
        contractor: target.contractor,
        role: target.role,
        active: target.active,
        source_kind: target.source_kind,
        source_position: target.source_position,
        updated_at: new Date().toISOString(),
      }).eq("id", id);
      if (rollbackError) console.error("Manual profile rollback failed", errorText(rollbackError));
      throw authError;
    }
  }
  await queueUser(updated as Record<string, unknown>);
  return { updated: true, profile: updated };
}
async function deleteManualUser(context: Context, body: Record<string, unknown>) {
  requireManagement(context);
  const id = required(body.id, "User ID");
  const target = await manualUser(context, id);
  const now = new Date().toISOString();
  const { data: updated, error } = await admin.from("profiles").update({ active: false, updated_at: now }).eq("id", id)
    .select("id,employee_code,full_name,contractor,role,active,source_kind,source_position,protected_account").single();
  if (error || !updated) throw error ?? new Error("Không xóa được tài khoản");
  await admin.from("device_tokens").update({ active: false }).eq("user_id", id);
  await queueUser(updated as Record<string, unknown>);
  return { deleted: true, soft_deleted: true, history_retained: true, id: target.id };
}

async function reporterIds(issueId: string): Promise<string[]> {
  const { data, error } = await admin.from("issue_reports").select("reporter_id").eq("issue_id", issueId);
  if (error) throw error;
  return [...new Set((data ?? []).map((row) => String(row.reporter_id)).filter(Boolean))];
}
async function operationalIds(): Promise<string[]> {
  const { data, error } = await admin.from("profiles").select("id").eq("active", true).in("role", ["ADMIN", "ADMIN_INVENT", "INVENT"]);
  if (error) throw error;
  return (data ?? []).map((row) => String(row.id));
}
async function notifyUsers(userIds: string[], issue: Record<string, unknown>, status: string, title: string, message: string, critical: boolean) {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (!unique.length) return;
  const issueVersion = Math.max(1, Number(issue.issue_version ?? 1));
  const rows = unique.map((userId) => ({
    issue_id: issue.id,
    target_user_id: userId,
    status,
    issue_version: issueVersion,
    title,
    message,
    critical,
  }));
  const { data: events, error } = await admin.from("notification_events").insert(rows).select("id,target_user_id");
  if (error) throw error;
  const { data: devices, error: deviceError } = await admin.from("device_tokens").select("user_id,fcm_token").in("user_id", unique).eq("active", true);
  if (deviceError) throw deviceError;
  const tokens = new Map<string, string[]>();
  for (const device of devices ?? []) {
    const list = tokens.get(String(device.user_id)) ?? [];
    list.push(String(device.fcm_token));
    tokens.set(String(device.user_id), list);
  }
  const accepted: string[] = [];
  const invalid = new Set<string>();
  await Promise.all((events ?? []).map(async (event) => {
    let sent = false;
    const payload = {
      event_id: String(event.id),
      issue_id: String(issue.id),
      issue_version: String(issueVersion),
      sku: String(issue.sku ?? ""),
      product_name: String(issue.product_name ?? ""),
      status,
      message,
      critical: String(critical),
    };
    await Promise.all((tokens.get(String(event.target_user_id)) ?? []).map(async (token) => {
      try {
        const result = await sendFcm(token, payload, {
          ttlSeconds: critical ? 3600 : 1800,
          collapseKey: `issue-${issue.id}-${critical ? "picker" : "ops"}`,
          priority: critical ? "high" : "normal",
        });
        sent ||= result.accepted;
        if (result.invalidToken) invalid.add(token);
      } catch (error) {
        console.warn("FCM restore notification deferred", errorText(error));
      }
    }));
    if (sent) accepted.push(String(event.id));
  }));
  if (accepted.length) {
    const now = new Date().toISOString();
    await admin.from("notification_events").update({ sent_at: now, fcm_accepted_at: now, send_count: 1 }).in("id", accepted);
  }
  if (invalid.size) await admin.from("device_tokens").update({ active: false }).in("fcm_token", [...invalid]);
}
async function restoreSkippedIssue(context: Context, body: Record<string, unknown>) {
  requireOperational(context);
  const issueId = required(body.issue_id, "Issue ID");
  const reason = String(body.reason ?? "Đã tìm thấy hàng sau khi cho phép bỏ qua").trim().slice(0, 500);
  const { data: before, error: beforeError } = await admin.from("issues")
    .select("id,sku,product_name_snapshot,status,claimed_by,issue_version").eq("id", issueId).single();
  if (beforeError || !before) throw new HttpError(404, "Không tìm thấy báo thiếu");
  if (before.status !== "SKIP_ALLOWED") throw new HttpError(409, "Chỉ có thể hủy bỏ qua khi SKU đang ở trạng thái được phép bỏ qua");
  if (context.effectiveRole === "INVENT" && before.claimed_by !== context.userId) throw new HttpError(403, "Báo thiếu này không thuộc phần xử lý của bạn");
  const { data: issue, error } = await admin.rpc("restore_skipped_issue_available", {
    p_issue_id: issueId,
    p_actor: context.userId,
    p_reason: reason,
  });
  if (error) throw error;
  const now = new Date().toISOString();
  await admin.from("notification_events").update({ acknowledged_at: now })
    .eq("issue_id", issueId).eq("critical", true).is("acknowledged_at", null);
  const reporters = await reporterIds(issueId);
  const operational = await operationalIds();
  const title = `HỦY BỎ QUA • SKU ${issue.sku}`;
  const pickerMessage = `SKU ${issue.sku} đã tìm thấy hàng. Hủy quyền bỏ qua trước đó: không SKIP SKU này; vui lòng quay lại vị trí lấy hàng và tiếp tục thao tác.`;
  const opsMessage = `SKU ${issue.sku} đã tìm thấy hàng sau khi được phép bỏ qua. Trạng thái đã sửa thành ĐÃ CÓ HÀNG. Lý do: ${reason || "Đã tìm thấy hàng"}.`;
  await notifyUsers(reporters, issue, "AVAILABLE", title, pickerMessage, true);
  const reporterSet = new Set(reporters);
  await notifyUsers(operational.filter((id) => !reporterSet.has(id)), issue, "AVAILABLE", title, opsMessage, false);
  return { restored: true, issue, affected_reporters: reporters.length, notified_operational_users: operational.length };
}

async function route(req: Request, context: Context) {
  const action = new URL(req.url).pathname.split("/").filter(Boolean).at(-1) ?? "";
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  switch (action) {
    case "create-user": return createManualUser(context, body);
    case "update-user": return updateManualUser(context, body);
    case "delete-user": return deleteManualUser(context, body);
    case "restore-skipped": return restoreSkippedIssue(context, body);
    default: throw new HttpError(404, "Không tìm thấy chức năng quản trị");
  }
}

Deno.serve(async (req) => {
  try {
    const origin = req.headers.get("origin") ?? "";
    if (origin && !isAllowedOrigin(origin)) return json(req, { error: "Nguồn web không được phép" }, 403);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
    if (req.method !== "POST") throw new HttpError(405, "Chỉ hỗ trợ POST");
    const context = await authenticated(req);
    return json(req, await route(req, context));
  } catch (error) {
    console.error(error instanceof HttpError ? error.message : error);
    const status = error instanceof HttpError ? error.status : 500;
    return json(req, { error: status >= 500 ? "Lỗi máy chủ; dữ liệu hiện hành chưa bị thay đổi" : errorText(error) }, status);
  }
});
