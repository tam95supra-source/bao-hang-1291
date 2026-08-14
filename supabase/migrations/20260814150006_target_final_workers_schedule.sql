begin;

alter table public.notification_events
  add column if not exists last_attempt_at timestamptz;
create index if not exists notification_due_critical_idx
  on public.notification_events(last_attempt_at,created_at)
  where critical=true and acknowledged_at is null;

create or replace function public.dispatch_due_picker_alerts()
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  r record;
  v_count integer:=0;
  v_minutes integer;
begin
  select greatest(1,least(60,picker_ack_reminder_minutes)) into v_minutes
  from public.app_config where singleton=true;

  for r in
    select distinct n.issue_id,n.issue_version,n.status
    from public.notification_events n
    join public.issues i on i.id=n.issue_id
    where n.critical=true
      and n.acknowledged_at is null
      and n.expires_at>now()
      and n.status in ('AVAILABLE','SKIP_ALLOWED')
      and i.status=n.status
      and i.issue_version=n.issue_version
      and n.created_at <= now()-(v_minutes||' minutes')::interval
      and coalesce(n.last_attempt_at,'-infinity'::timestamptz) <= now()-(v_minutes||' minutes')::interval
    order by n.issue_id
    limit 20
  loop
    update public.notification_events
      set last_attempt_at=now()
      where issue_id=r.issue_id and issue_version=r.issue_version and status=r.status
        and critical=true and acknowledged_at is null;
    perform net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name='bao_hang_1291_project_url') || '/functions/v1/notification-worker/run',
      headers := jsonb_build_object(
        'content-type','application/json',
        'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='bao_hang_1291_cron_secret')
      ),
      body := jsonb_build_object('issue_id',r.issue_id,'issue_version',r.issue_version,'status',r.status),
      timeout_milliseconds := 15000
    );
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;
revoke execute on function public.dispatch_due_picker_alerts() from public,anon,authenticated;

do $$
declare r record;
begin
  for r in select jobid from cron.job where jobname in (
    'bao-hang-1291-sheet-sync-day','bao-hang-1291-sheet-sync-midnight',
    'bao-hang-1291-staff-watch','bao-hang-1291-staff-watch-hourly',
    'bao-hang-1291-picker-alert-dispatch'
  ) loop
    perform cron.unschedule(r.jobid);
  end loop;
end $$;

-- pg_cron runs GMT. Bangkok 05:00-23:30 => UTC 22:00-23:30 + 00:00-16:30.
select cron.schedule(
  'bao-hang-1291-sheet-sync-day',
  '0,30 0-16,22-23 * * *',
  $$select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name='bao_hang_1291_project_url') || '/functions/v1/sheet-worker/run',
      headers := jsonb_build_object('content-type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='bao_hang_1291_cron_secret')),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );$$
);
-- Bangkok 00:00 final flush => UTC 17:00.
select cron.schedule(
  'bao-hang-1291-sheet-sync-midnight',
  '0 17 * * *',
  $$select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name='bao_hang_1291_project_url') || '/functions/v1/sheet-worker/run',
      headers := jsonb_build_object('content-type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='bao_hang_1291_cron_secret')),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );$$
);

-- Source staff watcher already hashes the filtered roster and returns NO_CHANGE.
select cron.schedule(
  'bao-hang-1291-staff-watch-hourly',
  '15 * * * *',
  $$select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name='bao_hang_1291_project_url') || '/functions/v1/staff-watch',
      headers := jsonb_build_object('content-type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='bao_hang_1291_cron_secret')),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );$$
);

-- SQL tick is cheap; Edge is invoked only when a current critical alert is actually due.
select cron.schedule(
  'bao-hang-1291-picker-alert-dispatch',
  '* * * * *',
  $$select public.dispatch_due_picker_alerts();$$
);

commit;
