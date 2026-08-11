import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { sendFcm } from "../_shared/fcm.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

type Profile = {
  id: string;
  employee_code: string;
  full_name: string;
  contractor: string;
  role: "PICKER" | "INVENT_USER" | "INVENT_ADMIN";
  active: boolean;
};

type Context = { userId: string; profile: Profile; client: SupabaseClient };

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
  return { userId: user.id, profile: profile as Profile, client };
}

function requireRole(context: Context, roles: Profile["role"][]) {
  if (!roles.includes(context.profile.role)) throw new HttpError(403, "Bạn không có quyền thực hiện thao tác này");
}

async function inventUserIds(): Promise<string[]> {
  const { data, error } = await admin.from("profiles").select("id")
    .in("role", ["INVENT_USER", "INVENT_ADMIN"]).eq("active", true);
  if (error) throw error;
  return (data ?? []).map((row) => row.id);
}

async function reporterIds(issueId: string): Promise<string[]> {
  const { data, error } = await admin.from("issue_reports").select("reporter_id").eq("issue_id", issueId);
  if (error) throw error;
  return [...new Set((data ?? []).map((row) => row.reporter_id))];
}

async function notifyUsers(
  userIds: string[],
  issue: Record<string, unknown>,
  status: string,
  message: string,
  critical = false,
) {
  const unique = [...new Set(userIds)];
  if (!unique.length) return;
  const rows = unique.map((userId) => ({
      issue_id: issue.id,
      target_user_id: userId,
      status,
      title: `${status} • SKU ${issue.sku}`,
      message,
      critical,
  }));
  const { data: events, error } = await admin.from("notification_events").insert(rows)
    .select("id,target_user_id");
  if (error) throw error;
  const { data: devices, error: deviceError } = await admin.from("device_tokens")
    .select("user_id,fcm_token").in("user_id", unique).eq("active", true);
  if (deviceError) throw deviceError;
  const tokens = new Map<string, string[]>();
  (devices ?? []).forEach((device) => {
    const list = tokens.get(device.user_id) ?? [];
    list.push(device.fcm_token);
    tokens.set(device.user_id, list);
  });
  const sentEventIds: string[] = [];
  await Promise.all((events ?? []).map(async (event) => {
    const payload = {
      event_id: event.id,
      issue_id: String(issue.id),
      sku: String(issue.sku),
      product_name: String(issue.product_name ?? ""),
      status,
      message,
      critical: String(critical),
    };
    const results = await Promise.allSettled(
      (tokens.get(event.target_user_id) ?? []).map((token) => sendFcm(token, payload)),
    );
    if (results.some((item) => item.status === "fulfilled")) sentEventIds.push(event.id);
  }));
  if (sentEventIds.length) {
    await admin.from("notification_events").update({ sent_at: new Date().toISOString() }).in("id", sentEventIds);
  }
}

