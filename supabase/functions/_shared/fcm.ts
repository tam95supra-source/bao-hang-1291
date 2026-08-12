type ServiceAccount = { project_id: string; client_email: string; private_key: string; };
export type FcmOptions = { ttlSeconds?: number; collapseKey?: string; priority?: "high" | "normal" };
export type FcmResult = { accepted: boolean; invalidToken: boolean };

let cachedToken = "";
let cachedUntil = 0;

function base64Url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function pemToBytes(pem: string): Uint8Array {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const binary = atob(body);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
async function accessToken(account: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedUntil > now + 60) return cachedToken;
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(JSON.stringify({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claim}`;
  const key = await crypto.subtle.importKey(
    "pkcs8", pemToBytes(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${base64Url(new Uint8Array(signature))}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!response.ok) throw new Error(`FCM OAuth ${response.status}: ${await response.text()}`);
  const result = await response.json();
  cachedToken = result.access_token;
  cachedUntil = now + Number(result.expires_in ?? 3600);
  return cachedToken;
}

function isInvalidRegistration(status: number, body: string): boolean {
  if (status === 404) return true;
  const normalized = body.toUpperCase();
  return normalized.includes("UNREGISTERED") || normalized.includes("NOT_FOUND") || normalized.includes("REGISTRATION-TOKEN-NOT-REGISTERED");
}

export async function sendFcm(token: string, data: Record<string, string>, options: FcmOptions = {}): Promise<FcmResult> {
  const raw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");
  if (!raw) return { accepted: false, invalidToken: false };
  const account = JSON.parse(raw) as ServiceAccount;
  const bearer = await accessToken(account);
  const ttlSeconds = Math.max(0, Math.min(2_419_200, Math.trunc(options.ttlSeconds ?? 3600)));
  const android: Record<string, unknown> = {
    priority: options.priority ?? "high",
    ttl: `${ttlSeconds}s`,
  };
  if (options.collapseKey) android.collapse_key = options.collapseKey.slice(0, 64);
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
    method: "POST",
    headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
    body: JSON.stringify({ message: { token, data, android } }),
  });
  if (response.ok) return { accepted: true, invalidToken: false };
  const body = await response.text();
  if (isInvalidRegistration(response.status, body)) return { accepted: false, invalidToken: true };
  throw new Error(`FCM send ${response.status}: ${body.slice(0, 800)}`);
}
