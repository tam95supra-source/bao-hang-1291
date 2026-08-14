import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const SHEET_URL = Deno.env.get("GOOGLE_SHEET_WEBHOOK_URL") ?? "";
const SHEET_SECRET = Deno.env.get("GOOGLE_SHEET_WEBHOOK_SECRET") ?? "";
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const MAX_BATCH = 200;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

async function sheet(body: Record<string, unknown>): Promise<any> {
  const response = await fetch(SHEET_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ secret: SHEET_SECRET, ...body }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`SHEET_HTTP_${response.status}`);
  const result = JSON.parse(text);
  if (result?.ok !== true) throw new Error(`SHEET_REJECTED:${String(result?.error ?? "UNKNOWN").slice(0,120)}`);
  return result;
}

async function setCursor(fields: Record<string, unknown>) {
  const { error } = await admin.from("sheet_recovery_cursor").update({ ...fields, updated_at: new Date().toISOString() }).eq("singleton", true);
  if (error) throw error;
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) return json({ error: "Unauthorized" }, 403);
    if (!SHEET_URL || !SHEET_SECRET) return json({ error: "Sheet recovery not configured" }, 503);

    await sheet({ mode: "recovery_state", state: "RECOVERY_IMPORTING" });
    const { data: cursor, error: cursorError } = await admin.from("sheet_recovery_cursor")
      .select("imported_sequence,acknowledged_sequence,state").eq("singleton", true).single();
    if (cursorError) throw cursorError;
    if (cursor.state === "BLOCKED") await sheet({ mode: "recovery_state", state: "RECOVERY_BLOCKED" }); return json({ ok: false, blocked: true, cursor }, 409);

    const startSequence = Number(cursor.acknowledged_sequence ?? 0);
    const pull = await sheet({ mode: "fallback_pull", after_sequence: startSequence, limit: MAX_BATCH });
    const events = Array.isArray(pull.events) ? pull.events : [];
    if (!events.length) {
      await setCursor({ state: "CAUGHT_UP", imported_sequence: Math.max(Number(cursor.imported_sequence ?? 0), startSequence), last_success_at: new Date().toISOString(), last_error_code: null, last_error_detail: null });
      await sheet({ mode: "recovery_state", state: "SERVICE_CAUGHT_UP" });
      return json({ ok: true, imported: 0, acknowledged: 0, cursor: startSequence, caught_up: true });
    }

    events.sort((a: any, b: any) => Number(a.sheet_sequence ?? 0) - Number(b.sheet_sequence ?? 0));
    let expected = startSequence + 1;
    const acks: Record<string, unknown>[] = [];
    let lastImported = startSequence;

    await setCursor({ state: "IMPORTING" });
    for (const event of events) {
      const sequence = Number(event.sheet_sequence ?? 0);
      if (!Number.isFinite(sequence) || sequence !== expected) {
        await setCursor({ state: "BLOCKED", last_error_at: new Date().toISOString(), last_error_code: "SHEET_SEQUENCE_GAP", last_error_detail: `expected=${expected},got=${sequence}` });
        await sheet({ mode: "recovery_state", state: "RECOVERY_BLOCKED" }); return json({ ok: false, blocked: true, error: "SHEET_SEQUENCE_GAP", expected, got: sequence }, 409);
      }
      const { data, error } = await admin.rpc("import_authority_event_service", { p_event: event });
      if (error) {
        await setCursor({ state: "BLOCKED", last_error_at: new Date().toISOString(), last_error_code: "IMPORT_RPC_ERROR", last_error_detail: error.message.slice(0,500) });
        await sheet({ mode: "recovery_state", state: "RECOVERY_BLOCKED" }); return json({ ok: false, blocked: true, error: "IMPORT_RPC_ERROR", sequence }, 409);
      }
      if (data?.ok !== true) {
        await setCursor({ state: "BLOCKED", imported_sequence: lastImported, last_error_at: new Date().toISOString(), last_error_code: String(data?.error_code ?? "IMPORT_BLOCKED"), last_error_detail: String(data?.error ?? "blocked").slice(0,500) });
        await sheet({ mode: "recovery_state", state: "RECOVERY_BLOCKED" }); return json({ ok: false, blocked: true, sequence, event_id: event.event_id, error_code: data?.error_code ?? "IMPORT_BLOCKED" }, 409);
      }
      lastImported = sequence;
      expected++;
      acks.push({
        event_id: String(event.event_id),
        sheet_sequence: sequence,
        accepted_at_sheet: String(event.sheet_ack_at ?? event.accepted_at_authority ?? ""),
        service_ack_at: new Date().toISOString(),
        reconciliation_status: "SERVICE_ACKED",
        service_issue_id: String(data.issue_id ?? event.issue_id ?? ""),
      });
      await setCursor({ imported_sequence: lastImported, state: "IMPORTING", last_success_at: new Date().toISOString(), last_error_code: null, last_error_detail: null });
    }

    const ackResult = await sheet({ mode: "fallback_ack", acks });
    const acknowledged = Number(ackResult.acknowledged ?? 0);
    if (acknowledged < acks.length) {
      await setCursor({ state: "IMPORTING", last_error_at: new Date().toISOString(), last_error_code: "SHEET_ACK_INCOMPLETE", last_error_detail: `requested=${acks.length},acknowledged=${acknowledged}` });
      return json({ ok: false, imported: acks.length, acknowledged, retry_ack: true }, 503);
    }

    const caughtUp = events.length < MAX_BATCH;
    await setCursor({ acknowledged_sequence: lastImported, imported_sequence: lastImported, state: caughtUp ? "CAUGHT_UP" : "IMPORTING", last_success_at: new Date().toISOString(), last_error_code: null, last_error_detail: null });
    await sheet({ mode: "recovery_state", state: caughtUp ? "SERVICE_CAUGHT_UP" : "RECOVERY_IMPORTING" });
    return json({ ok: true, imported: acks.length, acknowledged, cursor: lastImported, caught_up: caughtUp });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0,500) : "UNKNOWN";
    console.error(message);
    await setCursor({ state: "IMPORTING", last_error_at: new Date().toISOString(), last_error_code: "RECOVERY_TRANSPORT_ERROR", last_error_detail: message }).catch(() => undefined);
    return json({ ok: false, error: "Recovery importer failed" }, 500);
  }
});