async function issueRows(ids?: string[]) {
  let query = admin.from("issues").select("*").order("first_reported_at", { ascending: true }).limit(250);
  if (ids) query = query.in("id", ids);
  else query = query.in("status", ["OPEN", "CLAIMED", "SEARCHING", "REPLENISHING"]);
  const { data, error } = await query;
  if (error) throw error;
  const assigneeIds = [...new Set((data ?? []).map((row) => row.claimed_by).filter(Boolean))];
  const names = new Map<string, string>();
  if (assigneeIds.length) {
    const { data: profiles } = await admin.from("profiles").select("id,full_name").in("id", assigneeIds);
    (profiles ?? []).forEach((profile) => names.set(profile.id, profile.full_name));
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    sku: row.sku,
    product_name: row.product_name_snapshot,
    status: row.status,
    report_count: row.report_count,
    reported_at: row.first_reported_at,
    updated_at: row.updated_at,
    assigned_name: row.claimed_by ? names.get(row.claimed_by) ?? "" : "",
    latest_reporter_name: "",
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
  const email = employeeEmail(code);
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("Không tạo được Admin");
  const { error: insertError } = await admin.from("profiles").insert({
    id: data.user.id,
    employee_code: code,
    full_name: required(body.full_name, "Họ tên"),
    contractor: String(body.contractor ?? ""),
    role: "INVENT_ADMIN",
    active: true,
  });
  if (insertError) throw insertError;
  return { created: true, employee_code: code };
}

async function importUsers(items: Record<string, unknown>[]) {
  let created = 0;
  let updated = 0;
  const errors: string[] = [];
  for (const [index, item] of items.entries()) {
    try {
      const code = required(item.employee_code, "Mã nhân viên").trim();
      const { data: existing } = await admin.from("profiles").select("id").ilike("employee_code", code).maybeSingle();
      const profile = {
        employee_code: code,
        full_name: required(item.full_name, "Họ tên"),
        contractor: String(item.contractor ?? ""),
        role: String(item.role),
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
        const { data, error } = await admin.auth.admin.createUser({
          email: employeeEmail(code), password, email_confirm: true,
        });
        if (error || !data.user) throw error ?? new Error("Không tạo được tài khoản");
        const { error: insertError } = await admin.from("profiles").insert({ id: data.user.id, ...profile });
        if (insertError) throw insertError;
        created++;
      }
      await admin.from("sheet_export_queue").insert({
        event_type: "USER_UPSERT",
        payload: { ...profile, initial_password: undefined },
      });
    } catch (error) {
      errors.push(`Dòng ${index + 1}: ${errorText(error)}`);
    }
  }
  return { created, updated, failed: errors.length, errors: errors.slice(0, 30) };
}

async function syncSheet() {
  const url = Deno.env.get("GOOGLE_SHEET_WEBHOOK_URL") ?? "";
  const secret = Deno.env.get("GOOGLE_SHEET_WEBHOOK_SECRET") ?? "";
  if (!url || !secret) throw new HttpError(503, "Chưa cấu hình Google Sheet webhook");
  const { data: events, error } = await admin.from("sheet_export_queue").select("*")
    .is("exported_at", null).order("id").limit(500);
  if (error) throw error;
  if (!events?.length) return { exported: 0, remaining: 0 };
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ secret, events }),
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

async function slaTick(req: Request) {
  const expected = Deno.env.get("CRON_SECRET") ?? "";
  if (!expected || req.headers.get("x-cron-secret") !== expected) throw new HttpError(403, "Cron secret không đúng");
  const { data: events, error } = await admin.rpc("process_sla");
  if (error) throw error;
  for (const event of events ?? []) {
    const rows = await issueRows([event.issue_id]);
    const issue = rows[0];
    if (!issue) continue;
    if (event.event_kind === "SKIP_ALLOWED") {
      await notifyUsers(await reporterIds(issue.id), issue, "SKIP_ALLOWED", `SKU ${issue.sku} đã quá hạn. Bạn được phép skip hợp lệ.`, true);
    } else {
      const recipients = await inventUserIds();
      await notifyUsers(recipients, issue, issue.status, `SKU ${issue.sku} đã quá thời gian xử lý; cần phản hồi ngay.`);
    }
  }
  await resendPendingCritical();
  try { await syncSheet(); } catch (error) { console.warn("Sheet sync deferred", errorText(error)); }
  return { processed: events?.length ?? 0 };
}

async function resendPendingCritical() {
  const cutoff = new Date(Date.now() - 5 * 60_000).toISOString();
  const recent = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const { data: events, error } = await admin.from("notification_events")
    .select("id,issue_id,target_user_id,status,message,sent_at")
    .eq("critical", true).is("acknowledged_at", null).gte("created_at", recent)
    .or(`sent_at.is.null,sent_at.lt.${cutoff}`).limit(200);
  if (error) throw error;
  for (const event of events ?? []) {
    const issues = await issueRows([event.issue_id]);
    const issue = issues[0];
    if (!issue) continue;
    const { data: devices } = await admin.from("device_tokens").select("fcm_token")
      .eq("user_id", event.target_user_id).eq("active", true);
    const payload = {
      event_id: event.id,
      issue_id: String(issue.id),
      sku: String(issue.sku),
      product_name: String(issue.product_name ?? ""),
      status: String(event.status),
      message: String(event.message),
      critical: "true",
    };
    await Promise.allSettled((devices ?? []).map((device) => sendFcm(device.fcm_token, payload)));
    await admin.from("notification_events").update({ sent_at: new Date().toISOString() }).eq("id", event.id);
  }
}

async function cleanup(req: Request) {
  const expected = Deno.env.get("CRON_SECRET") ?? "";
  if (!expected || req.headers.get("x-cron-secret") !== expected) throw new HttpError(403, "Cron secret không đúng");
  const { data, error } = await admin.rpc("purge_old_data");
  if (error) throw error;
  return { deleted_issues: data ?? 0 };
}

