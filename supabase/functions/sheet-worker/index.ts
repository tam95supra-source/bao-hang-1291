import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const SHEET_URL = Deno.env.get("GOOGLE_SHEET_WEBHOOK_URL") ?? "";
const SHEET_SECRET = Deno.env.get("GOOGLE_SHEET_WEBHOOK_SECRET") ?? "";
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const MAX_EVENTS = 500;
const MAX_BODY_BYTES = 1_800_000;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

function boundedBatch(events: Record<string, unknown>[]): Record<string, unknown>[] {
  const batch: Record<string, unknown>[] = [];
  let bytes = 32;
  for (const event of events) {
    const encoded = new TextEncoder().encode(JSON.stringify(event)).byteLength + 1;
    if (batch.length && bytes + encoded > MAX_BODY_BYTES) break;
    if (encoded > MAX_BODY_BYTES) throw new Error("Single Sheet event exceeds request guard");
    batch.push(event);
    bytes += encoded;
  }
  return batch;
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) return json({ error: "Unauthorized" }, 403);
    if (!SHEET_URL || !SHEET_SECRET) return json({ error: "Google Sheet integration is not configured" }, 503);

    const { data, error } = await admin.from("sheet_export_queue")
      .select("*")
      .is("sheet_ack_at", null)
      .order("id", { ascending: true })
      .limit(MAX_EVENTS);
    if (error) throw error;
    const waiting = (data ?? []) as Record<string, unknown>[];
    if (!waiting.length) return json({ exported: 0, remaining: 0 });
    const events = boundedBatch(waiting);

    const response = await fetch(SHEET_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: SHEET_SECRET, mode: "export", events }),
    });
    const responseText = await response.text();
    if (!response.ok) throw new Error(`Google Sheet HTTP ${response.status}: ${responseText.slice(0, 300)}`);
    const result = JSON.parse(responseText) as { ok?: boolean; error?: string; ack_event_ids?: string[] };
    if (result.ok !== true) throw new Error(`Google Sheet rejected batch: ${String(result.error ?? "unknown").slice(0, 300)}`);

    const requestedIds = events.map((event) => String(event.event_id ?? "")).filter(Boolean);
    const acked = Array.isArray(result.ack_event_ids) && result.ack_event_ids.length
      ? result.ack_event_ids.filter((id) => requestedIds.includes(String(id))).map(String)
      : requestedIds; // compatibility with the currently deployed legacy script during cutover.
    if (!acked.length) throw new Error("Google Sheet returned no acknowledgements");

    const now = new Date().toISOString();
    const { error: ackError } = await admin.from("sheet_export_queue")
      .update({ exported_at: now, sheet_ack_at: now, reconciliation_status: "SHEET_ACKED" })
      .in("event_id", acked);
    if (ackError) throw ackError;

    const { count, error: countError } = await admin.from("sheet_export_queue")
      .select("id", { count: "exact", head: true }).is("sheet_ack_at", null);
    if (countError) throw countError;
    return json({ exported: acked.length, remaining: count ?? 0 });
  } catch (error) {
    console.error(error instanceof Error ? error.message.slice(0, 500) : "sheet worker error");
    return json({ error: "Sheet export failed" }, 500);
  }
});
