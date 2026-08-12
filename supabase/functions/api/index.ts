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
const PROTECTED_ADMIN_CODE = "6281280";
const STAFF_SHEET_ID = "1FRROqCp1lmkuHc3lc4UBpVI5_ZrtiPI1thlEymv458E";
const STAFF_SHEET_NAME = "DANH MỤC NHÂN SỰ";

type Role = "ADMIN" | "ADMIN_INVENT" | "INVENT" | "PICKER";
type Profile = { id: string; employee_code: string; full_name: string; contractor: string; role: Role; active: boolean; source_kind?: string; source_position?: string; protected_account?: boolean };
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
    AVAILABLE: `ĐÃ CÓ HÀNG • SKU ${issue.sku}`,
    SKIP_ALLOWED: `CHO PHÉP SKIP • SKU ${issue.sku}`,
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
  let created = 0, updated = 0;
  const errors: string[] = [];
  for (const [index, item] of items.entries()) {
    try {
      const code = required(item.employee_code, "Mã nhân viên").trim();
      if (code === PROTECTED_ADMIN_CODE) throw new Error("Tài khoản quản trị cao nhất được bảo vệ");
      const role = String(item.role ?? "PICKER").trim().toUpperCase() as Role;
      const allowed = context.effectiveRole === "ADMIN" ? new Set<Role>(["ADMIN_INVENT","INVENT","PICKER"]) : new Set<Role>(["PICKER"]);
      if (!allowed.has(role)) throw new Error(context.effectiveRole === "ADMIN" ? "Admin hệ thống chỉ tạo thêm Admin Event, Người báo hàng hoặc Picker" : "Admin Event chỉ được tạo thêm Picker / Người lấy hàng");
      const { data: existing, error: existingError } = await admin.from("profiles").select("id,role,source_kind,protected_account").ilike("employee_code", code).maybeSingle();
      if (existingError) throw existingError;
      if (existing?.protected_account || existing?.role === "ADMIN") throw new Error("Tài khoản quản trị cao nhất được bảo vệ");
      if (existing?.source_kind === "GSHEET") throw new Error("Nhân sự đồng bộ từ Google Sheet chỉ được cập nhật từ nguồn");
      const profile = { employee_code:code, full_name:required(item.full_name,"Họ tên"), contractor:String(item.contractor??""), role,
        active:item.active===undefined?true:Boolean(item.active), source_kind:"MANUAL", source_position:"", source_last_seen_at:null, protected_account:false, updated_at:new Date().toISOString() };
      if (existing) {
        const { error } = await admin.from("profiles").update(profile).eq("id", existing.id); if (error) throw error; updated++;
      } else {
        let password=String(item.initial_password??"").trim();
        if(!password){const {data,error}=await admin.rpc("get_staff_default_password_service");if(error)throw error;password=String(data??"");}
        if(password.length<8) throw new Error("Mật khẩu khởi tạo không hợp lệ");
        const {data,error}=await admin.auth.admin.createUser({email:employeeEmail(code),password,email_confirm:true});
        if(error||!data.user)throw error??new Error("Không tạo được tài khoản");
        const {error:insertError}=await admin.from("profiles").insert({id:data.user.id,...profile});if(insertError)throw insertError;created++;
      }
      await admin.from("sheet_export_queue").insert({event_type:"USER_UPSERT",payload:profile});
    } catch(error){errors.push(`Dòng ${index+1}: ${errorText(error)}`);}
  }
  return {created,updated,failed:errors.length,errors:errors.slice(0,30)};
}

async function listUsers(context: Context) {
  requireRole(context, ["ADMIN", "ADMIN_INVENT"]);
  let query=admin.from("profiles").select("id,employee_code,full_name,contractor,role,active,source_kind,source_position,source_last_seen_at,protected_account",{count:"exact"}).order("employee_code").limit(5000);
  if(context.effectiveRole==="ADMIN_INVENT") query=query.neq("role","ADMIN");
  const {data,error,count}=await query;if(error)throw error;
  if((count??0)>5000)throw new HttpError(409,"Số nhân sự vượt giới hạn 5000 tài khoản");
  return {users:data??[],count:count??0};
}

