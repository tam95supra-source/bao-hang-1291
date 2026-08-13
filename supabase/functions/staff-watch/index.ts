import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const STAFF_SHEET_ID = "1FRROqCp1lmkuHc3lc4UBpVI5_ZrtiPI1thlEymv458E";
const STAFF_SHEET_NAME = "DANH MỤC NHÂN SỰ";
const PROTECTED_ADMIN_CODE = "6281280";

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

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
function normalize(value: string): string {
  return value.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/đ/g, "d").replace(/\s+/g, " ").trim();
}
function employeeEmail(code: string): string {
  const raw = code.trim().toLowerCase();
  if (!/^[a-z0-9._-]+$/.test(raw)) throw new Error(`INVALID_EMPLOYEE_CODE:${code}`);
  return `${raw}@bao-hang-1291.local`;
}
function staffRole(position: string, employeeCode: string): Role {
  if (employeeCode === PROTECTED_ADMIN_CODE) return "ADMIN";
  return ["chuyen vien", "truong nhom", "truong kho"].includes(normalize(position)) ? "ADMIN_INVENT" : "PICKER";
}
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (quoted) {
      if (c === '"' && n === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ""; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell.length || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
  return rows;
}
async function sha256(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function fetchFilteredStaff(): Promise<{ staff: Staff[]; sourceHash: string; responseBytes: number }> {
  const queryVariants = [
    "select A,B,D,E where G = 1291 and H = 'HY1'",
    "select A,B,D,E where G = '1291' and H = 'HY1'",
  ];
  let lastError = "";
  for (const query of queryVariants) {
    try {
      const params = new URLSearchParams({ tqx: "out:csv", sheet: STAFF_SHEET_NAME, tq: query });
      const url = `https://docs.google.com/spreadsheets/d/${STAFF_SHEET_ID}/gviz/tq?${params.toString()}`;
      const response = await fetch(url, { headers: { accept: "text/csv" }, redirect: "follow" });
      if (!response.ok) { lastError = `Google Sheet HTTP ${response.status}`; continue; }
      const text = await response.text();
      if (!text || text.length > 1_000_000) { lastError = "Nguồn nhân sự rỗng hoặc vượt giới hạn watcher"; continue; }
      const rows = parseCsv(text);
      if (rows.length < 2) { lastError = "Query lọc không trả về nhân sự"; continue; }
      const byCode = new Map<string, Staff>();
      for (const row of rows.slice(1)) {
        const employeeCode = String(row[0] ?? "").trim();
        const fullName = String(row[1] ?? "").trim();
        if (!employeeCode || !fullName) continue;
        const contractor = String(row[2] ?? "").trim();
        const sourcePosition = String(row[3] ?? "").trim();
        byCode.set(employeeCode.toLowerCase(), {
          employee_code: employeeCode,
          full_name: fullName,
          contractor,
          source_position: sourcePosition,
          role: staffRole(sourcePosition, employeeCode),
        });
      }
      if (!byCode.size) { lastError = "Không có nhân sự Site 1291 / Kho HY1"; continue; }
      const staff = [...byCode.values()].sort((a, b) => a.employee_code.localeCompare(b.employee_code));
      const canonical = staff.map((item) => `${item.employee_code}|${item.full_name}|${item.contractor}|${item.source_position}|${item.role}`).join("\n");
      return { staff, sourceHash: await sha256(canonical), responseBytes: new TextEncoder().encode(text).byteLength };
    } catch (error) { lastError = errorText(error); }
  }
  throw new Error(lastError || "Không đọc được nguồn nhân sự đã lọc");
}
async function defaultPassword(): Promise<string> {
  const { data, error } = await admin.rpc("get_staff_default_password_service");
  if (error) throw error;
  const value = String(data ?? "");
  if (value.length < 8) throw new Error("STAFF_DEFAULT_PASSWORD_NOT_CONFIGURED");
  return value;
}
function materiallyDifferent(old: Profile, staff: Staff): boolean {
  return old.employee_code !== staff.employee_code ||
    old.full_name !== staff.full_name ||
    old.contractor !== staff.contractor ||
    old.role !== staff.role ||
    old.active !== true ||
    old.source_kind !== "GSHEET" ||
    (old.source_position ?? "") !== staff.source_position;
}
async function enqueue(profile: Record<string, unknown>) {
  const { error } = await admin.from("sheet_export_queue").insert({ event_type: "USER_UPSERT", payload: profile });
  if (error) console.warn("Staff watcher report queue deferred", errorText(error));
}
async function runWatch() {
  const { staff, sourceHash, responseBytes } = await fetchFilteredStaff();
  const { data: last, error: lastError } = await admin.from("staff_sync_runs")
    .select("source_hash").in("status", ["SUCCEEDED", "NO_CHANGE"]).order("finished_at", { ascending: false }).limit(1).maybeSingle();
  if (lastError) throw lastError;
  if (last?.source_hash === sourceHash) return { status: "NO_CHANGE", changed: false, eligible_rows: staff.length, source_bytes: responseBytes };

  const { data: running, error: runningError } = await admin.from("staff_sync_runs")
    .select("id,started_at").eq("status", "RUNNING").gte("started_at", new Date(Date.now() - 15 * 60_000).toISOString()).limit(1).maybeSingle();
  if (runningError) throw runningError;
  if (running) return { status: "RUNNING", changed: true, run_id: running.id, reused: true };

  const { data: run, error: runError } = await admin.from("staff_sync_runs").insert({
    trigger_source: "AUTO",
    source_sheet_id: STAFF_SHEET_ID,
  }).select().single();
  if (runError || !run) throw runError ?? new Error("Không tạo được phiên đồng bộ nhân sự");

  let created = 0, updated = 0, deactivated = 0, failed = 0;
  const failures: string[] = [];
  try {
    const { data: profiles, error: profilesError } = await admin.from("profiles")
      .select("id,employee_code,full_name,contractor,role,active,source_kind,source_position,protected_account").limit(10_000);
    if (profilesError) throw profilesError;
    const existing = new Map<string, Profile>((profiles ?? []).map((profile) => [String(profile.employee_code).toLowerCase(), profile as Profile]));
    const seen = new Set<string>();
    let cachedPassword = "";

    for (const item of staff) {
      const key = item.employee_code.toLowerCase();
      seen.add(key);
      try {
        const old = existing.get(key);
        if (old) {
          if (item.employee_code !== PROTECTED_ADMIN_CODE && (old.protected_account || old.role === "ADMIN")) continue;
          if (!materiallyDifferent(old, item) && !(item.employee_code === PROTECTED_ADMIN_CODE && !old.protected_account)) continue;
          const values = {
            employee_code: item.employee_code,
            full_name: item.full_name,
            contractor: item.contractor,
            role: item.role,
            active: true,
            source_kind: "GSHEET",
            source_position: item.source_position,
            source_last_seen_at: new Date().toISOString(),
            protected_account: item.employee_code === PROTECTED_ADMIN_CODE,
            updated_at: new Date().toISOString(),
          };
          const { error } = await admin.from("profiles").update(values).eq("id", old.id);
          if (error) throw error;
          updated++;
          await enqueue({ id: old.id, ...values });
          continue;
        }
        if (!cachedPassword) cachedPassword = await defaultPassword();
        const { data: authData, error: authError } = await admin.auth.admin.createUser({
          email: employeeEmail(item.employee_code), password: cachedPassword, email_confirm: true,
        });
        if (authError || !authData.user) throw authError ?? new Error("Không tạo được tài khoản đăng nhập");
        const values = {
          id: authData.user.id,
          employee_code: item.employee_code,
          full_name: item.full_name,
          contractor: item.contractor,
          role: item.role,
          active: true,
          source_kind: "GSHEET",
          source_position: item.source_position,
          source_last_seen_at: new Date().toISOString(),
          protected_account: item.employee_code === PROTECTED_ADMIN_CODE,
          updated_at: new Date().toISOString(),
        };
        const { error: insertError } = await admin.from("profiles").insert(values);
        if (insertError) {
          const { error: cleanupError } = await admin.auth.admin.deleteUser(authData.user.id);
          if (cleanupError) console.error("Staff watcher auth rollback failed", errorText(cleanupError));
          throw insertError;
        }
        created++;
        await enqueue(values);
      } catch (error) {
        failed++;
        failures.push(`${item.employee_code}: ${errorText(error)}`);
      }
    }

    if (failed === 0) {
      for (const old of existing.values()) {
        const key = String(old.employee_code).toLowerCase();
        if (old.source_kind !== "GSHEET" || old.protected_account || old.employee_code === PROTECTED_ADMIN_CODE || seen.has(key) || !old.active) continue;
        const { error } = await admin.from("profiles").update({ active: false, updated_at: new Date().toISOString() }).eq("id", old.id);
        if (error) { failed++; failures.push(`${old.employee_code}: ${errorText(error)}`); continue; }
        deactivated++;
        await enqueue({ id: old.id, employee_code: old.employee_code, full_name: old.full_name, contractor: old.contractor, role: old.role, active: false });
      }
    }

    const { error: adminProtectError } = await admin.from("profiles")
      .update({ role: "ADMIN", active: true, protected_account: true }).eq("employee_code", PROTECTED_ADMIN_CODE);
    if (adminProtectError) throw adminProtectError;
    const status = failed ? "PARTIAL" : "SUCCEEDED";
    const { error: finishError } = await admin.from("staff_sync_runs").update({
      status,
      source_hash: sourceHash,
      source_rows: staff.length,
      eligible_rows: staff.length,
      created_count: created,
      updated_count: updated,
      deactivated_count: deactivated,
      failed_count: failed,
      error_summary: failures.slice(0, 20).join("; ").slice(0, 3000),
      finished_at: new Date().toISOString(),
    }).eq("id", run.id);
    if (finishError) throw finishError;
    return { status, changed: true, run_id: run.id, eligible_rows: staff.length, source_bytes: responseBytes, created, updated, deactivated, failed };
  } catch (error) {
    await admin.from("staff_sync_runs").update({
      status: "FAILED", failed_count: Math.max(1, failed), error_summary: errorText(error).slice(0, 3000), finished_at: new Date().toISOString(),
    }).eq("id", run.id);
    throw error;
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { status: 405, headers: { "content-type": "application/json" } });
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) return new Response(JSON.stringify({ error: "FORBIDDEN" }), { status: 403, headers: { "content-type": "application/json" } });
  try {
    return new Response(JSON.stringify(await runWatch()), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch (error) {
    console.error("staff-watch", error);
    return new Response(JSON.stringify({ error: "STAFF_WATCH_FAILED" }), { status: 500, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  }
});
