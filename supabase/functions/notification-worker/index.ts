import { createClient } from "jsr:@supabase/supabase-js@2";
import { sendFcm } from "../_shared/fcm.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

type NotificationRow = {
  id: string;
  issue_id: string;
  issue_version: number;
  target_user_id: string;
  status: string;
  title: string;
  message: string;
  expires_at: string;
  send_count: number;
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) return json({ error: "Unauthorized" }, 403);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const issueId = String(body.issue_id ?? "").trim();
    const issueVersion = Number(body.issue_version ?? 0);
    const status = String(body.status ?? "").trim().toUpperCase();
    if (!issueId || !Number.isFinite(issueVersion) || issueVersion < 1 || !["OPEN", "AVAILABLE", "SKIP_ALLOWED"].includes(status)) {
      return json({ error: "Invalid notification scope" }, 400);
    }

    const { data: issue, error: issueError } = await admin.from("issues")
      .select("id,sku,product_name_snapshot,status,issue_version")
      .eq("id", issueId).single();
    if (issueError || !issue) return json({ error: "Issue not found" }, 404);
    if (issue.status !== status || Number(issue.issue_version) !== issueVersion) {
      return json({ stale: true, sent: 0 });
    }

    const { data, error } = await admin.from("notification_events")
      .select("id,issue_id,issue_version,target_user_id,status,title,message,expires_at,send_count")
      .eq("issue_id", issueId)
      .eq("issue_version", issueVersion)
      .eq("status", status)
      .eq("critical", true)
      .is("acknowledged_at", null)
      .gt("expires_at", new Date().toISOString())
      .limit(500);
    if (error) throw error;
    const events = (data ?? []) as NotificationRow[];
    if (!events.length) return json({ sent: 0, pending: 0 });

    const userIds = [...new Set(events.map((event) => event.target_user_id))];
    const { data: devices, error: deviceError } = await admin.from("device_tokens")
      .select("user_id,fcm_token").in("user_id", userIds).eq("active", true);
    if (deviceError) throw deviceError;
    const tokens = new Map<string, string[]>();
    for (const device of devices ?? []) {
      const list = tokens.get(String(device.user_id)) ?? [];
      list.push(String(device.fcm_token));
      tokens.set(String(device.user_id), list);
    }

    let sent = 0;
    const invalid = new Set<string>();
    for (const event of events) {
      const attemptAt = new Date().toISOString();
      const { error: attemptError } = await admin.from("notification_events")
        .update({ last_attempt_at: attemptAt }).eq("id", event.id);
      if (attemptError) throw attemptError;

      let accepted = false;
      const isHandlerOpenAlert = event.status === "OPEN";
      const payload = {
        event_id: event.id,
        notification_event_id: event.id,
        issue_id: event.issue_id,
        issue_version: String(event.issue_version),
        status: event.status,
        target_user_id: event.target_user_id,
        expiry: event.expires_at,
        sku: String(issue.sku ?? ""),
        product_name: String(issue.product_name_snapshot ?? ""),
        message: event.message,
        critical: isHandlerOpenAlert ? "false" : "true",
      };
      for (const token of tokens.get(event.target_user_id) ?? []) {
        try {
          const result = await sendFcm(token, payload, {
            ttlSeconds: 3600,
            collapseKey: isHandlerOpenAlert ? `issue-${event.issue_id}-handler` : `issue-${event.issue_id}-picker`,
            priority: "high",
          });
          accepted ||= result.accepted;
          if (result.invalidToken) invalid.add(token);
        } catch (error) {
          console.warn("notification send deferred", error instanceof Error ? error.message.slice(0, 240) : "unknown");
        }
      }
      if (accepted) {
        const now = new Date().toISOString();
        const { error: updateError } = await admin.from("notification_events")
          .update({ sent_at: now, fcm_accepted_at: now, last_attempt_at: now, send_count: Number(event.send_count ?? 0) + 1 })
          .eq("id", event.id);
        if (updateError) throw updateError;
        sent++;
      }
    }

    if (invalid.size) {
      const { error: invalidError } = await admin.from("device_tokens")
        .update({ active: false }).in("fcm_token", [...invalid]);
      if (invalidError) throw invalidError;
    }

    return json({ sent, pending: events.length - sent, invalid_tokens: invalid.size });
  } catch (error) {
    console.error(error instanceof Error ? error.message.slice(0, 400) : "notification worker error");
    return json({ error: "Notification worker failed" }, 500);
  }
});
