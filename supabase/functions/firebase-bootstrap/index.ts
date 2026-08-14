const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const FIREBASE_SERVICE_ACCOUNT = Deno.env.get("FIREBASE_SERVICE_ACCOUNT") ?? "";
const PROJECT_ID = "bao-hang-1291";
const LOCATION_ID = "asia-southeast1";
const RULES_RELEASE = `projects/${PROJECT_ID}/releases/cloud.firestore`;

const SHEET_SECRET = Deno.env.get("GOOGLE_SHEET_WEBHOOK_SECRET") ?? "";
const FIREBASE_API_KEY = "AIzaSyB-n368fntzxsuuLlvte9NXhcuX0DDbTXM";
const DRAIN_UID = "bh1291-sheet-drain";
const DRAIN_EMAIL = "sheet-drain@auth.bao-hang-1291.invalid";
const FIRESTORE_RULES = String.raw`rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() { return request.auth != null; }
    function siteOk() { return signedIn() && request.auth.token.site == '1291'; }
    function role() { return request.auth.token.role; }
    function isDrain() { return siteOk() && request.auth.token.account_kind == 'SHEET_DRAIN' && request.auth.token.drain_enabled == true; }
    function businessUser() {
      return siteOk()
        && request.auth.token.emergency_enabled == true
        && role() in ['PICKER','INVENT','ADMIN_INVENT','ADMIN']
        && !exists(/databases/$(database)/documents/emergency_revocations/$(request.auth.uid));
    }
    function ops() { return businessUser() && role() in ['INVENT','ADMIN_INVENT','ADMIN']; }
    function adminOps() { return businessUser() && role() in ['ADMIN_INVENT','ADMIN']; }
    function deviceAllowed(data) {
      return businessUser() && data.device_id is string && (
        (request.auth.token.account_kind == 'BACKUP' && request.auth.token.device_scope is string && (request.auth.token.device_scope == '*' || request.auth.token.device_scope == data.device_id))
        || (request.auth.token.account_kind != 'BACKUP' && request.auth.token.device_id is string && request.auth.token.device_id == data.device_id)
      );
    }
    function validStatus(status) { return status in ['OPEN','CLAIMED','AVAILABLE','SKIP_ALLOWED']; }
    function eventAfter(eventId) { return getAfter(/databases/$(database)/documents/emergency_events/$(eventId)); }
    function linked(data) {
      return data.last_event_id is string
        && data.last_emergency_sequence is int
        && existsAfter(/databases/$(database)/documents/emergency_events/$(data.last_event_id))
        && eventAfter(data.last_event_id).data.emergency_sequence == data.last_emergency_sequence
        && eventAfter(data.last_event_id).data.issue_id == data.issue_id
        && eventAfter(data.last_event_id).data.sku == data.sku;
    }

    match /emergency_control/sequence {
      allow get: if businessUser() || isDrain();
      allow list: if false;
      allow create: if businessUser()
        && request.resource.data.keys().hasOnly(['next_sequence','sheet_acked_sequence','last_event_id','updated_at'])
        && request.resource.data.next_sequence == 1
        && request.resource.data.sheet_acked_sequence == 0
        && request.resource.data.last_event_id is string
        && existsAfter(/databases/$(database)/documents/emergency_events/$(request.resource.data.last_event_id))
        && eventAfter(request.resource.data.last_event_id).data.emergency_sequence == 1;
      allow update: if (
        businessUser()
        && request.resource.data.next_sequence == resource.data.next_sequence + 1
        && request.resource.data.sheet_acked_sequence == resource.data.sheet_acked_sequence
        && request.resource.data.last_event_id is string
        && existsAfter(/databases/$(database)/documents/emergency_events/$(request.resource.data.last_event_id))
        && eventAfter(request.resource.data.last_event_id).data.emergency_sequence == request.resource.data.next_sequence
      ) || (
        isDrain()
        && request.resource.data.next_sequence == resource.data.next_sequence
        && request.resource.data.last_event_id == resource.data.last_event_id
        && request.resource.data.sheet_acked_sequence >= resource.data.sheet_acked_sequence
        && request.resource.data.sheet_acked_sequence <= resource.data.next_sequence
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['sheet_acked_sequence','updated_at'])
      );
      allow delete: if false;
    }

    match /emergency_state/{skuKey} {
      allow get: if businessUser();
      allow list: if ops();
      allow create: if businessUser()
        && request.resource.data.keys().hasOnly(['sku','issue_id','status','issue_version','updated_at','authority_mode','last_event_id','last_emergency_sequence'])
        && request.resource.data.status == 'OPEN'
        && request.resource.data.issue_version == 1
        && request.resource.data.authority_mode == 'FIREBASE_EMERGENCY'
        && linked(request.resource.data);
      allow update: if businessUser()
        && request.resource.data.sku == resource.data.sku
        && request.resource.data.issue_id == resource.data.issue_id
        && request.resource.data.authority_mode == 'FIREBASE_EMERGENCY'
        && request.resource.data.issue_version == resource.data.issue_version + 1
        && resource.data.status in ['OPEN','CLAIMED']
        && request.resource.data.status in ['CLAIMED','AVAILABLE','SKIP_ALLOWED']
        && linked(request.resource.data)
        && ops();
      allow delete: if false;
    }

    match /emergency_ops_state/{skuKey} {
      allow read: if ops();
      allow create: if businessUser()
        && request.resource.data.keys().hasOnly(['sku','issue_id','status','report_count','issue_version','claimed_by_account_id','updated_at','authority_mode','last_event_id','last_emergency_sequence'])
        && request.resource.data.report_count == 1
        && request.resource.data.issue_version == 1
        && request.resource.data.status == 'OPEN'
        && request.resource.data.claimed_by_account_id == ''
        && request.resource.data.authority_mode == 'FIREBASE_EMERGENCY'
        && linked(request.resource.data)
        && existsAfter(/databases/$(database)/documents/emergency_state/$(skuKey));
      allow update: if businessUser()
        && request.resource.data.sku == resource.data.sku
        && request.resource.data.issue_id == resource.data.issue_id
        && request.resource.data.authority_mode == 'FIREBASE_EMERGENCY'
        && linked(request.resource.data)
        && (
          (request.resource.data.report_count == resource.data.report_count + 1
            && request.resource.data.status == resource.data.status
            && request.resource.data.issue_version == resource.data.issue_version
            && request.resource.data.claimed_by_account_id == resource.data.claimed_by_account_id
            && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['report_count','updated_at','last_event_id','last_emergency_sequence']))
          || (ops()
            && request.resource.data.report_count == resource.data.report_count
            && request.resource.data.issue_version == resource.data.issue_version + 1
            && request.resource.data.status in ['CLAIMED','AVAILABLE','SKIP_ALLOWED'])
        );
      allow delete: if false;
    }

    match /emergency_events/{eventId} {
      allow create: if businessUser()
        && request.resource.data.keys().hasOnly([
          'event_id','emergency_sequence','source_mode','event_type','occurred_at_device','accepted_at_authority',
          'actor_account_id','actor_role','device_id','issue_id','sku','issue_version','payload_json','payload_sha256',
          'sheet_ack_at','reconciliation_status'
        ])
        && request.resource.data.event_id == eventId
        && request.resource.data.emergency_sequence is int
        && request.resource.data.emergency_sequence >= 1
        && request.resource.data.source_mode == 'FIREBASE_EMERGENCY'
        && request.resource.data.actor_account_id == request.auth.uid
        && request.resource.data.actor_role == role()
        && deviceAllowed(request.resource.data)
        && request.resource.data.event_type in ['REPORT_SHORTAGE','CLAIM','AVAILABLE','SKIP_ALLOWED','REASSIGN']
        && (request.resource.data.event_type != 'REPORT_SHORTAGE' || role() in ['PICKER','ADMIN'])
        && (request.resource.data.event_type == 'REPORT_SHORTAGE' || ops())
        && (request.resource.data.event_type != 'REASSIGN' || adminOps())
        && request.resource.data.reconciliation_status == 'PENDING_SHEET'
        && request.resource.data.sheet_ack_at == null
        && request.resource.data.issue_id is string
        && request.resource.data.sku is string
        && request.resource.data.issue_version is int
        && existsAfter(/databases/$(database)/documents/emergency_control/sequence)
        && getAfter(/databases/$(database)/documents/emergency_control/sequence).data.next_sequence == request.resource.data.emergency_sequence
        && getAfter(/databases/$(database)/documents/emergency_control/sequence).data.last_event_id == eventId;
      allow get: if isDrain() || (businessUser() && (resource.data.actor_account_id == request.auth.uid || ops()));
      allow list: if isDrain() || ops();
      allow update: if isDrain()
        && resource.data.reconciliation_status == 'PENDING_SHEET'
        && request.resource.data.reconciliation_status == 'SHEET_ACKED'
        && request.resource.data.sheet_ack_at is timestamp
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['sheet_ack_at','reconciliation_status']);
      allow delete: if false;
    }

    match /emergency_user_state/{projectionId} {
      allow get, list: if businessUser() && (resource.data.target_user_id == request.auth.uid || ops());
      allow create: if businessUser()
        && request.resource.data.keys().hasOnly(['target_user_id','issue_id','sku','status','issue_version','updated_at','authority_mode','last_event_id','last_emergency_sequence'])
        && request.resource.data.target_user_id == request.auth.uid
        && request.resource.data.status == 'OPEN'
        && request.resource.data.issue_version >= 1
        && request.resource.data.authority_mode == 'FIREBASE_EMERGENCY'
        && linked(request.resource.data);
      allow update: if ops()
        && request.resource.data.target_user_id == resource.data.target_user_id
        && request.resource.data.issue_id == resource.data.issue_id
        && request.resource.data.sku == resource.data.sku
        && request.resource.data.status in ['AVAILABLE','SKIP_ALLOWED']
        && request.resource.data.issue_version > resource.data.issue_version
        && request.resource.data.authority_mode == 'FIREBASE_EMERGENCY'
        && linked(request.resource.data);
      allow delete: if false;
    }

    match /emergency_revocations/{accountId} {
      allow read, write: if false;
    }

    match /{document=**} {
      allow read, write: if false;
    }
  }
}
`;

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