async function configureSchedule(req: Request) {
  const expected = Deno.env.get("CRON_SECRET") ?? "";
  if (!expected || req.headers.get("x-cron-secret") !== expected) throw new HttpError(403, "Cron secret không đúng");
  const { data, error } = await admin.rpc("configure_automation", {
    p_project_url: SUPABASE_URL,
    p_cron_secret: expected,
  });
  if (error) throw error;
  return { configured: Boolean(data), interval_minutes: 5 };
}

async function route(req: Request) {
  const action = new URL(req.url).pathname.split("/").filter(Boolean).pop() ?? "";
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  if (action === "bootstrap-admin") return bootstrapAdmin(req, body);
  if (action === "sla-tick") return slaTick(req);
  if (action === "cleanup") return cleanup(req);
  if (action === "configure-schedule") return configureSchedule(req);
  const context = await authenticated(req);

  switch (action) {
    case "report-shortage": {
      requireRole(context, ["PICKER", "INVENT_ADMIN"]);
      const { data, error } = await admin.rpc("report_shortage_atomic", {
        p_sku: required(body.sku, "SKU"), p_reporter: context.userId,
        p_client_request_id: String(body.client_request_id ?? "") || null,
      });
      if (error) throw error;
      const issue = data.issue;
      const message = data.already_reported
        ? `SKU ${issue.sku} vừa có thêm lượt báo; tổng ${issue.report_count} lượt.`
        : `Picker ${context.profile.full_name} báo hết SKU ${issue.sku}.`;
      if (!data.duplicate_request) await notifyUsers(await inventUserIds(), issue, "OPEN", message);
      return data;
    }
    case "active-issues": {
      requireRole(context, ["INVENT_USER", "INVENT_ADMIN"]);
      return { issues: await issueRows() };
    }
    case "my-issues": {
      const { data, error } = await admin.from("issue_reports").select("issue_id")
        .eq("reporter_id", context.userId).order("reported_at", { ascending: false }).limit(200);
      if (error) throw error;
      const ids = [...new Set((data ?? []).map((row) => row.issue_id))];
      return { issues: ids.length ? await issueRows(ids) : [] };
    }
    case "update-issue": {
      requireRole(context, ["INVENT_USER", "INVENT_ADMIN"]);
      const { data, error } = await admin.rpc("update_issue_atomic", {
        p_issue_id: required(body.issue_id, "Issue ID"),
        p_actor: context.userId,
        p_action: required(body.action, "Hành động"),
      });
      if (error) throw error;
      const critical = ["AVAILABLE", "SKIP_ALLOWED"].includes(data.status);
      const messages: Record<string, string> = {
        CLAIMED: `Invent ${context.profile.full_name} đã nhận thông tin SKU ${data.sku}.`,
        SEARCHING: `Invent đang tìm SKU ${data.sku}.`,
        REPLENISHING: `Invent đang châm SKU ${data.sku}.`,
        AVAILABLE: `SKU ${data.sku} đã có hàng. Vui lòng quay lại vị trí lấy hàng.`,
        SKIP_ALLOWED: `Không tìm thấy SKU ${data.sku}. Bạn được phép skip hợp lệ.`,
        CLOSED: `Ticket SKU ${data.sku} đã đóng.`,
      };
      await notifyUsers(await reporterIds(data.id), data, data.status, messages[data.status] ?? `SKU ${data.sku} đã cập nhật.`, critical);
      if (data.status === "CLAIMED") {
        const others = (await inventUserIds()).filter((id) => id !== context.userId);
        await notifyUsers(others, data, "CLAIMED", `SKU ${data.sku} đã được ${context.profile.full_name} nhận xử lý.`);
      }
      return { issue: data };
    }
    case "ack-alert": {
      const { error } = await admin.from("notification_events").update({ acknowledged_at: new Date().toISOString() })
        .eq("id", required(body.event_id, "Event ID")).eq("target_user_id", context.userId);
      if (error) throw error;
      return { acknowledged: true };
    }
    case "register-device": {
      const token = required(body.fcm_token, "FCM token");
      const { error } = await admin.from("device_tokens").upsert({
        fcm_token: token,
        user_id: context.userId,
        platform: String(body.platform ?? "android"),
        device_name: String(body.device_name ?? ""),
        app_version: String(body.app_version ?? ""),
        active: true,
        last_seen_at: new Date().toISOString(),
      }, { onConflict: "fcm_token" });
      if (error) throw error;
      return { registered: true };
    }
    case "sync-catalog": {
      const limit = Math.min(1000, Math.max(1, Number(body.limit ?? 1000)));
      const syncUntil = String(body.sync_until ?? new Date().toISOString());
      let query = admin.from("sku_catalog").select("sku,product_name,updated_at")
        .lte("updated_at", syncUntil).order("sku").limit(limit);
      if (body.updated_since) query = query.gt("updated_at", String(body.updated_since));
      if (body.after_sku) query = query.gt("sku", String(body.after_sku));
      const { data, error } = await query;
      if (error) throw error;
      return { items: data ?? [], has_more: (data?.length ?? 0) === limit, sync_until: syncUntil };
    }
    case "get-config": {
      requireRole(context, ["INVENT_ADMIN"]);
      const { data, error } = await admin.from("app_config").select("*").eq("singleton", true).single();
      if (error) throw error;
      return data;
    }
    case "save-config": {
      requireRole(context, ["INVENT_ADMIN"]);
      const values = {
        acknowledge_minutes: Number(body.acknowledge_minutes),
        reminder_minutes: Number(body.reminder_minutes),
        skip_minutes: Number(body.skip_minutes),
        replenish_minutes: Number(body.replenish_minutes),
        updated_by: context.userId,
        updated_at: new Date().toISOString(),
      };
      if (Object.values(values).slice(0, 4).some((value) => !Number.isInteger(value) || Number(value) < 1 || Number(value) > 480)) {
        throw new HttpError(400, "Cấu hình SLA phải từ 1 đến 480 phút");
      }
      const { data, error } = await admin.from("app_config").update(values).eq("singleton", true).select().single();
      if (error) throw error;
      return data;
    }
    case "import-skus": {
      requireRole(context, ["INVENT_ADMIN"]);
      const items = Array.isArray(body.items) ? body.items : [];
      if (!items.length || items.length > 1000) throw new HttpError(400, "Mỗi lô cần 1–1000 SKU");
      const now = new Date().toISOString();
      const rows = items.map((item) => ({
        sku: required(item.sku, "SKU").trim(),
        product_name: required(item.product_name, "Tên sản phẩm").trim(),
        last_imported_at: now,
        updated_at: now,
      }));
      const { error } = await admin.from("sku_catalog").upsert(rows, { onConflict: "sku" });
      if (error) throw error;
      return { imported: rows.length };
    }
    case "import-users": {
      requireRole(context, ["INVENT_ADMIN"]);
      const items = Array.isArray(body.items) ? body.items : [];
      if (!items.length || items.length > 200) throw new HttpError(400, "Mỗi lô cần 1–200 nhân sự");
      return importUsers(items);
    }
    case "sync-google-sheet": {
      requireRole(context, ["INVENT_ADMIN"]);
      return syncSheet();
    }
    default:
      throw new HttpError(404, "Không tìm thấy chức năng");
  }
}

