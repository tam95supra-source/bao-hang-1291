import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SHEET_URL = Deno.env.get("GOOGLE_SHEET_WEBHOOK_URL") ?? "";
const SIGNING_SECRET = Deno.env.get("FALLBACK_TOKEN_SIGNING_SECRET") ?? Deno.env.get("GOOGLE_SHEET_WEBHOOK_SECRET") ?? "";
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const TTL_SECONDS = 7 * 24 * 60 * 60;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlText(value: string): string { return b64url(new TextEncoder().encode(value)); }
async function hmac(value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SIGNING_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return b64url(new Uint8Array(signature));
}
async function sha256(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (!SIGNING_SECRET || SIGNING_SECRET.length < 24 || !SHEET_URL) return json({ error: "Fallback token service is not configured" }, 503);
    const authorization = req.headers.get("authorization") ?? "";
    if (!authorization.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const client = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
    const { data: { user }, error: userError } = await client.auth.getUser();
    if (userError || !user) return json({ error: "Unauthorized" }, 401);
    const { data: profile, error: profileError } = await admin.from("profiles")
      .select("id,role,active,employee_code,full_name").eq("id", user.id).single();
    if (profileError || !profile?.active) return json({ error: "Account inactive" }, 403);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const deviceId = String(body.device_id ?? "").trim();
    if (deviceId.length < 8 || deviceId.length > 200) return json({ error: "Invalid device" }, 400);
    const now = Math.floor(Date.now() / 1000);
    const exp = now + TTL_SECONDS;
    const jti = crypto.randomUUID();
    const payload = {
      v: 1,
      kind: "SERVICE_FALLBACK",
      account_id: profile.id,
      role: String(profile.role),
      device_id: deviceId,
      iat: now,
      exp,
      jti,
    };
    const payloadEncoded = b64urlText(JSON.stringify(payload));
    const token = `${payloadEncoded}.${await hmac(payloadEncoded)}`;
    const tokenHash = await sha256(token);
    await admin.from("fallback_token_audit").insert({
      token_jti: jti,
      token_sha256: tokenHash,
      account_id: profile.id,
      device_id: deviceId,
      role: profile.role,
      issued_at: new Date(now * 1000).toISOString(),
      expires_at: new Date(exp * 1000).toISOString(),
    });
    return json({
      fallback_token: token,
      fallback_url: SHEET_URL,
      expires_at: new Date(exp * 1000).toISOString(),
      device_id: deviceId,
      schema: "target-final-v1",
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message.slice(0, 400) : "fallback token error");
    return json({ error: "Fallback token failed" }, 500);
  }
});