async function updateManagedUser(context: Context, body: Record<string, unknown>) {
  requireRole(context,["ADMIN","ADMIN_INVENT"]);
  const targetId=required(body.id,"User ID");
  const {data:target,error:targetError}=await admin.from("profiles").select("id,employee_code,full_name,contractor,role,active,source_kind,source_position,protected_account").eq("id",targetId).single();
  if(targetError||!target)throw new HttpError(404,"Không tìm thấy tài khoản");
  if(target.protected_account||target.employee_code===PROTECTED_ADMIN_CODE||target.role==="ADMIN")throw new HttpError(409,"ADMIN_PROTECTED");
  if(target.source_kind==="GSHEET")throw new HttpError(409,"SOURCE_MANAGED_USER");
  if(context.effectiveRole==="ADMIN_INVENT"&&target.role!=="PICKER")throw new HttpError(403,"Admin Event chỉ được quản lý Picker tạo thêm ngoài danh sách nguồn");
  const employeeCode=required(body.employee_code,"Mã nhân viên"),fullName=required(body.full_name,"Họ tên"),contractor=String(body.contractor??"").trim();
  const role=String(body.role??target.role).trim().toUpperCase() as Role,active=typeof body.active==="boolean"?body.active:Boolean(target.active),newPassword=String(body.new_password??"");
  if(!["ADMIN_INVENT","INVENT","PICKER"].includes(role))throw new HttpError(400,"Quyền không hợp lệ");
  if(context.effectiveRole==="ADMIN_INVENT"&&role!=="PICKER")throw new HttpError(403,"Admin Event chỉ được quản lý Picker");
  if(newPassword&&newPassword.length<8)throw new HttpError(400,"Mật khẩu mới cần ít nhất 8 ký tự");
  if(employeeCode===PROTECTED_ADMIN_CODE)throw new HttpError(409,"ADMIN_PROTECTED");
  if(employeeCode.toLowerCase()!==String(target.employee_code).toLowerCase()){
    const {data:duplicate,error}=await admin.from("profiles").select("id").ilike("employee_code",employeeCode).neq("id",targetId).maybeSingle();if(error)throw error;if(duplicate)throw new HttpError(409,"Mã nhân viên đã tồn tại");
  }
  const values={employee_code:employeeCode,full_name:fullName,contractor,role,active,source_kind:"MANUAL",updated_at:new Date().toISOString()};
  const {data:updated,error:updateError}=await admin.from("profiles").update(values).eq("id",targetId).select("id,employee_code,full_name,contractor,role,active,source_kind,source_position,source_last_seen_at,protected_account").single();
  if(updateError||!updated)throw updateError??new Error("Không cập nhật được hồ sơ");
  const authValues:{email?:string;password?:string}={};if(employeeCode.toLowerCase()!==String(target.employee_code).toLowerCase())authValues.email=employeeEmail(employeeCode);if(newPassword)authValues.password=newPassword;
  if(Object.keys(authValues).length){const {error}=await admin.auth.admin.updateUserById(targetId,authValues);if(error)throw error;}
  await admin.from("sheet_export_queue").insert({event_type:"USER_UPSERT",payload:values});return {profile:updated};
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
  const expected=Deno.env.get("CRON_SECRET")??"";if(!expected||req.headers.get("x-cron-secret")!==expected)throw new HttpError(403,"Cron secret không đúng");
  const {data:events,error}=await admin.rpc("process_sla");if(error)throw error;for(const event of events??[]){const issue=(await issueRows([event.issue_id]))[0];if(issue)await notifyUsers(await inventUserIds(),issue,issue.status,`SKU ${issue.sku} đã vượt mốc thời gian vận hành; cần kiểm tra và phản hồi.`);}
  const {data:autoSkipped,error:autoSkipError}=await admin.rpc("auto_skip_overdue_service");if(autoSkipError)throw autoSkipError;for(const row of autoSkipped??[]){const issue=(await issueRows([row.issue_id]))[0];if(issue)await notifyUsers(await reporterIds(issue.id),issue,"SKIP_ALLOWED",`Không tìm thấy hàng để bổ sung cho SKU ${issue.sku} trong thời gian quy định. Bạn được phép SKIP SKU này và tiếp tục công việc.`,true);}
  await resendPendingCritical();if(await staffSyncDue().catch(()=>false)){try{await syncStaffDirectory("AUTO",null);}catch(error){console.warn("Staff sync deferred",errorText(error));}}try{await syncSheet();}catch(error){console.warn("Sheet sync deferred",errorText(error));}
  return {processed:events?.length??0,auto_skipped:autoSkipped?.length??0,critical_reminder_checked:true};
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

function parseCsv(text: string): string[][] {
  const rows:string[][]=[];let row:string[]=[],cell="",quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i],n=text[i+1];if(quoted){if(c==='"'&&n==='"'){cell+='"';i++;}else if(c==='"')quoted=false;else cell+=c;continue;}if(c==='"')quoted=true;else if(c===','){row.push(cell);cell="";}else if(c==='\n'){row.push(cell.replace(/\r$/,""));rows.push(row);row=[];cell="";}else cell+=c;}
  if(cell.length||row.length){row.push(cell.replace(/\r$/,""));rows.push(row);}return rows;
}
function staffRole(position:string,employeeCode:string):Role{if(employeeCode===PROTECTED_ADMIN_CODE)return "ADMIN";return ["chuyen vien","truong nhom","truong kho"].includes(normalizeSearch(position))?"ADMIN_INVENT":"PICKER";}
async function staffDefaultPassword():Promise<string>{const {data,error}=await admin.rpc("get_staff_default_password_service");if(error)throw error;const v=String(data??"");if(v.length<8)throw new HttpError(503,"Mật khẩu mặc định nhân sự chưa được cấu hình an toàn");return v;}
async function staffSyncDue():Promise<boolean>{const {data:cfg,error}=await admin.from("app_config").select("staff_auto_sync_enabled,staff_sync_interval_minutes").eq("singleton",true).single();if(error)throw error;if(!cfg.staff_auto_sync_enabled)return false;const {data:last,error:e}=await admin.from("staff_sync_runs").select("finished_at").in("status",["SUCCEEDED","NO_CHANGE"]).order("finished_at",{ascending:false}).limit(1).maybeSingle();if(e)throw e;if(!last?.finished_at)return true;return Date.now()-new Date(last.finished_at).getTime()>=Math.max(15,Number(cfg.staff_sync_interval_minutes??60))*60000;}
async function syncStaffDirectory(triggerSource:"AUTO"|"MANUAL"|"DEPLOY",actorId:string|null=null){
  const {data:running}=await admin.from("staff_sync_runs").select("id,started_at").eq("status","RUNNING").gte("started_at",new Date(Date.now()-15*60000).toISOString()).limit(1).maybeSingle();if(running)return {status:"RUNNING",run_id:running.id,reused:true};
  const {data:run,error:runError}=await admin.from("staff_sync_runs").insert({trigger_source:triggerSource,source_sheet_id:STAFF_SHEET_ID,requested_by:actorId}).select().single();if(runError||!run)throw runError??new Error("Không tạo được phiên đồng bộ nhân sự");
  try{
    const url=`https://docs.google.com/spreadsheets/d/${STAFF_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(STAFF_SHEET_NAME)}`;const response=await fetch(url,{headers:{accept:"text/csv"},redirect:"follow"});if(!response.ok)throw new Error(`Google Sheet HTTP ${response.status}`);const text=await response.text();if(!text||text.length>5000000)throw new Error("Dữ liệu DANH MỤC NHÂN SỰ rỗng hoặc vượt giới hạn an toàn");
    const rows=parseCsv(text);if(rows.length<2)throw new Error("DANH MỤC NHÂN SỰ không có dữ liệu");const headers=rows[0].map(normalizeSearch);const col=(...names:string[])=>{const a=names.map(normalizeSearch);const i=headers.findIndex(h=>a.includes(h));if(i<0)throw new Error(`Thiếu cột ${names[0]}`);return i;};
    const cCode=col("Mã nhân viên"),cName=col("Họ tên"),cContractor=col("Nhà thầu"),cPosition=col("Vị trí chính"),cSite=col("Site"),cWarehouse=col("Kho");const byCode=new Map<string,{employee_code:string;full_name:string;contractor:string;source_position:string;role:Role}>();
    for(const row of rows.slice(1)){const code=String(row[cCode]??"").trim(),full_name=String(row[cName]??"").trim();if(!code||!full_name)continue;if(String(row[cSite]??"").trim()!=="1291"||String(row[cWarehouse]??"").trim().toUpperCase()!=="HY1")continue;const source_position=String(row[cPosition]??"").trim();byCode.set(code,{employee_code:code,full_name,contractor:String(row[cContractor]??"").trim(),source_position,role:staffRole(source_position,code)});}
    if(!byCode.size)throw new Error("Không có nhân sự Site 1291 / Kho HY1 trong nguồn");const canonical=[...byCode.values()].sort((a,b)=>a.employee_code.localeCompare(b.employee_code)).map(x=>`${x.employee_code}|${x.full_name}|${x.contractor}|${x.source_position}|${x.role}`).join("\n");const sourceHash=await sha256(canonical);
    const {data:last}=await admin.from("staff_sync_runs").select("source_hash").in("status",["SUCCEEDED","NO_CHANGE"]).order("finished_at",{ascending:false}).limit(1).maybeSingle();if(triggerSource==="AUTO"&&last?.source_hash===sourceHash){await admin.from("staff_sync_runs").update({status:"NO_CHANGE",source_hash:sourceHash,source_rows:Math.max(0,rows.length-1),eligible_rows:byCode.size,finished_at:new Date().toISOString()}).eq("id",run.id);return {status:"NO_CHANGE",run_id:run.id,eligible_rows:byCode.size};}
    const {data:profiles,error:profileError}=await admin.from("profiles").select("id,employee_code,full_name,contractor,role,active,source_kind,source_position,protected_account").limit(10000);if(profileError)throw profileError;const existing=new Map((profiles??[]).map((p:any)=>[String(p.employee_code).toLowerCase(),p]));const defaultPassword=await staffDefaultPassword();let created=0,updated=0,deactivated=0,failed=0;const failures:string[]=[],seen:string[]=[];
    for(const staff of byCode.values()){const key=staff.employee_code.toLowerCase();seen.push(key);try{const old:any=existing.get(key);if(staff.employee_code===PROTECTED_ADMIN_CODE){if(old){const values={full_name:staff.full_name,contractor:staff.contractor,role:"ADMIN",active:true,protected_account:true,source_position:staff.source_position,source_last_seen_at:new Date().toISOString(),updated_at:new Date().toISOString()};const {error}=await admin.from("profiles").update(values).eq("id",old.id);if(error)throw error;updated++;}continue;}const values={employee_code:staff.employee_code,full_name:staff.full_name,contractor:staff.contractor,role:staff.role,active:true,source_kind:"GSHEET",source_position:staff.source_position,source_last_seen_at:new Date().toISOString(),protected_account:false,updated_at:new Date().toISOString()};if(old){if(old.protected_account||old.role==="ADMIN")continue;const {error}=await admin.from("profiles").update(values).eq("id",old.id);if(error)throw error;updated++;await admin.from("sheet_export_queue").insert({event_type:"USER_UPSERT",payload:{id:old.id,...values}});}else{const {data,error}=await admin.auth.admin.createUser({email:employeeEmail(staff.employee_code),password:defaultPassword,email_confirm:true});if(error||!data.user)throw error??new Error("Không tạo được tài khoản");const {error:ie}=await admin.from("profiles").insert({id:data.user.id,...values});if(ie)throw ie;created++;await admin.from("sheet_export_queue").insert({event_type:"USER_UPSERT",payload:{id:data.user.id,...values}});}}catch(error){failed++;failures.push(`${staff.employee_code}: ${errorText(error)}`);}}
    if(failed===0){const missing=(profiles??[]).filter((p:any)=>p.source_kind==="GSHEET"&&!p.protected_account&&p.employee_code!==PROTECTED_ADMIN_CODE&&!seen.includes(String(p.employee_code).toLowerCase())&&p.active);for(const p of missing){const {error}=await admin.from("profiles").update({active:false,updated_at:new Date().toISOString()}).eq("id",p.id);if(error){failed++;failures.push(`${p.employee_code}: ${errorText(error)}`);continue;}deactivated++;await admin.from("sheet_export_queue").insert({event_type:"USER_UPSERT",payload:{id:p.id,employee_code:p.employee_code,full_name:p.full_name,contractor:p.contractor,role:p.role,active:false}});}}
    await admin.from("profiles").update({role:"ADMIN",active:true,protected_account:true}).eq("employee_code",PROTECTED_ADMIN_CODE);const status=failed?"PARTIAL":"SUCCEEDED";await admin.from("staff_sync_runs").update({status,source_hash:sourceHash,source_rows:Math.max(0,rows.length-1),eligible_rows:byCode.size,created_count:created,updated_count:updated,deactivated_count:deactivated,failed_count:failed,error_summary:failures.slice(0,20).join("; ").slice(0,3000),finished_at:new Date().toISOString()}).eq("id",run.id);const {error:broadcastError}=await admin.rpc("broadcast_staff_change_service",{p_payload:{run_id:run.id,status,created,updated,deactivated}});if(broadcastError)console.warn("Staff realtime broadcast deferred",errorText(broadcastError));return {status,run_id:run.id,eligible_rows:byCode.size,created,updated,deactivated,failed,errors:failures.slice(0,20)};
  }catch(error){await admin.from("staff_sync_runs").update({status:"FAILED",failed_count:1,error_summary:errorText(error).slice(0,3000),finished_at:new Date().toISOString()}).eq("id",run.id);throw error;}
}
async function staffSyncStatus(context:Context){requireRole(context,["ADMIN","ADMIN_INVENT"]);const {data,error}=await admin.from("staff_sync_runs").select("*").order("started_at",{ascending:false}).limit(10);if(error)throw error;return {runs:data??[],source_sheet_id:STAFF_SHEET_ID,source_sheet_name:STAFF_SHEET_NAME};}
async function replaceCatalog(context:Context,body:Record<string,unknown>){requireRole(context,["ADMIN","ADMIN_INVENT"]);const items=Array.isArray(body.items)?body.items as Record<string,unknown>[]:[];if(!items.length||items.length>10000)throw new HttpError(400,"File danh mục cần từ 1 đến 10.000 SKU");const clean=items.map(item=>({sku:required(item.sku,"SKU").trim(),product_name:required(item.product_name,"Tên sản phẩm").trim()}));const canonical=clean.slice().sort((a,b)=>a.sku.localeCompare(b.sku)).map(x=>`${x.sku}|${x.product_name}`).join("\n");const sourceSha=await sha256(canonical);const {data,error}=await admin.rpc("replace_sku_catalog_service",{p_items:clean,p_actor:context.userId,p_source_name:String(body.source_name??"Tồn Bin XLSX").slice(0,240),p_source_sha:sourceSha});if(error)throw error;return {...data,source_sha256:sourceSha};}
async function deleteManagedUser(context:Context,body:Record<string,unknown>){requireRole(context,["ADMIN","ADMIN_INVENT"]);const id=required(body.id,"User ID");const {data:t,error}=await admin.from("profiles").select("id,employee_code,full_name,contractor,role,active,source_kind,protected_account").eq("id",id).single();if(error||!t)throw new HttpError(404,"Không tìm thấy tài khoản");if(t.protected_account||t.employee_code===PROTECTED_ADMIN_CODE||t.role==="ADMIN")throw new HttpError(409,"ADMIN_PROTECTED");if(t.source_kind==="GSHEET")throw new HttpError(409,"SOURCE_MANAGED_USER");if(context.effectiveRole==="ADMIN_INVENT"&&t.role!=="PICKER")throw new HttpError(403,"Admin Event chỉ được quản lý Picker tạo thêm");const {error:ue}=await admin.from("profiles").update({active:false,updated_at:new Date().toISOString()}).eq("id",id);if(ue)throw ue;await admin.from("sheet_export_queue").insert({event_type:"USER_UPSERT",payload:{...t,active:false,updated_at:new Date().toISOString()}});return {deleted:true,soft_deleted:true,id};}
async function serviceMetrics(context:Context){requireRole(context,["ADMIN","ADMIN_INVENT"]);const [{data:usage,error},{data:lastStaff},{data:cfg}]=await Promise.all([admin.rpc("service_usage_snapshot"),admin.from("staff_sync_runs").select("status,finished_at,eligible_rows,failed_count").order("started_at",{ascending:false}).limit(1).maybeSingle(),admin.from("app_config").select("retention_days,diagnostic_log_retention_days,staff_auto_sync_enabled,staff_sync_interval_minutes,auto_skip_enabled,auto_skip_after_minutes").eq("singleton",true).single()]);if(error)throw error;return {usage,last_staff_sync:lastStaff??null,config:cfg??{},free_limits:{database_bytes:500*1024*1024,storage_bytes:1024*1024*1024,edge_invocations_month:500000,realtime_messages_month:2000000,realtime_peak_connections:200},cost_policy:{billing_enabled:false,paid_services_allowed:false,guard:"Firebase deploy chặn nếu billingEnabled=true"}};}


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
      let query = admin.from("sku_catalog").select("sku,product_name").eq("active", true).limit(Math.min(50, Math.max(1, Number(body.limit ?? 20))));
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
          AVAILABLE: `SKU ${data.sku} đã được bổ sung hàng. Vui lòng quay lại vị trí lấy hàng và tiếp tục thao tác.`,
          SKIP_ALLOWED: `Không tìm thấy hàng để bổ sung cho SKU ${data.sku}. Bạn được phép SKIP SKU này và tiếp tục công việc.`,
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
      const limit=Math.min(1000,Math.max(1,Number(body.limit??1000))),syncUntil=String(body.sync_until??new Date().toISOString());
      const {data:cs,error:se}=await admin.from("catalog_state").select("revision").eq("singleton",true).single();if(se)throw se;
      let query=admin.from("sku_catalog").select("sku,product_name,updated_at").eq("active",true).lte("updated_at",syncUntil).order("sku").limit(limit);if(body.after_sku)query=query.gt("sku",String(body.after_sku));const {data,error}=await query;if(error)throw error;
      return {items:data??[],has_more:(data?.length??0)===limit,sync_until:syncUntil,catalog_revision:Number(cs.revision??1)};
    }
    case "get-operational-config": {
      requireRole(context, ["ADMIN", "ADMIN_INVENT"]);
      const { data, error } = await admin.from("app_config").select("acknowledge_minutes,reminder_minutes,replenish_minutes,picker_ack_reminder_minutes,auto_skip_enabled,auto_skip_after_minutes").eq("singleton", true).single();
      if (error) throw error;
      return data;
    }
    case "save-operational-config": {
      requireRole(context, ["ADMIN", "ADMIN_INVENT"]);
      const values = {
        acknowledge_minutes: Number(body.acknowledge_minutes), reminder_minutes: Number(body.reminder_minutes),
        replenish_minutes: Number(body.replenish_minutes), picker_ack_reminder_minutes: Number(body.picker_ack_reminder_minutes ?? 3),
        auto_skip_enabled: Boolean(body.auto_skip_enabled), auto_skip_after_minutes: Number(body.auto_skip_after_minutes ?? 120),
        updated_by: context.userId, updated_at: new Date().toISOString(),
      };
      if ([values.acknowledge_minutes, values.reminder_minutes, values.replenish_minutes].some((v) => !Number.isInteger(v) || v < 1 || v > 480)) throw new HttpError(400, "Cấu hình SLA phải từ 1 đến 480 phút");
      if (!Number.isInteger(values.picker_ack_reminder_minutes) || values.picker_ack_reminder_minutes < 1 || values.picker_ack_reminder_minutes > 60) throw new HttpError(400, "Nhắc Picker phải từ 1 đến 60 phút");
      if (!Number.isInteger(values.auto_skip_after_minutes) || values.auto_skip_after_minutes < 15 || values.auto_skip_after_minutes > 4320) throw new HttpError(400, "Mốc tự động cho phép SKIP phải từ 15 phút đến 72 giờ");
      const { data, error } = await admin.from("app_config").update(values).eq("singleton", true).select("acknowledge_minutes,reminder_minutes,replenish_minutes,picker_ack_reminder_minutes,auto_skip_enabled,auto_skip_after_minutes").single();
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
        retention_days: Number(body.retention_days ?? 60), auto_skip_enabled: Boolean(body.auto_skip_enabled), auto_skip_after_minutes: Number(body.auto_skip_after_minutes ?? 120),
        staff_auto_sync_enabled: Boolean(body.staff_auto_sync_enabled ?? true), staff_sync_interval_minutes: Number(body.staff_sync_interval_minutes ?? 60),
        updated_by: context.userId, updated_at: new Date().toISOString(),
      };
      if ([values.acknowledge_minutes, values.reminder_minutes, values.replenish_minutes].some((v) => !Number.isInteger(v) || Number(v) < 1 || Number(v) > 480)) throw new HttpError(400, "Cấu hình SLA phải từ 1 đến 480 phút");
      if (!Number.isInteger(values.picker_ack_reminder_minutes) || Number(values.picker_ack_reminder_minutes) < 1 || Number(values.picker_ack_reminder_minutes) > 60) throw new HttpError(400, "Nhắc Picker phải từ 1 đến 60 phút");
      if (!Number.isInteger(values.diagnostic_log_retention_days) || Number(values.diagnostic_log_retention_days) < 1 || Number(values.diagnostic_log_retention_days) > 60) throw new HttpError(400, "Lưu log phải từ 1 đến 60 ngày");
      if (!Number.isInteger(values.retention_days) || Number(values.retention_days) < 7 || Number(values.retention_days) > 365) throw new HttpError(400, "Retention nghiệp vụ phải từ 7 đến 365 ngày");
      if (!Number.isInteger(values.auto_skip_after_minutes) || Number(values.auto_skip_after_minutes) < 15 || Number(values.auto_skip_after_minutes) > 4320) throw new HttpError(400, "Mốc tự động SKIP phải từ 15 phút đến 72 giờ");
      if (!Number.isInteger(values.staff_sync_interval_minutes) || Number(values.staff_sync_interval_minutes) < 15 || Number(values.staff_sync_interval_minutes) > 1440) throw new HttpError(400, "Chu kỳ đồng bộ nhân sự phải từ 15 phút đến 24 giờ");
      const { data, error } = await admin.from("app_config").update(values).eq("singleton", true).select().single();
      if (error) throw error;
      return data;
    }
    // Stable 1.1.x compatibility only. Detailed inventory integration is retired;
    // These routes never read credentials, sessions, source APIs, snapshots, or quantity data.
    case "inventory-status": return {
      sku: required(body.sku, "SKU"), freshness_status: "UNKNOWN", stock_status: "NO_DATA", snapshot_captured_at: null,
    };
    case "inventory-current":
      requireRole(context, ["ADMIN", "ADMIN_INVENT", "INVENT"]);
      return { items: [] };
    case "inventory-summary":
      requireRole(context, ["ADMIN", "ADMIN_INVENT"]);
      return { current_sku_count: 0, snapshot: null, jobs: [], connection: { enabled: false, status: "RETIRED" }, config: {} };
    case "inventory-sync-start":
    case "inventory-recovery-start":
    case "inventory-recovery-stage":
    case "inventory-recovery-finalize":
    case "inventory-job-cancel":
      requireRole(context, ["ADMIN", "ADMIN_INVENT"]);
      throw new HttpError(410, "Chức năng tồn kho chi tiết đã ngừng. Vui lòng dùng Danh mục SKU / Tên hàng ở phiên bản mới.");
    // Stable 1.1.x compatibility only. Detailed inventory integration is retired;
    // These routes never read credentials, sessions, source APIs, snapshots, or quantity data.
    case "inventory-status": return {
      sku: required(body.sku, "SKU"), freshness_status: "UNKNOWN", stock_status: "NO_DATA", snapshot_captured_at: null,
    };
    case "inventory-current":
      requireRole(context, ["ADMIN", "ADMIN_INVENT", "INVENT"]);
      return { items: [] };
    case "inventory-summary":
      requireRole(context, ["ADMIN", "ADMIN_INVENT"]);
      return { current_sku_count: 0, snapshot: null, jobs: [], connection: { enabled: false, status: "RETIRED" }, config: {} };
    case "inventory-sync-start":
    case "inventory-recovery-start":
    case "inventory-recovery-stage":
    case "inventory-recovery-finalize":
    case "inventory-job-cancel":
      requireRole(context, ["ADMIN", "ADMIN_INVENT"]);
      throw new HttpError(410, "Chức năng tồn kho chi tiết đã ngừng. Vui lòng dùng Danh mục SKU / Tên hàng ở phiên bản mới.");
    case "replace-catalog": return replaceCatalog(context, body);
    case "staff-sync-now": requireRole(context,["ADMIN","ADMIN_INVENT"]); return syncStaffDirectory("MANUAL",context.userId);
    case "staff-sync-status": return staffSyncStatus(context);
    case "service-metrics": return serviceMetrics(context);
    case "delete-user": return deleteManagedUser(context, body);
    case "list-users": return listUsers(context);
    case "update-user": return updateManagedUser(context, body);
    case "import-skus": {
      requireRole(context, ["ADMIN", "ADMIN_INVENT"]);
      const items = Array.isArray(body.items) ? body.items as Record<string, unknown>[] : [];
      if (!items.length || items.length > 1000) throw new HttpError(400, "Mỗi lô cần 1–1000 SKU");
      const now = new Date().toISOString();
      const rows = items.map((item) => ({ sku: required(item.sku, "SKU").trim(), product_name: required(item.product_name, "Tên sản phẩm").trim(), last_imported_at: now, updated_at: now, active: true }));
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
      requireRole(context,["ADMIN","ADMIN_INVENT"]);const now=Date.now(),since30=new Date(now-30*86400000).toISOString(),since24=new Date(now-86400000).toISOString();
      const {data,error}=await admin.from("issues").select("id,sku,status,report_count,first_reported_at,resolved_at,claimed_at,previous_issue_id,claimed_by").gte("first_reported_at",since30).limit(10000);if(error)throw error;const rows=data??[],byStatus:Record<string,number>={},skuCounts=new Map<string,number>(),durations:number[]=[],claimDurations:number[]=[],hourly=new Array(24).fill(0);
      for(const row of rows){byStatus[row.status]=(byStatus[row.status]??0)+1;skuCounts.set(row.sku,(skuCounts.get(row.sku)??0)+Number(row.report_count??1));if(row.resolved_at)durations.push((new Date(row.resolved_at).getTime()-new Date(row.first_reported_at).getTime())/60000);if(row.claimed_at)claimDurations.push((new Date(row.claimed_at).getTime()-new Date(row.first_reported_at).getTime())/60000);if(row.first_reported_at>=since24)hourly[new Date(row.first_reported_at).getHours()]+=Number(row.report_count??1);}
      const percentile=(v:number[],p:number)=>v.length?[...v].sort((a,b)=>a-b)[Math.min(v.length-1,Math.floor((v.length-1)*p))]:null;const topKeys=[...skuCounts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,20).map(([sku])=>sku),skuNames=new Map<string,string>();if(topKeys.length){const {data:c}=await admin.from("sku_catalog").select("sku,product_name").in("sku",topKeys);(c??[]).forEach((r:any)=>skuNames.set(r.sku,r.product_name));}
      const {data:cfg}=await admin.from("app_config").select("acknowledge_minutes,auto_skip_enabled,auto_skip_after_minutes").eq("singleton",true).single();const overdueCutoff=new Date(now-Math.max(1,Number(cfg?.acknowledge_minutes??15))*60000).toISOString();const {count:overdue}=await admin.from("issues").select("id",{count:"exact",head:true}).in("status",ACTIVE_STATUSES).lte("first_reported_at",overdueCutoff);const {count:autoSkipCount}=await admin.from("issue_audit").select("id",{count:"exact",head:true}).eq("action","AUTO_SKIP").gte("created_at",since30);const last24=rows.filter((r:any)=>r.first_reported_at>=since24),resolved24=last24.filter((r:any)=>r.resolved_at);
      return {days:30,issues:rows.length,reports:rows.reduce((sum,r)=>sum+Number(r.report_count??1),0),by_status:byStatus,active_now:rows.filter((r:any)=>ACTIVE_STATUSES.includes(r.status)).length,overdue_now:overdue??0,last_24h:{issues:last24.length,reports:last24.reduce((sum,r)=>sum+Number(r.report_count??1),0),resolved:resolved24.length,available:last24.filter((r:any)=>r.status==="AVAILABLE").length,skipped:last24.filter((r:any)=>r.status==="SKIP_ALLOWED").length},average_resolution_minutes:durations.length?Math.round(durations.reduce((a,b)=>a+b,0)/durations.length):null,median_resolution_minutes:percentile(durations,.5)==null?null:Math.round(percentile(durations,.5)!),p95_resolution_minutes:percentile(durations,.95)==null?null:Math.round(percentile(durations,.95)!),median_claim_minutes:percentile(claimDurations,.5)==null?null:Math.round(percentile(claimDurations,.5)!),p95_claim_minutes:percentile(claimDurations,.95)==null?null:Math.round(percentile(claimDurations,.95)!),recurrent_episodes:rows.filter((r:any)=>r.previous_issue_id).length,auto_skip_count_30d:autoSkipCount??0,auto_skip_enabled:Boolean(cfg?.auto_skip_enabled),auto_skip_after_minutes:Number(cfg?.auto_skip_after_minutes??120),top_skus:[...skuCounts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,20).map(([sku,reports])=>({sku,product_name:skuNames.get(sku)??"",reports})),hourly_reports_24h:hourly};
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
      SOURCE_MANAGED_USER: "Nhân sự đồng bộ từ Google Sheet chỉ được cập nhật từ nguồn",
      STAFF_DEFAULT_PASSWORD_NOT_CONFIGURED: "Mật khẩu mặc định nhân sự chưa được cấu hình an toàn",
      CATALOG_ROW_COUNT_INVALID: "File danh mục SKU vượt giới hạn hoặc không có dữ liệu",
      CATALOG_EMPTY: "Không tìm thấy SKU hợp lệ trong file",
    };
    const friendly = Object.entries(messages).find(([key]) => raw.includes(key))?.[1] ?? (status >= 500 ? "Lỗi máy chủ; dữ liệu hiện hành chưa bị thay đổi" : raw);
    return json({ error: friendly, code: Object.keys(messages).find((key) => raw.includes(key)) ?? undefined }, status);
  }
});
