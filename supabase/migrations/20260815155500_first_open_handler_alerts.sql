begin;

-- Alert active handlers only when a NEW issue episode is created.
-- Repeated reports on the same open issue only increment report_count + audit and do not re-alert.
create or replace function public.notify_handlers_on_new_issue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer := 0;
begin
  if new.status <> 'OPEN' or new.report_count <> 1 then
    return new;
  end if;

  insert into public.notification_events(
    issue_id,target_user_id,status,issue_version,title,message,critical,expires_at
  )
  select
    new.id,
    p.id,
    'OPEN'::public.issue_status,
    new.issue_version,
    'CÓ SKU CẦN XỬ LÝ • SKU ' || new.sku,
    'SKU ' || new.sku || ' vừa được báo thiếu. Chọn NHẬN XỬ LÝ nếu bạn tiếp nhận SKU này.',
    true,
    now() + interval '24 hours'
  from public.profiles p
  where p.active = true
    and p.role in ('INVENT','ADMIN_INVENT','ADMIN')
  on conflict(target_user_id,issue_id,issue_version,status)
    where critical = true and issue_id is not null
  do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted > 0 then
    perform net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name='bao_hang_1291_project_url') || '/functions/v1/notification-worker/run',
      headers := jsonb_build_object(
        'content-type','application/json',
        'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='bao_hang_1291_cron_secret')
      ),
      body := jsonb_build_object(
        'issue_id',new.id,
        'issue_version',new.issue_version,
        'status','OPEN'
      ),
      timeout_milliseconds := 15000
    );
  end if;
  return new;
end;
$$;

revoke execute on function public.notify_handlers_on_new_issue() from public, anon, authenticated;

drop trigger if exists trg_handler_first_open_alert on public.issues;
create trigger trg_handler_first_open_alert
after insert on public.issues
for each row execute function public.notify_handlers_on_new_issue();

-- Picker result alerts remain until acknowledged. Handler OPEN alerts are shown only once:
-- after first display they no longer appear in pending-alert catch-up.
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
      and n.critical=true
      and n.expires_at>now()
      and i.status=n.status
      and i.issue_version=n.issue_version
      and (
        (
          n.status='OPEN'
          and v_role in ('INVENT','ADMIN_INVENT','ADMIN')
          and n.displayed_at is null
        )
        or (
          n.status in ('AVAILABLE','SKIP_ALLOWED')
          and n.acknowledged_at is null
        )
      )
  ), '[]'::jsonb);
end;
$$;

commit;
