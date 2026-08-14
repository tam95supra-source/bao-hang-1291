const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const FIREBASE_SERVICE_ACCOUNT = Deno.env.get("FIREBASE_SERVICE_ACCOUNT") ?? "";
const PROJECT_ID = "bao-hang-1291";
const LOCATION_ID = "asia-southeast1";
const RULES_RELEASE = `projects/${PROJECT_ID}/releases/cloud.firestore`;

const FIRESTORE_RULES = String.raw`rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function validAuth() {
      return request.auth != null
        && request.auth.token.site == '1291'
        && request.auth.token.emergency_enabled == true
        && request.auth.token.role in ['PICKER','INVENT','ADMIN_INVENT','ADMIN']
        && request.auth.token.device_id is string;
    }
    function role() { return request.auth.token.role; }
    function ops() { return validAuth() && role() in ['INVENT','ADMIN_INVENT','ADMIN']; }
    function sameDevice(data) { return data.device_id == request.auth.token.device_id; }
    function validStatus(status) { return status in ['OPEN','CLAIMED','AVAILABLE','SKIP_ALLOWED']; }
    function stateKeys(data) {
      return data.keys().hasOnly(['sku','issue_id','status','issue_version','claimed_by_account_id','updated_at','authority_mode']);
    }
    function stateShape(data) {
      return stateKeys(data)
        && data.sku is string && data.sku.size() > 0 && data.sku.size() <= 120
        && data.issue_id is string && data.issue_id.size() > 0 && data.issue_id.size() <= 100
        && validStatus(data.status)
        && data.issue_version is int && data.issue_version >= 1
        && data.claimed_by_account_id is string
        && data.authority_mode == 'FIREBASE_EMERGENCY';
    }

    match /emergency_state/{skuKey} {
      allow read: if validAuth();
      allow create: if validAuth() && stateShape(request.resource.data)
        && request.resource.data.status == 'OPEN'
        && request.resource.data.issue_version == 1
        && request.resource.data.claimed_by_account_id == '';
      allow update: if validAuth() && stateShape(request.resource.data) && request.resource.data.sku == resource.data.sku && (
        (role() in ['PICKER','ADMIN']
          && resource.data.status in ['AVAILABLE','SKIP_ALLOWED']
          && request.resource.data.status == 'OPEN'
          && request.resource.data.issue_id != resource.data.issue_id
          && request.resource.data.issue_version == 1
          && request.resource.data.claimed_by_account_id == '')
        || (ops()
          && request.resource.data.issue_id == resource.data.issue_id
          && request.resource.data.issue_version == resource.data.issue_version + 1
          && (
            (request.resource.data.status == 'CLAIMED'
              && resource.data.status in ['OPEN','CLAIMED']
              && request.resource.data.claimed_by_account_id != '')
            || (request.resource.data.status in ['AVAILABLE','SKIP_ALLOWED']
              && resource.data.status in ['OPEN','CLAIMED'])
          ))
      );
      allow delete: if false;
    }

    match /emergency_ops_state/{skuKey} {
      allow read: if ops();
      allow create: if validAuth()
        && request.resource.data.keys().hasOnly(['sku','issue_id','status','report_count','issue_version','claimed_by_account_id','updated_at','authority_mode'])
        && request.resource.data.report_count == 1
        && request.resource.data.issue_version == 1
        && request.resource.data.status == 'OPEN'
        && request.resource.data.authority_mode == 'FIREBASE_EMERGENCY'
        && existsAfter(/databases/$(database)/documents/emergency_state/$(skuKey))
        && getAfter(/databases/$(database)/documents/emergency_state/$(skuKey)).data.issue_id == request.resource.data.issue_id;
      allow update: if validAuth()
        && request.resource.data.authority_mode == 'FIREBASE_EMERGENCY'
        && existsAfter(/databases/$(database)/documents/emergency_state/$(skuKey))
        && request.resource.data.issue_id == getAfter(/databases/$(database)/documents/emergency_state/$(skuKey)).data.issue_id
        && request.resource.data.status == getAfter(/databases/$(database)/documents/emergency_state/$(skuKey)).data.status
        && request.resource.data.issue_version == getAfter(/databases/$(database)/documents/emergency_state/$(skuKey)).data.issue_version
        && request.resource.data.claimed_by_account_id == getAfter(/databases/$(database)/documents/emergency_state/$(skuKey)).data.claimed_by_account_id
        && (
          (request.resource.data.issue_id == resource.data.issue_id
            && request.resource.data.report_count == resource.data.report_count + 1
            && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['report_count','updated_at']))
          || (request.resource.data.issue_id != resource.data.issue_id
            && request.resource.data.report_count == 1
            && getAfter(/databases/$(database)/documents/emergency_state/$(skuKey)).data.status == 'OPEN')
          || (ops()
            && request.resource.data.issue_id == resource.data.issue_id
            && request.resource.data.report_count == resource.data.report_count)
        );
      allow delete: if false;
    }

    match /emergency_events/{eventId} {
      allow create: if validAuth()
        && request.resource.data.keys().hasOnly([
          'event_id','source_mode','event_type','occurred_at_device','accepted_at_authority',
          'actor_account_id','actor_role','device_id','issue_id','sku','issue_version',
          'payload_json','payload_sha256','sheet_ack_at','reconciliation_status'
        ])
        && request.resource.data.event_id == eventId
        && request.resource.data.source_mode == 'FIREBASE_EMERGENCY'
        && request.resource.data.actor_account_id == request.auth.uid
        && request.resource.data.actor_role == role()
        && sameDevice(request.resource.data)
        && request.resource.data.event_type in ['REPORT_SHORTAGE','CLAIM','AVAILABLE','SKIP_ALLOWED','REASSIGN']
        && request.resource.data.reconciliation_status == 'PENDING_SHEET'
        && request.resource.data.sheet_ack_at == null
        && request.resource.data.issue_id is string
        && request.resource.data.sku is string
        && request.resource.data.issue_version is int;
      allow get, list: if validAuth() && (resource.data.actor_account_id == request.auth.uid || ops());
      allow update, delete: if false;
    }

    match /emergency_user_state/{projectionId} {
      allow read: if validAuth() && (resource.data.target_user_id == request.auth.uid || ops());
      allow create: if validAuth()
        && request.resource.data.keys().hasOnly(['target_user_id','issue_id','sku','status','issue_version','updated_at','authority_mode'])
        && request.resource.data.target_user_id == request.auth.uid
        && request.resource.data.status == 'OPEN'
        && request.resource.data.issue_version >= 1
        && request.resource.data.authority_mode == 'FIREBASE_EMERGENCY';
      allow update: if ops()
        && request.resource.data.target_user_id == resource.data.target_user_id
        && request.resource.data.issue_id == resource.data.issue_id
        && request.resource.data.sku == resource.data.sku
        && request.resource.data.status in ['AVAILABLE','SKIP_ALLOWED']
        && request.resource.data.issue_version > resource.data.issue_version
        && request.resource.data.authority_mode == 'FIREBASE_EMERGENCY';
      allow delete: if false;
    }

    match /{document=**} {
      allow read, write: if false;
    }
  }
}`;

