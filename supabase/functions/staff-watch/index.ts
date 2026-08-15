import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const FIREBASE_SERVICE_ACCOUNT = Deno.env.get("FIREBASE_SERVICE_ACCOUNT") ?? "";
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const STAFF_SHEET_ID = "1HLBzpxHLd8qoTJopOA7M_q0dDvO56G0Tb4curKZV7EM";
const STAFF_SHEET_NAME = "Trang tính1";
const PROTECTED_ADMIN_CODE = "6281280";
const FIREBASE_PROJECT_ID = "bao-hang-1291";

type Role = "ADMIN" | "ADMIN_INVENT" | "PICKER";
type Staff = { employee_code: string; full_name: string; contractor: string; source_position: string; role: Role };
type Profile = {
  id: string;
  employee_code: string;
  full_name: string;
  contractor: string;
  role: string;
  active: boolean;
  source_kind: string;
  source_position: string;
  protected_account: boolean;
};
type ServiceAccount = { project_id: string; client_email: string; private_key: string };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

function normalize(value: unknown): string {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}
function staffRole(position: string, employeeCode: string): Role {
  if (employeeCode === PROTECTED_ADMIN_CODE) return "ADMIN";
  const title = normalize(position);
  return ["chuyen vien", "truong nhom", "truong kho", "truong phong"].some((prefix) => title.startsWith(prefix))
    ? "ADMIN_INVENT"
    : "PICKER";
}
function roleRank(role: string): number { return role === "ADMIN" ? 3 : role === "ADMIN_INVENT" ? 2 : 1; }
function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) { try { return JSON.stringify(error); } catch { /* ignore */ } }
  return String(error ?? "UNKNOWN");
}
function materiallyDifferent(p: Profile, s: Staff): boolean {
  return p.full_name !== s.full_name || p.contractor !== s.contractor || p.role !== s.role || p.source_position !== s.source_position || !p.active;
}
async function sha256(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function b64url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = ""; for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function pemBytes(pem: string): Uint8Array {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const raw = atob(body); return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
async function googleAccessToken(account: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    Uint8Array.from(pemBytes(account.private_key)).buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${b64url(new Uint8Array(signature))}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!response.ok) throw new Error(`SOURCE_OAUTH_${response.status}`);
  const body = await response.json();
  const token = String(body.access_token ?? "");
  if (!token) throw new Error("SOURCE_OAUTH_EMPTY_TOKEN");
  return token;
}

async function fetchFilteredStaff(): Promise<{ staff: Staff[]; sourceHash: string; responseBytes: number }> {
  if (!FIREBASE_SERVICE_ACCOUNT) throw new Error("SOURCE_SERVICE_ACCOUNT_NOT_CONFIGURED");
  let account: ServiceAccount;
  try { account = JSON.parse(FIREBASE_SERVICE_ACCOUNT) as ServiceAccount; }
  catch { throw new Error("SOURCE_SERVICE_ACCOUNT_INVALID_JSON"); }
  if (!account.client_email || !account.private_key || account.project_id !== FIREBASE_PROJECT_ID) {
    throw new Error("SOURCE_SERVICE_ACCOUNT_INVALID");
  }
  const token = await googleAccessToken(account);
  const range = encodeURIComponent(`'${STAFF_SHEET_NAME}'!A1:I2000`);
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${STAFF_SHEET_ID}/values/${range}?majorDimension=ROWS`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  const text = await response.text();
  const responseBytes = new TextEncoder().encode(text).byteLength;
  if (!response.ok) {
    let reason = "UNKNOWN";
    try {
      const body = JSON.parse(text);
      reason = String(body?.error?.details?.[0]?.reason ?? body?.error?.errors?.[0]?.reason ?? body?.error?.status ?? "UNKNOWN");
    } catch { /* ignore */ }
    const safe = reason.toUpperCase().replace(/[^A-Z0-9_:-]/g, "_").slice(0, 80);
    throw new Error(`SOURCE_SHEETS_${response.status}_${safe}`);
  }
  let body: any;
  try { body = JSON.parse(text); } catch { throw new Error("SOURCE_SHEETS_INVALID_JSON"); }
  const rows: unknown[][] = Array.isArray(body?.values) ? body.values.slice(1) : [];
  const byCode = new Map<string, Staff>();
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    if (String(row[0] ?? "").trim() !== "Kho Yên Mỹ - Hưng Yên") continue;
    if (String(row[1] ?? "").trim() !== "1291") continue;
    if (normalize(row[8]) !== "đang lam viec") continue;
    const employeeCode = String(row[3] ?? "").trim();
    const fullName = String(row[4] ?? "").trim();
    if (!employeeCode || !fullName || !/^[a-z0-9._-]+$/i.test(employeeCode)) continue;
    const contractor = String(row[2] ?? "").trim();
    const sourcePosition = String(row[5] ?? "").trim();
    byCode.set(employeeCode.toLowerCase(), {
      employee_code: employeeCode,
      full_name: fullName,
      contractor,
      source_position: sourcePosition,
      role: staffRole(sourcePosition, employeeCode),
    });
  }
  if (!byCode.size) throw new Error("SOURCE_EMPTY_ACTIVE_1291");
  const staff = [...byCode.values()].sort((a, b) => a.employee_code.localeCompare(b.employee_code));
  const canonical = staff.map((item) => `${item.employee_code}|${item.full_name}|${item.contractor}|${item.source_position}|${item.role}`).join("\n");
  return { staff, sourceHash: await sha256(canonical), responseBytes };
}

async function defaultPassword(_employeeCode: string, _adminEmployeeCode?: string): Promise<string> {
  const { data, error } = await admin.rpc("get_staff_default_password_service");
  const password = String(data ?? "");
  if (error || password.length < 8) throw new Error("STAFF_DEFAULT_PASSWORD_NOT_CONFIGURED");
  return password;
}

async function writeAudit(runId: string, employeeCode: string, action: string, before: unknown, after: unknown, ok: boolean, error?: string) {
  await admin.from("staff_sync_audit").insert({
    run_id: runId,
    employee_code: employeeCode || null,
    action,
    before_row: before ?? null,
    after_row: after ?? null,
    success: ok,
    error: error?.slice(0, 500) ?? null,
  });
}

async function createStaff(runId: string, s: Staff): Promise<{ ok: boolean; id?: string; error?: string }> {
  const email = `${s.employee_code.toLowerCase()}@bao-hang-1291.local`;
  try {
    const password = await defaultPassword(s.employee_code);
    const { data: authData, error: authError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (authError || !authData.user) throw authError ?? new Error("AUTH_CREATE_FAILED");
    const id = authData.user.id;
    const { error: profileError } = await admin.from("profiles").upsert({
      id,
      employee_code: s.employee_code,
      full_name: s.full_name,
      contractor: s.contractor,
      role: s.role,
      active: true,
      source_kind: "GSHEET",
      source_position: s.source_position,
      protected_account: s.employee_code === PROTECTED_ADMIN_CODE,
      source_last_seen_at: new Date().toISOString(),
    }, { onConflict: "id" });
    if (profileError) {
      await admin.auth.admin.deleteUser(id).catch(() => undefined);
      throw profileError;
    }
    await writeAudit(runId, s.employee_code, "CREATE", null, s, true);
    return { ok: true, id };
  } catch (error) {
    const text = errorText(error);
    await writeAudit(runId, s.employee_code, "CREATE", null, s, false, text);
    return { ok: false, error: text };
  }
}

async function updateStaff(runId: string, current: Profile, s: Staff): Promise<{ ok: boolean; error?: string }> {
  try {
    const protectedAccount = current.protected_account || s.employee_code === PROTECTED_ADMIN_CODE;
    if (protectedAccount && roleRank(s.role) < roleRank(current.role)) {
      throw new Error("PROTECTED_ACCOUNT_ROLE_DOWNGRADE_BLOCKED");
    }
    const patch = {
      full_name: s.full_name,
      contractor: s.contractor,
      role: protectedAccount && roleRank(current.role) > roleRank(s.role) ? current.role : s.role,
      active: true,
      source_kind: protectedAccount ? current.source_kind : "GSHEET",
      source_position: s.source_position,
      protected_account: protectedAccount,
      source_last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const { error } = await admin.from("profiles").update(patch).eq("id", current.id);
    if (error) throw error;
    await writeAudit(runId, s.employee_code, "UPDATE", current, patch, true);
    return { ok: true };
  } catch (error) {
    const text = errorText(error);
    await writeAudit(runId, s.employee_code, "UPDATE", current, s, false, text);
    return { ok: false, error: text };
  }
}

async function deactivateStaff(runId: string, current: Profile): Promise<{ ok: boolean; error?: string }> {
  if (current.protected_account || current.employee_code === PROTECTED_ADMIN_CODE) {
    await writeAudit(runId, current.employee_code, "PROTECTED_SKIP_DEACTIVATE", current, null, true);
    return { ok: true };
  }
  try {
    const { data: sessions } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const authUser = sessions?.users?.find((u) => u.id === current.id);
    if (authUser) {
      const { error: authError } = await admin.auth.admin.updateUserById(current.id, { ban_duration: "876000h" });
      if (authError) throw authError;
    }
    const { error } = await admin.from("profiles").update({ active: false, updated_at: new Date().toISOString() }).eq("id", current.id);
    if (error) throw error;
    await writeAudit(runId, current.employee_code, "DEACTIVATE", current, { active: false }, true);
    return { ok: true };
  } catch (error) {
    const text = errorText(error);
    await writeAudit(runId, current.employee_code, "DEACTIVATE", current, null, false, text);
    return { ok: false, error: text };
  }
}

async function runWatch(triggerSource: string) {
  const startedAt = new Date().toISOString();
  const { staff, sourceHash, responseBytes } = await fetchFilteredStaff();
  const { data: lastRun } = await admin.from("staff_sync_runs").select("source_hash").in("status", ["SUCCEEDED", "NO_CHANGE"]).order("started_at", { ascending: false }).limit(1).maybeSingle();
  const { data: run, error: runError } = await admin.from("staff_sync_runs").insert({
    trigger_source: triggerSource,
    status: lastRun?.source_hash === sourceHash ? "NO_CHANGE" : "RUNNING",
    source_hash: sourceHash,
    source_rows: staff.length,
    eligible_rows: staff.length,
    source_sheet_id: STAFF_SHEET_ID,
    source_response_bytes: responseBytes,
    started_at: startedAt,
  }).select("id").single();
  if (runError || !run) throw runError ?? new Error("RUN_CREATE_FAILED");
  const runId = run.id as string;

  if (lastRun?.source_hash === sourceHash) {
    await admin.from("staff_sync_runs").update({ status: "NO_CHANGE", finished_at: new Date().toISOString() }).eq("id", runId);
    return { status: "NO_CHANGE", changed: false, source_rows: staff.length, eligible_rows: staff.length };
  }

  const { data: profiles, error: profilesError } = await admin.from("profiles").select("id,employee_code,full_name,contractor,role,active,source_kind,source_position,protected_account");
  if (profilesError) throw profilesError;
  const currentByCode = new Map<string, Profile>((profiles ?? []).map((p: Profile) => [p.employee_code.toLowerCase(), p]));
  const seen = new Set<string>();
  let created = 0, updated = 0, deactivated = 0, failed = 0;
  const errors: string[] = [];

  for (const s of staff) {
    const key = s.employee_code.toLowerCase();
    seen.add(key);
    const current = currentByCode.get(key);
    if (!current) {
      const r = await createStaff(runId, s);
      if (r.ok) created++; else { failed++; if (r.error) errors.push(`${s.employee_code}: ${r.error}`); }
      continue;
    }
    if (materiallyDifferent(current, s)) {
      const r = await updateStaff(runId, current, s);
      if (r.ok) updated++; else { failed++; if (r.error) errors.push(`${s.employee_code}: ${r.error}`); }
    } else {
      await admin.from("profiles").update({ source_last_seen_at: new Date().toISOString() }).eq("id", current.id);
    }
  }

  if (failed === 0) for (const current of currentByCode.values()) {
    if (current.source_kind !== "GSHEET" || !current.active || seen.has(current.employee_code.toLowerCase())) continue;
    const r = await deactivateStaff(runId, current);
    if (r.ok) deactivated++; else { failed++; if (r.error) errors.push(`${current.employee_code}: ${r.error}`); }
  }

  const status = failed === 0 ? "SUCCEEDED" : "PARTIAL";
  await admin.from("staff_sync_runs").update({
    status,
    created_count: created,
    updated_count: updated,
    deactivated_count: deactivated,
    failed_count: failed,
    error_summary: errors.slice(0, 20).join(" | "),
    finished_at: new Date().toISOString(),
  }).eq("id", runId);
  return { status, changed: true, source_rows: staff.length, eligible_rows: staff.length, created, updated, deactivated, failed };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const isCron = req.headers.get("x-cron-secret") === CRON_SECRET && Boolean(CRON_SECRET);
    let isAdmin = false;
    if (!isCron) {
      const authorization = req.headers.get("authorization") ?? "";
      if (!authorization.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
      const token = authorization.slice("Bearer ".length).trim();
      const { data: { user }, error } = await admin.auth.getUser(token);
      if (error || !user) return json({ error: "Unauthorized" }, 401);
      const { data: profile } = await admin.from("profiles").select("role,active").eq("id", user.id).single();
      isAdmin = Boolean(profile?.active && profile.role === "ADMIN");
      if (!isAdmin) return json({ error: "Forbidden" }, 403);
    }
    const result = await runWatch(isCron ? "AUTO" : "MANUAL");
    return json(result);
  } catch (error) {
    const message = errorText(error);
    if (message.startsWith("SOURCE_")) {
      const errorCode = message.replace(/[^A-Z0-9_:-]/gi, "_").slice(0, 120);
      console.warn("staff-watch source degraded", errorCode);
      return json({
        status: "DEGRADED_SOURCE_UNAVAILABLE",
        changed: false,
        preserved_existing_profiles: true,
        error_code: errorCode,
      });
    }
    console.error("staff-watch", error);
    return json({ error: "STAFF_WATCH_FAILED" }, 500);
  }
});
