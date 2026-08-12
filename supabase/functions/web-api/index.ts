import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

type Role = "ADMIN" | "ADMIN_INVENT" | "INVENT" | "PICKER";
const productionOrigins = new Set(["https://bao-hang-1291.web.app", "https://bao-hang-1291.firebaseapp.com"]);
const previewOrigin = /^https:\/\/bao-hang-1291--[a-z0-9-]+\.web\.app$/i;
const forwardedActions = new Set([
  "session-profile", "search-skus", "report-shortage", "active-issues", "issue-board", "my-issues", "issue-detail",
  "claim-issue", "reassign-issue", "update-issue", "pending-alerts", "mark-alert-received", "mark-alert-displayed", "ack-alert",
  "get-operational-config", "save-operational-config", "get-config", "save-config",
  "import-skus", "replace-catalog", "import-users", "list-users", "update-user", "delete-user",
  "staff-sync-now", "staff-sync-status", "service-metrics",
  "sync-google-sheet", "reports-summary", "issue-history", "audit-history", "upload-log", "list-logs", "download-log"
]);
function isAllowedOrigin]);
function isAllowedOrigin(origin: string): boolean { return productionOrigins.has(origin) || previewOrigin.test(origin); }
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
    headers: { ...corsHeaders(req), "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

async function requireWebUser(req: Request) {
  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) throw new HttpError(401, "Phiên đăng nhập không hợp lệ");
  const client = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) throw new HttpError(401, "Phiên đăng nhập đã hết hạn");
  const { data: profile, error: profileError } = await admin.from("profiles").select("id,employee_code,full_name,role,active").eq("id", user.id).single();
  if (profileError || !profile?.active) throw new HttpError(403, "Tài khoản đã ngừng hoạt động");
  const testRole = String(req.headers.get("x-admin-test-role") ?? "").trim().toUpperCase();
  const allowedTest = ["ADMIN_INVENT", "INVENT", "PICKER"];
  if (testRole && (profile.role !== "ADMIN" || !allowedTest.includes(testRole))) throw new HttpError(403, "Chế độ kiểm thử quyền không hợp lệ");
  return { user, profile, effectiveRole: (testRole || profile.role) as Role };
}
async function adminSummary(req: Request) {
  const ctx=await requireWebUser(req);if(!["ADMIN","ADMIN_INVENT"].includes(ctx.effectiveRole))throw new HttpError(403,"Bạn không có quyền xem tổng quan quản trị");
  const [sku,profiles,activeUsers,openIssues,claimedIssues,pendingSheet,logs,staffRun]=await Promise.all([
    admin.from("sku_catalog").select("sku",{count:"exact",head:true}).eq("active",true),admin.from("profiles").select("id",{count:"exact",head:true}),admin.from("profiles").select("id",{count:"exact",head:true}).eq("active",true),admin.from("issues").select("id",{count:"exact",head:true}).eq("status","OPEN"),admin.from("issues").select("id",{count:"exact",head:true}).in("status",["CLAIMED","SEARCHING","REPLENISHING"]),admin.from("sheet_export_queue").select("id",{count:"exact",head:true}).is("exported_at",null),admin.from("diagnostic_logs").select("id",{count:"exact",head:true}),admin.from("staff_sync_runs").select("status,finished_at,eligible_rows,failed_count").order("started_at",{ascending:false}).limit(1).maybeSingle()]);
  for(const r of [sku,profiles,activeUsers,openIssues,claimedIssues,pendingSheet,logs,staffRun])if(r.error)throw r.error;
  return {sku_count:sku.count??0,profile_count:profiles.count??0,active_user_count:activeUsers.count??0,open_issue_count:openIssues.count??0,claimed_issue_count:claimedIssues.count??0,active_issue_count:(openIssues.count??0)+(claimedIssues.count??0),pending_sheet_count:pendingSheet.count??0,diagnostic_log_count:logs.count??0,staff_sync:staffRun.data??null};
}
async function adminUserIndex(req: Request) {
  const ctx = await requireWebUser(req);
  if (!["ADMIN", "ADMIN_INVENT"].includes(ctx.effectiveRole)) throw new HttpError(403, "Bạn không có quyền xem danh sách nhân sự quản lý");
  let query = admin.from("profiles").select("employee_code,role", { count: "exact" }).order("employee_code").limit(5000);
  if (ctx.effectiveRole === "ADMIN_INVENT") query = query.in("role", ["INVENT", "PICKER"]);
  const { data, error, count } = await query;
  if (error) throw error;
  if ((count ?? 0) > 5000) throw new HttpError(409, "Số nhân sự vượt ngưỡng preview 5000 tài khoản");
  return { users: data ?? [], employee_codes: (data ?? []).map((row) => row.employee_code), count: count ?? 0 };
}
async function forwardToApi(req: Request, action: string): Promise<Response> {
  await requireWebUser(req);
  const authorization = req.headers.get("authorization") ?? "";
  const body = await req.text();
  const headers: Record<string, string> = { "content-type": "application/json", authorization, apikey: ANON_KEY };
  const testRole = req.headers.get("x-admin-test-role");
  if (testRole) headers["x-admin-test-role"] = testRole;
  const response = await fetch(`${SUPABASE_URL}/functions/v1/api/${action}`, { method: "POST", headers, body: body || "{}" });
  return new Response(await response.text(), {
    status: response.status,
    headers: { ...corsHeaders(req), "content-type": response.headers.get("content-type") ?? "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

Deno.serve(async (req) => {
  try {
    const origin = req.headers.get("origin");
    if (origin && !isAllowedOrigin(origin)) return json(req, { error: "Nguồn web không được phép" }, 403);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
    if (req.method !== "POST") throw new HttpError(405, "Chỉ hỗ trợ POST");
    const action = new URL(req.url).pathname.split("/").filter(Boolean).at(-1) ?? "";
    if (forwardedActions.has(action)) return await forwardToApi(req, action);
    if (action === "admin-summary") return json(req, await adminSummary(req));
    if (action === "admin-user-index") return json(req, await adminUserIndex(req));
    throw new HttpError(404, "Không tìm thấy chức năng web");
  } catch (error) {
    console.error(error);
    return json(req, { error: errorText(error) }, error instanceof HttpError ? error.status : 500);
  }
});