function required(value: unknown, label: string): string {
  const result = String(value ?? "").trim();
  if (!result) throw new HttpError(400, `${label} không được để trống`);
  return result;
}

function employeeEmail(code: string): string {
  const safe = code.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "-");
  if (safe !== code.trim().toLowerCase()) {
    throw new HttpError(400, "Mã nhân viên chỉ được dùng chữ, số, dấu chấm, gạch ngang hoặc gạch dưới");
  }
  return `${safe}@bao-hang-1291.local`;
}

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") throw new HttpError(405, "Chỉ hỗ trợ POST");
    return json(await route(req));
  } catch (error) {
    console.error(error);
    const status = error instanceof HttpError ? error.status : 500;
    const raw = errorText(error);
    const messages: Record<string, string> = {
      SKU_NOT_FOUND: "SKU không có trong danh mục đã đồng bộ",
      ALREADY_CLAIMED: "Ticket đã có Invent khác nhận",
      ISSUE_OWNED_BY_ANOTHER_USER: "Ticket đang do Invent khác xử lý",
      INVALID_ACTION: "Trạng thái cập nhật không hợp lệ",
    };
    const friendly = Object.entries(messages).find(([key]) => raw.includes(key))?.[1] ?? raw;
    return json({ error: friendly }, status);
  }
});