async function deriveDrainPassword(secret: string): Promise<string> {
  if (secret.length < 24) throw new Error("SHEET_SECRET_NOT_CONFIGURED");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("sheet-drain-password-v1")));
  const hex = [...sig].map((b)=>b.toString(16).padStart(2,"0")).join("");
  return `Bh1291!${hex}aA1!`;
}
async function provisionDrainIdentity(token: string): Promise<boolean> {
  const password = await deriveDrainPassword(SHEET_SECRET);
  const create = await googleJson(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts?key=${encodeURIComponent(FIREBASE_API_KEY)}`, token, {
    method:"POST", body:JSON.stringify({ localId:DRAIN_UID, email:DRAIN_EMAIL, password, displayName:"Báo hàng 1291 Sheet Drain", emailVerified:true, disabled:false })
  });
  if (![200,201,400].includes(create.status)) throw new Error(`DRAIN_CREATE_${create.status}`);
  if (create.status === 400) {
    const message=String(create.body?.error?.message??"");
    if (!message.includes("LOCAL_ID_EXISTS") && !message.includes("EMAIL_EXISTS")) throw new Error(`DRAIN_CREATE_${message.slice(0,80)}`);
  }
  const update = await googleJson(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:update?key=${encodeURIComponent(FIREBASE_API_KEY)}`, token, {
    method:"POST", body:JSON.stringify({ localId:DRAIN_UID, targetProjectId:PROJECT_ID, email:DRAIN_EMAIL, password, displayName:"Báo hàng 1291 Sheet Drain", emailVerified:true, disableUser:false, customAttributes:JSON.stringify({site:"1291",account_kind:"SHEET_DRAIN",drain_enabled:true}) })
  });
  if (update.status !== 200) throw new Error(`DRAIN_UPDATE_${update.status}`);
  return true;
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

    const drainIdentityReady = await provisionDrainIdentity(token);

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
      drain_identity_ready: drainIdentityReady,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message.slice(0, 300) : "firebase bootstrap error");
    return json({ ok: false, phase: "exception", reason: error instanceof Error ? error.message.slice(0, 120) : "UNKNOWN" }, 500);
  }
});
