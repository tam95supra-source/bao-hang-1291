from pathlib import Path
p=Path('supabase/functions/api/index.ts')
s=p.read_text(encoding='utf-8')
old='''    case "pending-alerts": {
      const { data, error } = await admin.from("notification_events").select("id,issue_id,issue_version,status,title,message,critical,created_at,sent_at,fcm_accepted_at")
        .eq("target_user_id", context.userId).eq("critical", true).is("acknowledged_at", null).order("created_at").limit(50);
      if (error) throw error;
      const ids = [...new Set<string>((data ?? []).map((row: any) => String(row.issue_id ?? "")).filter(Boolean))];
      const issues = ids.length ? await issueRows(ids) : [];
      const byId = new Map<string, any>(issues.map((issue: any) => [String(issue.id), issue]));
      return { events: (data ?? []).filter((event) => {
        const issue = byId.get(event.issue_id);
        return issue?.status === event.status && Number(issue.issue_version) === Number(event.issue_version);
      }).map((event) => ({ ...event, issue: pickerIssue(byId.get(event.issue_id)) })) };
    }
'''
new='''    case "pending-alerts": {
      const { data, error } = await admin.from("notification_events")
        .select("id,issue_id,issue_version,status,title,message,critical,created_at,sent_at,fcm_accepted_at,displayed_at,acknowledged_at,expires_at")
        .eq("target_user_id", context.userId)
        .gt("expires_at", new Date().toISOString())
        .order("created_at")
        .limit(100);
      if (error) throw error;
      const eligible = (data ?? []).filter((event: any) => {
        if (event.status === "OPEN") {
          return event.critical === false
            && context.effectiveRole !== "PICKER"
            && !event.displayed_at;
        }
        return ["AVAILABLE", "SKIP_ALLOWED"].includes(String(event.status))
          && event.critical === true
          && !event.acknowledged_at;
      });
      const ids = [...new Set<string>(eligible.map((row: any) => String(row.issue_id ?? "")).filter(Boolean))];
      const issues = ids.length ? await issueRows(ids) : [];
      const byId = new Map<string, any>(issues.map((issue: any) => [String(issue.id), issue]));
      return { events: eligible.filter((event: any) => {
        const issue = byId.get(event.issue_id);
        return issue?.status === event.status && Number(issue.issue_version) === Number(event.issue_version);
      }).map((event: any) => ({
        ...event,
        issue: event.status === "OPEN" ? byId.get(event.issue_id) : pickerIssue(byId.get(event.issue_id)),
      })) };
    }
'''
if s.count(old)!=1: raise SystemExit(f'pending-alerts anchor count={s.count(old)}')
s=s.replace(old,new,1)
for token in ['event.status === "OPEN"','!event.displayed_at','event.critical === false','!event.acknowledged_at']:
    if token not in s: raise SystemExit(f'missing guard {token}')
p.write_text(s,encoding='utf-8')
print('PENDING_OPEN_ALERT_PATCH=PASS')
