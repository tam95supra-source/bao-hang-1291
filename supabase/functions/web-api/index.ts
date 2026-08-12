import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const productionOrigins = new Set([
  "https://bao-hang-1291.web.app",
  "https://bao-hang-1291.firebaseapp.com",
]);
const previewOrigin = /^https:\/\/bao-hang-1291--[a-z0-9-]+\.web\.app$/i;
const forwardedActions = new Set([
  "get-config",
  "save-config",
  "import-skus",
  "import-users",
  "sync-google-sheet",
]);

function isAllowedOrigin(origin: string): boolean {
  return productionOrigins.has(origin) || previewOrigin.test(origin);
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const headers: Record<string, string> = {
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, apikey, content-type",
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

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function requireAdmin(req: Request) {
  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) throw new HttpError(401, "Phiên đăng nhập không hợp lệ");
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) throw new HttpError(401, "Phiên đăng nhập đã hết hạn");
  const { data: profile, error: profileError } = await admin.from("profiles")
    .select("id,employee_code,full_name,role,active")
    .eq("id", user.id).single();
  if (profileError || !profile?.active) throw new HttpError(403, "Tài khoản đã ngừng hoạt động");
  if (profile.role !== "INVENT_ADMIN") throw new HttpError(403, "Web quản trị chỉ dành cho INVENT ADMIN");
  return { user, profile };
}

async function adminSummary(req: Request) {
  await requireAdmin(req);
  const [sku, profiles, activeUsers, activeIssues, pendingSheet] = await Promise.all([
    admin.from("sku_catalog").select("sku", { count: "exact", head: true }),
    admin.from("profiles").select("id", { count: "exact", head: true }),
    admin.from("profiles").select("id", { count: "exact", head: true }).eq("active", true),
    admin.from("issues").select("id", { count: "exact", head: true })
      .in("status", ["OPEN", "CLAIMED", "SEARCHING", "REPLENISHING"]),
    admin.from("sheet_export_queue").select("id", { count: "exact", head: true }).is("exported_at", null),
  ]);
  for (const result of [sku, profiles, activeUsers, activeIssues, pendingSheet]) {
    if (result.error) throw result.error;
  }
  return {
    sku_count: sku.count ?? 0,
    profile_count: profiles.count ?? 0,
    active_user_count: activeUsers.count ?? 0,
    active_issue_count: activeIssues.count ?? 0,
    pending_sheet_count: pendingSheet.count ?? 0,
  };
}

async function adminUserIndex(req: Request) {
  await requireAdmin(req);
  const { data, error, count } = await admin.from("profiles")
    .select("employee_code", { count: "exact" }).order("employee_code").limit(5000);
  if (error) throw error;
  if ((count ?? 0) > 5000) throw new HttpError(409, "Số nhân sự vượt ngưỡng preview 5000 tài khoản");
  return { employee_codes: (data ?? []).map((row) => row.employee_code), count: count ?? 0 };
}

async function forwardToApi(req: Request, action: string): Promise<Response> {
  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) throw new HttpError(401, "Phiên đăng nhập không hợp lệ");
  const body = await req.text();
  const response = await fetch(`${SUPABASE_URL}/functions/v1/api/${action}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": authorization,
      "apikey": ANON_KEY,
    },
    body: body || "{}",
  });
  return new Response(await response.text(), {
    status: response.status,
    headers: {
      ...corsHeaders(req),
      "content-type": response.headers.get("content-type") ?? "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

Deno.serve(async (req) => {
  try {
    const origin = req.headers.get("origin");
    if (origin && !isAllowedOrigin(origin)) return json(req, { error: "Nguồn web không được phép" }, 403);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
    if (req.method !== "POST") throw new HttpError(405, "Chỉ hỗ trợ POST");

    const segments = new URL(req.url).pathname.split("/").filter(Boolean);
    const action = segments.at(-1) ?? "";
    if (forwardedActions.has(action)) return await forwardToApi(req, action);
    if (action === "admin-summary") return json(req, await adminSummary(req));
    if (action === "admin-user-index") return json(req, await adminUserIndex(req));
    throw new HttpError(404, "Không tìm thấy chức năng web");
  } catch (error) {
    console.error(error);
    const status = error instanceof HttpError ? error.status : 500;
    return json(req, { error: errorText(error) }, status);
  }
});
