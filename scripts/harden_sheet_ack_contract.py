from pathlib import Path
import re
ROOT=Path('.')

# API legacy/manual sync path: exact event ACKs only; no generic sla-tick export.
p=ROOT/'supabase/functions/api/index.ts'
s=p.read_text(encoding='utf-8')
pattern=r'''async function syncSheet\(\) \{.*?\n\}\n\nasync function resendPendingCritical'''
replacement=r'''async function syncSheet() {
  const url = Deno.env.get("GOOGLE_SHEET_WEBHOOK_URL") ?? "";
  const secret = Deno.env.get("GOOGLE_SHEET_WEBHOOK_SECRET") ?? "";
  if (!url || !secret) throw new HttpError(503, "Chưa cấu hình Google Sheet webhook");
  const { data: waiting, error } = await admin.from("sheet_export_queue").select("*").is("sheet_ack_at", null).order("id").limit(500);
  if (error) throw error;
  const events = waiting ?? [];
  if (!events.length) return { exported: 0, remaining: 0 };
  const response = await fetch(url, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ secret, mode: "export", events }),
  });
  const responseText = await response.text();
  if (!response.ok) throw new Error(`Google Sheet ${response.status}: ${responseText.slice(0, 300)}`);
  const sheetResult = JSON.parse(responseText) as { ok?: boolean; error?: string; ack_event_ids?: string[] };
  if (sheetResult.ok !== true) throw new Error(`Google Sheet từ chối đồng bộ: ${sheetResult.error ?? "Không rõ lỗi"}`);
  const requested = new Set(events.map((event: any) => String(event.event_id ?? "")).filter(Boolean));
  const acked = Array.isArray(sheetResult.ack_event_ids)
    ? [...new Set(sheetResult.ack_event_ids.map(String).filter((id) => requested.has(id)))]
    : [];
  if (!acked.length) throw new Error("Google Sheet chưa ACK event nào; queue được giữ nguyên");
  const now = new Date().toISOString();
  const { error: ackError } = await admin.from("sheet_export_queue")
    .update({ exported_at: now, sheet_ack_at: now, reconciliation_status: "SHEET_ACKED" })
    .in("event_id", acked);
  if (ackError) throw ackError;
  const { count, error: countError } = await admin.from("sheet_export_queue").select("id", { count: "exact", head: true }).is("sheet_ack_at", null);
  if (countError) throw countError;
  return { exported: acked.length, remaining: count ?? 0 };
}

async function resendPendingCritical'''
s2,n=re.subn(pattern,replacement,s,flags=re.S)
if n!=1: raise SystemExit(f'api syncSheet replacement count={n}')
s=s2
s=s.replace('''  await resendPendingCritical();if(await staffSyncDue().catch(()=>false)){try{await syncStaffDirectory("AUTO",null);}catch(error){console.warn("Staff sync deferred",errorText(error));}}try{await syncSheet();}catch(error){console.warn("Sheet sync deferred",errorText(error));}\n''','''  await resendPendingCritical();if(await staffSyncDue().catch(()=>false)){try{await syncStaffDirectory("AUTO",null);}catch(error){console.warn("Staff sync deferred",errorText(error));}}\n''')
p.write_text(s,encoding='utf-8')

# Dedicated worker: no legacy ACK inference in target source.
p=ROOT/'supabase/functions/sheet-worker/index.ts'
s=p.read_text(encoding='utf-8')
old='''    const acked = Array.isArray(result.ack_event_ids) && result.ack_event_ids.length\n      ? result.ack_event_ids.filter((id) => requestedIds.includes(String(id))).map(String)\n      : requestedIds; // compatibility with the currently deployed legacy script during cutover.\n    if (!acked.length) throw new Error("Google Sheet returned no acknowledgements");'''
new='''    const acked = Array.isArray(result.ack_event_ids)\n      ? [...new Set(result.ack_event_ids.filter((id) => requestedIds.includes(String(id))).map(String))]\n      : [];\n    if (!acked.length) throw new Error("Google Sheet returned no event acknowledgements; queue retained");'''
if old not in s: raise SystemExit('sheet-worker compatibility marker missing')
p.write_text(s.replace(old,new,1),encoding='utf-8')

Path('scripts/harden_sheet_ack_contract.py').unlink()
print('SHEET_ACK_CONTRACT=STRICT')
