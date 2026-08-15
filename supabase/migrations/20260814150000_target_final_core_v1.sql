begin;

-- Target 14/08/2026: 45-day business retention and no automatic SKIP.
update public.app_config
set retention_days = 45,
    auto_skip_enabled = false,
    updated_at = now()
where singleton = true;

alter table public.app_config drop constraint if exists app_config_auto_skip_disabled;
alter table public.app_config
  add constraint app_config_auto_skip_disabled check (auto_skip_enabled = false);

-- Keep the legacy callable during rollout, but make it permanently non-mutating.
create or replace function public.auto_skip_overdue_service()
returns table(issue_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return;
end;
$$;

-- Sheet outbox is upgraded to an authority-event envelope without breaking old callers.
alter table public.sheet_export_queue
  add column if not exists event_id uuid,
  add column if not exists source_mode text,
  add column if not exists occurred_at_device timestamptz,
  add column if not exists accepted_at_authority timestamptz,
  add column if not exists actor_account_id uuid,
  add column if not exists actor_role text,
  add column if not exists device_id text,
  add column if not exists issue_id uuid,
  add column if not exists sku text,
  add column if not exists issue_version bigint,
  add column if not exists payload_sha256 text,
  add column if not exists service_ack_at timestamptz,
  add column if not exists sheet_ack_at timestamptz,
  add column if not exists reconciliation_status text;

update public.sheet_export_queue
set event_id = coalesce(event_id, gen_random_uuid()),
    source_mode = coalesce(source_mode, 'SERVICE'),
    accepted_at_authority = coalesce(accepted_at_authority, created_at),
    occurred_at_device = coalesce(occurred_at_device, created_at),
    issue_id = coalesce(issue_id, nullif(payload->>'id','')::uuid),
    sku = coalesce(sku, payload->>'sku'),
    issue_version = coalesce(issue_version, nullif(payload->>'issue_version','')::bigint),
    payload_sha256 = coalesce(payload_sha256, encode(extensions.digest(convert_to(payload::text,'UTF8'),'sha256'),'hex')),
    service_ack_at = coalesce(service_ack_at, created_at),
    sheet_ack_at = coalesce(sheet_ack_at, exported_at),
    reconciliation_status = coalesce(reconciliation_status, case when exported_at is null then 'PENDING' else 'SHEET_ACKED' end);

alter table public.sheet_export_queue
  alter column event_id set default gen_random_uuid(),
  alter column event_id set not null,
  alter column source_mode set default 'SERVICE',
  alter column source_mode set not null,
  alter column accepted_at_authority set default now(),
  alter column accepted_at_authority set not null,
  alter column service_ack_at set default now(),
  alter column reconciliation_status set default 'PENDING',
  alter column reconciliation_status set not null;

create unique index if not exists sheet_export_event_id_unique on public.sheet_export_queue(event_id);
create index if not exists sheet_export_issue_ack_idx on public.sheet_export_queue(issue_id, sheet_ack_at) where issue_id is not null;
create index if not exists sheet_export_oldest_pending_idx on public.sheet_export_queue(created_at) where sheet_ack_at is null;

alter table public.sheet_export_queue drop constraint if exists sheet_export_source_mode_check;
alter table public.sheet_export_queue add constraint sheet_export_source_mode_check
  check (source_mode in ('SERVICE','SHEET_FALLBACK','FIREBASE_EMERGENCY'));

create or replace function public.fill_sheet_outbox_envelope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.event_id := coalesce(new.event_id, gen_random_uuid());
  new.source_mode := coalesce(nullif(new.source_mode,''), 'SERVICE');
  new.accepted_at_authority := coalesce(new.accepted_at_authority, new.created_at, now());
  new.occurred_at_device := coalesce(new.occurred_at_device, new.accepted_at_authority);
  new.issue_id := coalesce(new.issue_id, case when coalesce(new.payload->>'id','') ~* '^[0-9a-f-]{36}$' then (new.payload->>'id')::uuid else null end);
  new.sku := coalesce(new.sku, nullif(new.payload->>'sku',''));
  new.issue_version := coalesce(new.issue_version, nullif(new.payload->>'issue_version','')::bigint);
  new.actor_account_id := coalesce(new.actor_account_id,
    case when coalesce(new.payload->>'actor_id', new.payload->>'reporter_id','') ~* '^[0-9a-f-]{36}$'
      then coalesce(new.payload->>'actor_id', new.payload->>'reporter_id')::uuid else null end);
  new.payload_sha256 := encode(extensions.digest(convert_to(coalesce(new.payload,'{}'::jsonb)::text,'UTF8'),'sha256'),'hex');
  new.service_ack_at := coalesce(new.service_ack_at, new.created_at, now());
  if new.exported_at is not null then
    new.sheet_ack_at := coalesce(new.sheet_ack_at, new.exported_at);
    new.reconciliation_status := 'SHEET_ACKED';
  else
    new.reconciliation_status := coalesce(nullif(new.reconciliation_status,''),'PENDING');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fill_sheet_outbox_envelope on public.sheet_export_queue;
create trigger trg_fill_sheet_outbox_envelope
before insert or update on public.sheet_export_queue
for each row execute function public.fill_sheet_outbox_envelope();

-- Durable reconciliation ledger. No client policy is granted.
create table if not exists public.authority_events (
  event_id uuid primary key,
  source_mode text not null check (source_mode in ('SERVICE','SHEET_FALLBACK','FIREBASE_EMERGENCY')),
  event_type text not null,
  occurred_at_device timestamptz,
  accepted_at_authority timestamptz not null default now(),
  actor_account_id uuid,
  actor_role text,
  device_id text,
  issue_id uuid,
  sku text,
  issue_version bigint,
  payload_json jsonb not null default '{}'::jsonb,
  payload_sha256 text not null,
  service_ack_at timestamptz,
  sheet_ack_at timestamptz,
  reconciliation_status text not null default 'PENDING',
  created_at timestamptz not null default now()
);
alter table public.authority_events enable row level security;
create index if not exists authority_events_cursor_idx on public.authority_events(accepted_at_authority,event_id);
create index if not exists authority_events_reconcile_idx on public.authority_events(reconciliation_status,accepted_at_authority);

create table if not exists public.cleanup_audit (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  deleted_issues integer not null default 0,
  deleted_notifications integer not null default 0,
  deleted_outbox integer not null default 0,
  min_business_time timestamptz,
  max_business_time timestamptz,
  error_text text not null default ''
);
alter table public.cleanup_audit enable row level security;

create table if not exists public.security_audit (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  target_kind text not null default '',
  target_id text not null default '',
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.security_audit enable row level security;
create index if not exists security_audit_created_idx on public.security_audit(created_at desc);

alter table public.notification_events
  add column if not exists expires_at timestamptz;
update public.notification_events
set expires_at = coalesce(expires_at, created_at + interval '24 hours');
alter table public.notification_events
  alter column expires_at set default (now() + interval '24 hours'),
  alter column expires_at set not null;
create unique index if not exists notification_current_unique
  on public.notification_events(target_user_id, issue_id, issue_version, status)
  where issue_id is not null;
create index if not exists notification_retention_idx on public.notification_events(created_at)
  where acknowledged_at is not null;

-- Same request id remains idempotent; a new report on an open issue does not change state version.
create or replace function public.report_shortage_atomic(p_sku text, p_reporter uuid, p_client_request_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.sku_catalog%rowtype;
  v_issue public.issues%rowtype;
  v_previous uuid;
  v_already boolean := false;
  v_normalized text := lower(trim(p_sku));
begin
  perform pg_advisory_xact_lock(hashtextextended(v_normalized,1291));
  if p_client_request_id is not null and trim(p_client_request_id) <> '' then
    select i.* into v_issue
    from public.issue_reports r join public.issues i on i.id=r.issue_id
    where r.client_request_id=trim(p_client_request_id);
    if found then
      return jsonb_build_object('issue',public.issue_json(v_issue),'already_reported',true,'duplicate_request',true,'message','Yêu cầu đã được đồng bộ trước đó');
    end if;
  end if;
  select * into v_item from public.sku_catalog where lower(sku)=v_normalized and active=true limit 1;
  if not found then raise exception 'SKU_NOT_FOUND'; end if;
  if not exists(select 1 from public.profiles where id=p_reporter and active=true) then raise exception 'USER_INACTIVE'; end if;
  select * into v_issue from public.issues
  where sku=v_item.sku and status in ('OPEN','CLAIMED','SEARCHING','REPLENISHING')
  order by first_reported_at asc limit 1 for update;
  if found then
    v_already:=true;
    update public.issues set report_count=report_count+1, updated_at=now()
    where id=v_issue.id returning * into v_issue;
  else
    select id into v_previous from public.issues
    where sku=v_item.sku and status in ('AVAILABLE','SKIP_ALLOWED','CLOSED')
    order by coalesce(resolved_at,updated_at) desc limit 1;
    insert into public.issues(sku,product_name_snapshot,status,report_count,first_reported_at,previous_issue_id,issue_version)
    values(v_item.sku,v_item.product_name,'OPEN',1,now(),v_previous,1) returning * into v_issue;
  end if;
  insert into public.issue_reports(issue_id,reporter_id,client_request_id)
  values(v_issue.id,p_reporter,nullif(trim(p_client_request_id),''));
  insert into public.issue_audit(issue_id,actor_id,action,to_status,detail)
  values(v_issue.id,p_reporter,'REPORT_SHORTAGE',v_issue.status,
    jsonb_build_object('already_reported',v_already,'report_count',v_issue.report_count,'issue_version',v_issue.issue_version,'previous_issue_id',v_issue.previous_issue_id));
  insert into public.sheet_export_queue(event_type,payload,actor_account_id,issue_id,sku,issue_version)
  values('REPORT_SHORTAGE',public.issue_json(v_issue)||jsonb_build_object('reporter_id',p_reporter),p_reporter,v_issue.id,v_issue.sku,v_issue.issue_version);
  return jsonb_build_object('issue',public.issue_json(v_issue),'already_reported',v_already,'duplicate_request',false,'message','Đã ghi nhận báo thiếu');
end;
$$;

-- Auth-bound RPCs used by Android/Web when Edge is unavailable.
create or replace function public.report_shortage_rpc(p_sku text, p_client_request_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid:=auth.uid(); v_role public.user_role; v_result jsonb;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select role into v_role from public.profiles where id=v_uid and active=true;
  if v_role not in ('PICKER','ADMIN') then raise exception 'FORBIDDEN'; end if;
  v_result:=public.report_shortage_atomic(p_sku,v_uid,p_client_request_id);
  return jsonb_build_object(
    'issue', (v_result->'issue') - 'report_count' - 'latest_reporter_name' - 'assigned_name' - 'assigned_id',
    'already_reported', coalesce((v_result->>'already_reported')::boolean,false),
    'duplicate_request', coalesce((v_result->>'duplicate_request')::boolean,false),
    'message', coalesce(v_result->>'message','Đã ghi nhận báo thiếu')
  );
end;
$$;

create or replace function public.claim_issue_rpc(p_issue_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid:=auth.uid(); v_role public.user_role;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select role into v_role from public.profiles where id=v_uid and active=true;
  if v_role not in ('ADMIN','ADMIN_INVENT','INVENT') then raise exception 'FORBIDDEN'; end if;
  return public.update_issue_atomic(p_issue_id,v_uid,'CLAIM');
end;
$$;

create or replace function public.update_issue_rpc(p_issue_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid:=auth.uid(); v_role public.user_role; v_action text:=upper(trim(p_action));
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select role into v_role from public.profiles where id=v_uid and active=true;
  if v_role not in ('ADMIN','ADMIN_INVENT','INVENT') then raise exception 'FORBIDDEN'; end if;
  if v_action='SKIP_ALLOWED' then v_action:='NOT_FOUND'; end if;
  if v_action not in ('AVAILABLE','NOT_FOUND') and not (v_action='CLOSE' and v_role='ADMIN') then raise exception 'INVALID_ACTION'; end if;
  return public.update_issue_atomic(p_issue_id,v_uid,v_action);
end;
$$;

create or replace function public.reassign_issue_rpc(p_issue_id uuid, p_new_assignee uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid:=auth.uid(); v_role public.user_role;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select role into v_role from public.profiles where id=v_uid and active=true;
  if v_role not in ('ADMIN','ADMIN_INVENT') then raise exception 'FORBIDDEN'; end if;
  return public.reassign_issue_atomic(p_issue_id,v_uid,p_new_assignee,p_reason);
end;
$$;

-- Realtime authorization: Picker gets own user channel plus catalog only; board/staff/config are role-scoped.
drop policy if exists bao_hang_1291_receive_broadcast on realtime.messages;
drop policy if exists bao_hang_1291_target_receive on realtime.messages;
create policy bao_hang_1291_target_receive
on realtime.messages for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id=auth.uid() and p.active=true and (
      realtime.topic() = ('user:1291:' || auth.uid()::text)
      or realtime.topic() = 'site:1291:catalog'
      or (p.role in ('INVENT','ADMIN_INVENT','ADMIN') and realtime.topic() in ('site:1291:issues','site:1291:staff'))
      or (p.role in ('ADMIN_INVENT','ADMIN') and realtime.topic() = 'site:1291:config')
    )
  )
);

create or replace function public.broadcast_picker_status_delta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid;
begin
  if tg_op='UPDATE' and new.status is distinct from old.status and new.status in ('AVAILABLE','SKIP_ALLOWED') then
    for v_user in select distinct reporter_id from public.issue_reports where issue_id=new.id loop
      perform realtime.send(
        jsonb_build_object('issue_id',new.id,'issue_version',new.issue_version,'status',new.status,'sku',new.sku,'updated_at',new.updated_at),
        'picker_status_changed',
        'user:1291:' || v_user::text,
        true
      );
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_picker_status_broadcast on public.issues;
create trigger trg_picker_status_broadcast
after update of status on public.issues
for each row execute function public.broadcast_picker_status_delta();

-- SQL-first SLA: empty ticks do not invoke Edge.
create or replace function public.process_sla_broadcast()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare r record; v_count integer:=0;
begin
  for r in select * from public.process_sla() loop
    perform realtime.send(
      jsonb_build_object('issue_id',r.issue_id,'status',r.event_status,'kind',r.event_kind),
      'sla_overdue','site:1291:issues',true);
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

-- Retention: terminal business rows only after no unacknowledged Sheet event remains.
create or replace function public.purge_old_data()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer;
  v_issue_ids uuid[];
  v_issue_count integer:=0;
  v_notification_count integer:=0;
  v_outbox_count integer:=0;
  v_audit_id bigint;
  v_min timestamptz;
  v_max timestamptz;
begin
  select greatest(7,least(365,retention_days)) into v_days from public.app_config where singleton=true;
  insert into public.cleanup_audit default values returning id into v_audit_id;

  select array_agg(id), min(resolved_at), max(resolved_at)
  into v_issue_ids,v_min,v_max
  from (
    select i.id,i.resolved_at
    from public.issues i
    where i.status in ('AVAILABLE','SKIP_ALLOWED','CLOSED')
      and i.resolved_at < now()-(v_days||' days')::interval
      and not exists (
        select 1 from public.sheet_export_queue q
        where q.issue_id=i.id and q.sheet_ack_at is null
      )
    order by i.resolved_at
    limit 500
  ) s;

  if coalesce(array_length(v_issue_ids,1),0)>0 then
    delete from public.issues where id=any(v_issue_ids);
    get diagnostics v_issue_count=row_count;
  end if;

  delete from public.notification_events
  where id in (
    select id from public.notification_events
    where created_at < now()-interval '7 days'
      and (acknowledged_at is not null or expires_at < now())
    order by created_at limit 1000
  );
  get diagnostics v_notification_count=row_count;

  delete from public.sheet_export_queue
  where id in (
    select id from public.sheet_export_queue
    where sheet_ack_at is not null and sheet_ack_at < now()-interval '7 days'
    order by sheet_ack_at limit 1000
  );
  get diagnostics v_outbox_count=row_count;

  update public.cleanup_audit set finished_at=now(),deleted_issues=v_issue_count,
    deleted_notifications=v_notification_count,deleted_outbox=v_outbox_count,
    min_business_time=v_min,max_business_time=v_max where id=v_audit_id;
  return v_issue_count;
exception when others then
  update public.cleanup_audit set finished_at=now(),error_text=sqlerrm where id=v_audit_id;
  raise;
end;
$$;

-- Remove public execution from internal SECURITY DEFINER/trigger helpers.
revoke execute on function public.report_shortage_atomic(text,uuid,text) from public,anon,authenticated;
revoke execute on function public.update_issue_atomic(uuid,uuid,text) from public,anon,authenticated;
revoke execute on function public.reassign_issue_atomic(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke execute on function public.auto_skip_overdue_service() from public,anon,authenticated;
revoke execute on function public.purge_old_data() from public,anon,authenticated;
revoke execute on function public.process_sla() from public,anon,authenticated;
revoke execute on function public.process_sla_broadcast() from public,anon,authenticated;
revoke execute on function public.broadcast_issue_delta() from public,anon,authenticated;
revoke execute on function public.broadcast_profile_change() from public,anon,authenticated;
revoke execute on function public.broadcast_picker_status_delta() from public,anon,authenticated;
revoke execute on function public.fill_sheet_outbox_envelope() from public,anon,authenticated;
revoke execute on function public.issue_json(public.issues) from public,anon,authenticated;
revoke execute on function public.protect_single_admin() from public,anon,authenticated;
revoke execute on function public.refresh_sku_search_text() from public,anon,authenticated;
revoke execute on function public.enforce_diagnostic_log_quota() from public,anon,authenticated;

grant execute on function public.report_shortage_rpc(text,text) to authenticated;
grant execute on function public.claim_issue_rpc(uuid) to authenticated;
grant execute on function public.update_issue_rpc(uuid,text) to authenticated;
grant execute on function public.reassign_issue_rpc(uuid,uuid,text) to authenticated;

-- Replace minute Edge EMPTY calls with SQL SLA, and use Edge only for scheduled Sheet integration.
do $$
declare r record;
begin
  for r in select jobid from cron.job where jobname in ('bao-hang-1291-sla','bao-hang-1291-staff-watch','bao-hang-1291-sla-sql','bao-hang-1291-sheet-sync-day','bao-hang-1291-sheet-sync-midnight') loop
    perform cron.unschedule(r.jobid);
  end loop;
end $$;
select cron.schedule('bao-hang-1291-sla-sql','* * * * *',$$select public.process_sla_broadcast();$$);

-- Existing authenticated Edge route is retained for Sheet export during the staged rollout.
-- Its invocation cadence is reduced from every minute to the exact target export windows.
select cron.schedule('bao-hang-1291-sheet-sync-day','0,30 5-23 * * *',$$select net.http_post(url:='https://oedasgcdjppjwidhlqdr.supabase.co/functions/v1/api/sla-tick',headers:=jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='cron_secret' limit 1)),body:='{}'::jsonb);$$);
select cron.schedule('bao-hang-1291-sheet-sync-midnight','0 0 * * *',$$select net.http_post(url:='https://oedasgcdjppjwidhlqdr.supabase.co/functions/v1/api/sla-tick',headers:=jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='cron_secret' limit 1)),body:='{}'::jsonb);$$);

commit;