type ServiceAccount = { project_id: string; client_email: string; private_key: string };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

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
function asArrayBuffer(bytes: Uint8Array): ArrayBuffer { return Uint8Array.from(bytes).buffer as ArrayBuffer; }

async function accessToken(account: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(JSON.stringify({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claim}`;
  const key = await crypto.subtle.importKey("pkcs8", asArrayBuffer(pemToBytes(account.private_key)), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, asArrayBuffer(new TextEncoder().encode(unsigned)));
  const assertion = `${unsigned}.${base64Url(new Uint8Array(signature))}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!response.ok) throw new Error(`OAUTH_${response.status}`);
  const result = await response.json();
  return String(result.access_token ?? "");
}

async function googleJson(url: string, token: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  const response = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  return { status: response.status, body };
}

async function sha256(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) return json({ error: "Unauthorized" }, 403);
    if (!FIREBASE_SERVICE_ACCOUNT) return json({ error: "Firebase service account unavailable" }, 503);
    const account = JSON.parse(FIREBASE_SERVICE_ACCOUNT) as ServiceAccount;
    if (account.project_id !== PROJECT_ID) return json({ error: "Firebase project mismatch" }, 409);
    const token = await accessToken(account);

    // Zero-cost guard is fail-closed: bootstrap is refused if Billing cannot be proven disabled.
    const billing = await googleJson(`https://cloudbilling.googleapis.com/v1/projects/${PROJECT_ID}/billingInfo`, token);
    if (billing.status !== 200) {
      return json({ ok: false, phase: "billing_guard", status: billing.status, reason: String(billing.body?.error?.status ?? "UNVERIFIED") }, 412);
    }
    if (billing.body?.billingEnabled === true || String(billing.body?.billingAccountName ?? "").trim()) {
      return json({ ok: false, phase: "billing_guard", reason: "BILLING_ATTACHED" }, 412);
    }

    const databaseUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)`;
    let database = await googleJson(databaseUrl, token);
    let databaseCreated = false;
    if (database.status === 404) {
      const create = await googleJson(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases?databaseId=(default)`, token, {
        method: "POST",
        body: JSON.stringify({ locationId: LOCATION_ID, type: "FIRESTORE_NATIVE", deleteProtectionState: "DELETE_PROTECTION_ENABLED" }),
      });
      if (![200, 201].includes(create.status)) {
        return json({ ok: false, phase: "database_create", status: create.status, reason: String(create.body?.error?.status ?? "CREATE_FAILED") }, 500);
      }
      databaseCreated = true;
      for (let attempt = 0; attempt < 8; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        database = await googleJson(databaseUrl, token);
        if (database.status === 200) break;
      }
    }
    if (database.status !== 200) {
      return json({ ok: false, phase: "database_verify", status: database.status, reason: String(database.body?.error?.status ?? "NOT_READY") }, 503);
    }
    if (database.body?.locationId !== LOCATION_ID) {
      return json({ ok: false, phase: "database_verify", reason: "LOCATION_MISMATCH", location: database.body?.locationId ?? "" }, 409);
    }

    const ruleset = await googleJson(`https://firebaserules.googleapis.com/v1/projects/${PROJECT_ID}/rulesets`, token, {
      method: "POST",
      body: JSON.stringify({ source: { files: [{ name: "firestore.rules", content: FIRESTORE_RULES }] } }),
    });
    if (![200, 201].includes(ruleset.status) || !ruleset.body?.name) {
      return json({ ok: false, phase: "ruleset_create", status: ruleset.status, reason: String(ruleset.body?.error?.status ?? "RULESET_FAILED") }, 500);
    }

    const releaseGet = await googleJson(`https://firebaserules.googleapis.com/v1/${RULES_RELEASE}`, token);
    let release;
    if (releaseGet.status === 404) {
      release = await googleJson(`https://firebaserules.googleapis.com/v1/projects/${PROJECT_ID}/releases`, token, {
        method: "POST",
        body: JSON.stringify({ name: RULES_RELEASE, rulesetName: ruleset.body.name }),
      });
    } else if (releaseGet.status === 200) {
      release = await googleJson(`https://firebaserules.googleapis.com/v1/${RULES_RELEASE}?updateMask=ruleset_name`, token, {
        method: "PATCH",
        body: JSON.stringify({ name: RULES_RELEASE, rulesetName: ruleset.body.name }),
      });
    } else {
      return json({ ok: false, phase: "release_lookup", status: releaseGet.status, reason: String(releaseGet.body?.error?.status ?? "LOOKUP_FAILED") }, 500);
    }
    if (![200, 201].includes(release.status)) {
      return json({ ok: false, phase: "release_deploy", status: release.status, reason: String(release.body?.error?.status ?? "DEPLOY_FAILED") }, 500);
    }

    return json({
      ok: true,
      billing: "DISABLED",
      database_created: databaseCreated,
      database_name: database.body?.name ?? "",
      database_location: database.body?.locationId ?? "",
      database_type: database.body?.type ?? "",
      delete_protection: database.body?.deleteProtectionState ?? "",
      ruleset_name: ruleset.body.name,
      rules_sha256: await sha256(FIRESTORE_RULES),
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message.slice(0, 300) : "firebase bootstrap error");
    return json({ ok: false, phase: "exception", reason: error instanceof Error ? error.message.slice(0, 120) : "UNKNOWN" }, 500);
  }
});
