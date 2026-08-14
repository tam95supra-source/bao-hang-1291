const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const FIREBASE_SERVICE_ACCOUNT = Deno.env.get("FIREBASE_SERVICE_ACCOUNT") ?? "";
const SHEET_URL = Deno.env.get("GOOGLE_SHEET_WEBHOOK_URL") ?? "";
const SHEET_SECRET = Deno.env.get("GOOGLE_SHEET_WEBHOOK_SECRET") ?? "";
const PROJECT_ID = "bao-hang-1291";
const MAX_BATCH = 200;

type ServiceAccount = { project_id: string; client_email: string; private_key: string };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

function b64url(input: Uint8Array | string): string { const bytes=typeof input==="string"?new TextEncoder().encode(input):input;let binary="";for(const b of bytes)binary+=String.fromCharCode(b);return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""); }
function pemBytes(pem:string):Uint8Array { const body=pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,"");const raw=atob(body);return Uint8Array.from(raw,c=>c.charCodeAt(0)); }
async function accessToken(account:ServiceAccount):Promise<string>{const now=Math.floor(Date.now()/1000);const h=b64url(JSON.stringify({alg:"RS256",typ:"JWT"}));const c=b64url(JSON.stringify({iss:account.client_email,scope:"https://www.googleapis.com/auth/cloud-platform",aud:"https://oauth2.googleapis.com/token",iat:now,exp:now+3600}));const unsigned=`${h}.${c}`;const key=await crypto.subtle.importKey("pkcs8",Uint8Array.from(pemBytes(account.private_key)).buffer,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);const sig=await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,new TextEncoder().encode(unsigned));const assertion=`${unsigned}.${b64url(new Uint8Array(sig))}`;const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion})});if(!r.ok)throw new Error(`FIREBASE_OAUTH_${r.status}`);const body=await r.json();return String(body.access_token??"");}

function decodeValue(value:any):any {
  if (!value || typeof value !== "object") return null;
  if ("stringValue" in value) return String(value.stringValue);
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("booleanValue" in value) return Boolean(value.booleanValue);
  if ("timestampValue" in value) return String(value.timestampValue);
  if ("nullValue" in value) return null;
  if (value.mapValue?.fields) return decodeFields(value.mapValue.fields);
  if (Array.isArray(value.arrayValue?.values)) return value.arrayValue.values.map(decodeValue);
  return null;
}
function decodeFields(fields:Record<string,any>):Record<string,any> { const out:Record<string,any>={};for(const [key,value] of Object.entries(fields??{}))out[key]=decodeValue(value);return out; }

async function firestore(token:string,path:string,init:RequestInit={}):Promise<{status:number;body:any}>{const r=await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents${path}`,{...init,headers:{authorization:`Bearer ${token}`,"content-type":"application/json",...(init.headers??{})}});const text=await r.text();return{status:r.status,body:text?JSON.parse(text):{}};}
async function sheet(body:Record<string,unknown>):Promise<any>{const r=await fetch(SHEET_URL,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({secret:SHEET_SECRET,...body})});const text=await r.text();if(!r.ok)throw new Error(`SHEET_HTTP_${r.status}`);const result=JSON.parse(text);if(result?.ok!==true)throw new Error(`SHEET_REJECTED:${String(result?.error??"UNKNOWN").slice(0,120)}`);return result;}

async function pendingEvents(token:string):Promise<{name:string;event:Record<string,any>}[]>{
  const query={structuredQuery:{from:[{collectionId:"emergency_events"}],where:{fieldFilter:{field:{fieldPath:"reconciliation_status"},op:"EQUAL",value:{stringValue:"PENDING_SHEET"}}},limit:MAX_BATCH}};
  const r=await firestore(token,":runQuery",{method:"POST",body:JSON.stringify(query)});
  if(r.status!==200)throw new Error(`FIRESTORE_QUERY_${r.status}`);
  const rows=Array.isArray(r.body)?r.body:[];
  return rows.map((row:any)=>row.document).filter(Boolean).map((doc:any)=>({name:String(doc.name),event:decodeFields(doc.fields??{})}));
}

async function markSheetAck(token:string,name:string,at:string){
  const relative=name.split(`/documents`)[1];
  const path=`${relative}?updateMask.fieldPaths=sheet_ack_at&updateMask.fieldPaths=reconciliation_status`;
  const r=await firestore(token,path,{method:"PATCH",body:JSON.stringify({fields:{sheet_ack_at:{timestampValue:at},reconciliation_status:{stringValue:"SHEET_ACKED"}}})});
  if(r.status!==200)throw new Error(`FIRESTORE_ACK_${r.status}`);
}

async function cleanupAcked(token:string):Promise<number>{
  const query={structuredQuery:{from:[{collectionId:"emergency_events"}],where:{fieldFilter:{field:{fieldPath:"reconciliation_status"},op:"EQUAL",value:{stringValue:"SHEET_ACKED"}}},limit:200}};
  const r=await firestore(token,":runQuery",{method:"POST",body:JSON.stringify(query)});if(r.status!==200)return 0;
  const cutoff=Date.now()-7*24*60*60*1000;let deleted=0;
  for(const row of Array.isArray(r.body)?r.body:[]){const doc=row.document;if(!doc)continue;const event=decodeFields(doc.fields??{});const ackMs=Date.parse(String(event.sheet_ack_at??""));if(!Number.isFinite(ackMs)||ackMs>cutoff)continue;const relative=String(doc.name).split(`/documents`)[1];const d=await firestore(token,relative,{method:"DELETE"});if([200,204].includes(d.status))deleted++;if(deleted>=100)break;}
  return deleted;
}

Deno.serve(async(req)=>{try{
  if(req.method!=="POST")return json({error:"Method not allowed"},405);
  if(!CRON_SECRET||req.headers.get("x-cron-secret")!==CRON_SECRET)return json({error:"Unauthorized"},403);
  if(!FIREBASE_SERVICE_ACCOUNT||!SHEET_URL||!SHEET_SECRET)return json({error:"Emergency drain not configured"},503);
  const account=JSON.parse(FIREBASE_SERVICE_ACCOUNT) as ServiceAccount;if(account.project_id!==PROJECT_ID)return json({error:"Firebase project mismatch"},409);
  const token=await accessToken(account);
  const pending=await pendingEvents(token);
  if(!pending.length){const deleted=await cleanupAcked(token);return json({ok:true,drained:0,pending:0,deleted_after_safety_window:deleted});}

  const events=pending.map(({event})=>event);
  const imported=await sheet({mode:"emergency_import",events});
  const ackIds=new Set<string>((Array.isArray(imported.ack_event_ids)?imported.ack_event_ids:[]).map(String));
  if(!ackIds.size)throw new Error("SHEET_EMERGENCY_NO_ACK");
  const ackAt=new Date().toISOString();let acknowledged=0;
  for(const item of pending){const eventId=String(item.event.event_id??"");if(!ackIds.has(eventId))continue;await markSheetAck(token,item.name,ackAt);acknowledged++;}
  const deleted=await cleanupAcked(token);
  return json({ok:true,drained:acknowledged,pending:pending.length-acknowledged,deleted_after_safety_window:deleted});
}catch(error){console.error(error instanceof Error?error.message.slice(0,400):"emergency drain error");return json({ok:false,error:"Emergency drain failed"},500);}});
