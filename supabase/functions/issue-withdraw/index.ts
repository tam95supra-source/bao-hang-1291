import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { sendFcm } from "../_shared/fcm.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const WEB_ORIGIN = "https://bao-hang-1291.web.app";
type Role = "ADMIN" | "ADMIN_INVENT" | "INVENT" | "PICKER";
type Profile = { id:string; employee_code:string; full_name:string; role:Role; active:boolean };
type Context = { userId:string; profile:Profile; effectiveRole:Role; client:SupabaseClient };
class HttpError extends Error { constructor(public status:number, message:string){ super(message); } }
const errorText=(e:unknown)=>e instanceof Error?e.message:String(e);
function cors(req:Request){
  const origin=req.headers.get("origin")??"";
  return {
    "access-control-allow-origin": origin===WEB_ORIGIN?origin:WEB_ORIGIN,
    "access-control-allow-methods":"POST, OPTIONS",
    "access-control-allow-headers":"authorization, apikey, content-type, x-admin-test-role",
    "access-control-max-age":"86400",
    "vary":"Origin",
  };
}
function json(req:Request, body:unknown, status=200){return new Response(JSON.stringify(body),{status,headers:{...cors(req),"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}});}
function safeTestRole(raw:string|null):Role|null{const r=String(raw??"").trim().toUpperCase();return (["ADMIN_INVENT","INVENT","PICKER"] as string[]).includes(r)?r as Role:null;}
function requireRole(context:Context, roles:Role[]){if(!roles.includes(context.effectiveRole))throw new HttpError(403,"Bạn không có quyền thực hiện thao tác này");}
async function authenticated(req:Request):Promise<Context>{
  const authorization=req.headers.get("authorization")??"";
  if(!authorization.startsWith("Bearer "))throw new HttpError(401,"Phiên đăng nhập không hợp lệ");
  const client=createClient(SUPABASE_URL,ANON_KEY,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}});
  const {data:{user},error}=await client.auth.getUser();
  if(error||!user)throw new HttpError(401,"Phiên đăng nhập đã hết hạn");
  const {data:profile,error:pe}=await admin.from("profiles").select("id,employee_code,full_name,role,active").eq("id",user.id).single();
  if(pe||!profile?.active)throw new HttpError(403,"Tài khoản đã ngừng hoạt động");
  const typed=profile as Profile;
  const requested=safeTestRole(req.headers.get("x-admin-test-role"));
  if(req.headers.get("x-admin-test-role")&&!requested)throw new HttpError(400,"Chế độ kiểm thử quyền không hợp lệ");
  if(requested&&typed.role!=="ADMIN")throw new HttpError(403,"Chỉ Admin hệ thống được kiểm thử quyền");
  return {userId:user.id,profile:typed,effectiveRole:requested??typed.role,client};
}
function baseIssue(row:any){return {id:row.id,sku:row.sku,product_name:row.product_name_snapshot,status:row.status,report_count:Number(row.report_count??1),reported_at:row.first_reported_at,updated_at:row.updated_at,issue_version:Number(row.issue_version??1),assigned_id:row.claimed_by??null};}
async function issueMap(ids:string[]){
  if(!ids.length)return new Map<string,any>();
  const {data,error}=await admin.from("issues").select("id,sku,product_name_snapshot,status,report_count,first_reported_at,updated_at,issue_version,claimed_by").in("id",ids);
  if(error)throw error;return new Map((data??[]).map((row:any)=>[String(row.id),row]));
}
async function notifyOperators(context:Context, result:any){
  const issue=result.issue;const remaining=Number(result.remaining_report_count??0);
  const {data:users,error}=await admin.from("profiles").select("id").in("role",["ADMIN","ADMIN_INVENT","INVENT"]).eq("active",true);if(error)throw error;
  const ids=(users??[]).map((u:any)=>String(u.id));if(!ids.length)return;
  const {data:devices,error:de}=await admin.from("device_tokens").select("user_id,fcm_token").in("user_id",ids).eq("active",true);if(de)throw de;
  const message=remaining>0
    ? `${context.profile.full_name} đã thu hồi báo thiếu SKU ${issue.sku}. SKU này vẫn còn ${remaining} lượt báo chưa thu hồi, tiếp tục xử lý.`
    : `${context.profile.full_name} đã thu hồi báo thiếu SKU ${issue.sku}. Không còn Người lấy hàng nào chờ SKU này; có thể dừng tìm nếu chưa có nhu cầu khác.`;
  const invalid:string[]=[];
  await Promise.all((devices??[]).map(async(device:any)=>{
    const eventId=crypto.randomUUID();
    try{const r=await sendFcm(String(device.fcm_token),{event_id:eventId,issue_id:String(issue.id),issue_version:String(issue.issue_version??1),sku:String(issue.sku),product_name:String(issue.product_name??""),status:"WITHDRAWN",message,critical:"false"},{ttlSeconds:300,collapseKey:`withdraw-${issue.id}`,priority:"high"});if(r.invalidToken)invalid.push(String(device.fcm_token));}
    catch(e){console.warn("Withdrawal FCM deferred",errorText(e));}
  }));
  if(invalid.length)await admin.from("device_tokens").update({active:false}).in("fcm_token",invalid);
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors(req)});
  try{
    if(req.method!=="POST")throw new HttpError(405,"Chỉ hỗ trợ POST");
    const action=new URL(req.url).pathname.split("/").filter(Boolean).pop()??"";
    const body=await req.json().catch(()=>({})) as Record<string,unknown>;
    const context=await authenticated(req);
    if(action==="search"){
      requireRole(context,["PICKER"]);const q=String(body.query??"").trim();if(!/^\d{3,}$/.test(q))return json(req,{items:[]});
      const limit=Math.min(20,Math.max(1,Number(body.limit??20)));const {data,error}=await admin.from("sku_catalog").select("sku,product_name").eq("active",true).ilike("sku",`%${q}%`).order("sku").limit(limit);if(error)throw error;return json(req,{items:data??[]});
    }
    if(action==="my"){
      requireRole(context,["PICKER"]);
      const {data:reports,error}=await admin.from("issue_reports").select("id,issue_id,reported_at,withdrawn_at").eq("reporter_id",context.userId).order("reported_at",{ascending:false}).limit(500);if(error)throw error;
      const groups=new Map<string,{latest:any;active:any|null}>();
      for(const report of reports??[]){const id=String(report.issue_id);const g=groups.get(id)??{latest:report,active:null};if(!g.active&&!report.withdrawn_at)g.active=report;groups.set(id,g);}
      const byIssue=await issueMap([...groups.keys()]);const now=Date.now();const issues:any[]=[];
      for(const [id,g] of groups){const raw=byIssue.get(id);if(!raw)continue;const source=g.active??g.latest;const deadline=new Date(new Date(source.reported_at).getTime()+30000).toISOString();const withdrawn=!g.active&&Boolean(g.latest.withdrawn_at);const base=baseIssue(raw);issues.push({id:base.id,sku:base.sku,product_name:base.product_name,status:withdrawn?"WITHDRAWN":raw.status,reported_at:source.reported_at,updated_at:base.updated_at,issue_version:base.issue_version,assigned_id:base.assigned_id,withdrawn_at:withdrawn?g.latest.withdrawn_at:null,withdraw_allowed_until:deadline,can_withdraw:Boolean(g.active)&&now<=new Date(deadline).getTime()});}
      issues.sort((a,b)=>new Date(b.reported_at).getTime()-new Date(a.reported_at).getTime());return json(req,{issues:issues.slice(0,200)});
    }
    if(action==="board"){
      requireRole(context,["ADMIN","ADMIN_INVENT","INVENT"]);
      const {data:reports,error}=await admin.from("issue_reports").select("id,issue_id,reporter_id,reported_at,withdrawn_at").not("withdrawn_at","is",null).order("withdrawn_at",{ascending:false}).limit(200);if(error)throw error;
      const byIssue=await issueMap([...new Set((reports??[]).map((r:any)=>String(r.issue_id)))]);const reporterIds=[...new Set((reports??[]).map((r:any)=>String(r.reporter_id)))];const names=new Map<string,string>();
      if(reporterIds.length){const {data:profiles,error:pe}=await admin.from("profiles").select("id,full_name").in("id",reporterIds);if(pe)throw pe;(profiles??[]).forEach((p:any)=>names.set(String(p.id),String(p.full_name??"")));}
      const withdrawn=(reports??[]).flatMap((report:any)=>{const raw=byIssue.get(String(report.issue_id));if(!raw)return[];const message=raw.status==="CLOSED"?"Không còn lượt báo nào chưa thu hồi; đợt xử lý đã đóng.":"SKU vẫn còn nhu cầu xử lý từ lượt báo khác.";return [{...baseIssue(raw),status:"WITHDRAWN",reported_at:report.reported_at,updated_at:report.withdrawn_at,withdrawn_at:report.withdrawn_at,latest_reporter_name:names.get(String(report.reporter_id))??"",latest_message:message,can_withdraw:false}];});
      return json(req,{withdrawn});
    }
    if(action==="withdraw"){
      requireRole(context,["PICKER"]);const issueId=String(body.issue_id??"").trim();if(!/^[0-9a-f-]{36}$/i.test(issueId))throw new HttpError(400,"Mã báo thiếu không hợp lệ");
      const {data,error}=await admin.rpc("withdraw_shortage_atomic",{p_issue_id:issueId,p_reporter:context.userId});if(error){const m=errorText(error);if(m.includes("WITHDRAW_WINDOW_EXPIRED"))throw new HttpError(409,"Đã quá 30 giây nên không thể thu hồi SKU này");if(m.includes("REPORT_NOT_FOUND"))throw new HttpError(404,"Không tìm thấy lượt báo đang có thể thu hồi");throw error;}
      await admin.from("notification_events").update({acknowledged_at:new Date().toISOString()}).eq("issue_id",issueId).eq("target_user_id",context.userId).is("acknowledged_at",null);
      if(!data.already_withdrawn)await notifyOperators(context,data);
      return json(req,{withdrawn:true,withdrawn_at:data.withdrawn_at,remaining_report_count:Number(data.remaining_report_count??0),already_withdrawn:Boolean(data.already_withdrawn)});
    }
    throw new HttpError(404,"Chức năng không tồn tại");
  }catch(e){console.error(errorText(e));return json(req,{error:errorText(e)},e instanceof HttpError?e.status:500);}
});
