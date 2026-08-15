begin;

drop trigger if exists trg_handler_first_open_alert on public.issues;
drop function if exists public.notify_handlers_on_new_issue();

-- Cleanup only duplicate critical OPEN alerts introduced by the superseded trigger.
delete from public.notification_events
where status='OPEN'
  and critical=true
  and title like 'CÓ SKU CẦN XỬ LÝ • SKU %'
  and created_at >= timestamp with time zone '2026-08-15 16:08:23+00';

-- OPEN handler alerts are direct, non-critical and shown only once (displayed_at gate).
-- Picker AVAILABLE/SKIP alerts remain critical until explicit acknowledgement.
create or replace function public.pending_alerts_rpc()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role public.user_role;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select role into v_role from public.profiles where id=v_uid and active=true;
  if v_role is null then raise exception 'AUTH_REQUIRED'; end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id',n.id,
        'issue_id',n.issue_id,
        'issue_version',n.issue_version,
        'status',n.status,
        'title',n.title,
        'message',n.message,
        'critical',n.critical,
        'created_at',n.created_at,
        'sent_at',n.sent_at,
        'fcm_accepted_at',n.fcm_accepted_at,
        'issue',public.issue_client_json_internal(i,false)
      ) order by n.created_at
    )
    from public.notification_events n
    join public.issues i on i.id=n.issue_id
    where n.target_user_id=v_uid
      and n.expires_at>now()
      and i.status=n.status
      and i.issue_version=n.issue_version
      and (
        (
          n.status='OPEN'
          and n.critical=false
          and v_role in ('INVENT','ADMIN_INVENT','ADMIN')
          and n.displayed_at is null
        )
        or (
          n.status in ('AVAILABLE','SKIP_ALLOWED')
          and n.critical=true
          and n.acknowledged_at is null
        )
      )
  ), '[]'::jsonb);
end;
$$;

commit;
