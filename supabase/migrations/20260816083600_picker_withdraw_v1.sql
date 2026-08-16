alter table public.issue_reports
  add column if not exists withdrawn_at timestamptz;

create index if not exists issue_reports_withdrawn_idx
  on public.issue_reports(withdrawn_at desc)
  where withdrawn_at is not null;

create or replace function public.withdraw_shortage_atomic(p_issue_id uuid, p_reporter uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_issue public.issues%rowtype;
  v_report public.issue_reports%rowtype;
  v_from public.issue_status;
  v_remaining integer := 0;
  v_now timestamptz := now();
begin
  if p_reporter is null or not exists(select 1 from public.profiles where id=p_reporter and active=true) then
    raise exception 'USER_INACTIVE';
  end if;

  select * into v_issue from public.issues where id=p_issue_id;
  if not found then raise exception 'ISSUE_NOT_FOUND'; end if;

  perform pg_advisory_xact_lock(hashtextextended(lower(trim(v_issue.sku)),1291));
  select * into v_issue from public.issues where id=p_issue_id for update;
  v_from := v_issue.status;

  -- Always target the reporter's latest action for this issue. If a network retry
  -- arrives after a successful withdrawal, return the same result instead of
  -- withdrawing an older report from the same Picker.
  select * into v_report
    from public.issue_reports
   where issue_id=p_issue_id and reporter_id=p_reporter
   order by reported_at desc
   limit 1
   for update;

  if not found then
    raise exception 'REPORT_NOT_FOUND';
  end if;

  if v_report.withdrawn_at is not null then
    select count(*) into v_remaining
      from public.issue_reports
     where issue_id=p_issue_id and withdrawn_at is null;
    return jsonb_build_object(
      'issue', public.issue_json(v_issue),
      'withdrawn_at', v_report.withdrawn_at,
      'remaining_report_count', v_remaining,
      'already_withdrawn', true
    );
  end if;

  if v_now > v_report.reported_at + interval '30 seconds' then
    raise exception 'WITHDRAW_WINDOW_EXPIRED';
  end if;

  update public.issue_reports
     set withdrawn_at=v_now
   where id=v_report.id
   returning * into v_report;

  select count(*) into v_remaining
    from public.issue_reports
   where issue_id=p_issue_id and withdrawn_at is null;

  if v_remaining = 0 and v_issue.status in ('OPEN','CLAIMED','SEARCHING','REPLENISHING') then
    update public.issues
       set status='CLOSED', resolved_at=v_now, claimed_by=null, claimed_at=null,
           updated_at=v_now, issue_version=issue_version+1
     where id=p_issue_id
     returning * into v_issue;
  else
    update public.issues
       set updated_at=v_now, issue_version=issue_version+1
     where id=p_issue_id
     returning * into v_issue;
  end if;

  insert into public.issue_audit(issue_id,actor_id,action,from_status,to_status,detail)
  values(v_issue.id,p_reporter,'WITHDRAW_SHORTAGE',v_from,v_issue.status,
    jsonb_build_object(
      'withdrawn_report_id',v_report.id,
      'withdrawn_at',v_now,
      'remaining_report_count',v_remaining,
      'issue_version',v_issue.issue_version
    ));

  return jsonb_build_object(
    'issue', public.issue_json(v_issue),
    'withdrawn_at', v_now,
    'remaining_report_count', v_remaining,
    'already_withdrawn', false
  );
end;
$$;

revoke all on function public.withdraw_shortage_atomic(uuid,uuid) from public;
grant execute on function public.withdraw_shortage_atomic(uuid,uuid) to service_role;
