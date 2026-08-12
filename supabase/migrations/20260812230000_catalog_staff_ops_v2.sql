-- Báo hàng 1291 v1.3: catalog-only import, Google Sheet staff source, auto-skip and service telemetry.
alter table public.app_config add column if not exists auto_skip_enabled boolean not null default false;
alter table public.app_config add column if not exists auto_skip_after_minutes integer not null default 120;
alter table public.app_config add column if not exists staff_auto_sync_enabled boolean not null default true;
alter table public.app_config add column if not exists staff_sync_interval_minutes integer not null default 60;

do $$ begin
  if not exists(select 1 from pg_constraint where conname='app_config_auto_skip_minutes_check') then
    alter table public.app_config add constraint app_config_auto_skip_minutes_check check(auto_skip_after_minutes between 15 and 4320);
  end if;
  if not exists(select 1 from pg_constraint where conname='app_config_staff_sync_minutes_check') then
    alter table public.app_config add constraint app_config_staff_sync_minutes_check check(staff_sync_interval_minutes between 15 and 1440);
  end if;
end $$;

alter table public.profiles add column if not exists source_kind text not null default 'MANUAL';
alter table public.profiles add column if not exists source_position text not null default '';
alter table public.profiles add column if not exists source_last_seen_at timestamptz;
alter table public.profiles add column if not exists protected_account boolean not null default false;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='profiles_source_kind_check') then
    alter table public.profiles add constraint profiles_source_kind_check check(source_kind in ('MANUAL','GSHEET'));
  end if;
end $$;
create index if not exists profiles_source_kind_idx on public.profiles(source_kind,active);
update public.profiles set role='ADMIN',active=true,protected_account=true where employee_code='6281280';

alter table public.sku_catalog add column if not exists active boolean not null default true;
create index if not exists sku_catalog_active_idx on public.sku_catalog(active,sku);

create table if not exists public.catalog_state(
  singleton boolean primary key default true check(singleton), revision bigint not null default 1 check(revision>0), updated_at timestamptz not null default now()
);
insert into public.catalog_state(singleton) values(true) on conflict(singleton) do nothing;
alter table public.catalog_state enable row level security;
revoke all on public.catalog_state from anon,authenticated;
grant select,insert,update on public.catalog_state to service_role;

create table if not exists public.catalog_imports(
  id bigint generated always as identity primary key, source_name text not null default '', source_sha256 text not null default '',
  row_count integer not null check(row_count>=0), active_count integer not null check(active_count>=0), imported_by uuid references public.profiles(id),
  revision bigint not null, created_at timestamptz not null default now()
);
create index if not exists catalog_imports_created_idx on public.catalog_imports(created_at desc);
alter table public.catalog_imports enable row level security;
revoke all on public.catalog_imports from anon,authenticated;
grant select,insert on public.catalog_imports to service_role;

create table if not exists public.staff_sync_runs(
  id uuid primary key default gen_random_uuid(), trigger_source text not null check(trigger_source in ('AUTO','MANUAL','DEPLOY')),
  status text not null default 'RUNNING' check(status in ('RUNNING','SUCCEEDED','NO_CHANGE','PARTIAL','FAILED')),
  source_sheet_id text not null, source_hash text not null default '', source_rows integer not null default 0 check(source_rows>=0),
  eligible_rows integer not null default 0 check(eligible_rows>=0), created_count integer not null default 0 check(created_count>=0),
  updated_count integer not null default 0 check(updated_count>=0), deactivated_count integer not null default 0 check(deactivated_count>=0),
  failed_count integer not null default 0 check(failed_count>=0), error_summary text not null default '', requested_by uuid references public.profiles(id),
  started_at timestamptz not null default now(), finished_at timestamptz
);
create index if not exists staff_sync_runs_recent_idx on public.staff_sync_runs(started_at desc);
alter table public.staff_sync_runs enable row level security;
revoke all on public.staff_sync_runs from anon,authenticated;
grant select,insert,update on public.staff_sync_runs to service_role;

create or replace function public.replace_sku_catalog_service(p_items jsonb,p_actor uuid,p_source_name text default '',p_source_sha text default '')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_count integer; v_revision bigint;
begin
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>10000 then raise exception 'CATALOG_ROW_COUNT_INVALID'; end if;
  create temporary table if not exists tmp_bh_catalog(sku text primary key,product_name text not null) on commit drop;
  truncate tmp_bh_catalog;
  insert into tmp_bh_catalog(sku,product_name)
  select trim(x.sku),max(trim(x.product_name)) from jsonb_to_recordset(p_items) as x(sku text,product_name text)
  where trim(coalesce(x.sku,''))<>'' and trim(coalesce(x.product_name,''))<>'' group by trim(x.sku);
  select count(*) into v_count from tmp_bh_catalog;
  if v_count<1 then raise exception 'CATALOG_EMPTY'; end if;
  update public.sku_catalog set active=false,updated_at=now() where active=true and sku not in(select sku from tmp_bh_catalog);
  insert into public.sku_catalog(sku,product_name,last_imported_at,updated_at,active)
  select sku,product_name,now(),now(),true from tmp_bh_catalog
  on conflict(sku) do update set product_name=excluded.product_name,last_imported_at=now(),updated_at=now(),active=true;
  update public.catalog_state set revision=revision+1,updated_at=now() where singleton=true returning revision into v_revision;
  insert into public.catalog_imports(source_name,source_sha256,row_count,active_count,imported_by,revision)
  values(left(coalesce(p_source_name,''),240),left(coalesce(p_source_sha,''),64),jsonb_array_length(p_items),v_count,p_actor,v_revision);
  perform realtime.send(jsonb_build_object('revision',v_revision,'active_count',v_count),'catalog_changed','site:1291:catalog',true);
  return jsonb_build_object('revision',v_revision,'active_count',v_count,'received_count',jsonb_array_length(p_items));
end $$;
revoke all on function public.replace_sku_catalog_service(jsonb,uuid,text,text) from public,anon,authenticated;
grant execute on function public.replace_sku_catalog_service(jsonb,uuid,text,text) to service_role;

create or replace function public.auto_skip_overdue_service()
returns table(issue_id uuid) language plpgsql security definer set search_path=public as $$
declare v_enabled boolean; v_minutes integer; r public.issues%rowtype; v_old public.issue_status;
begin
  select auto_skip_enabled,auto_skip_after_minutes into v_enabled,v_minutes from public.app_config where singleton=true;
  if not coalesce(v_enabled,false) then return; end if;
  for r in select * from public.issues where status in ('OPEN','CLAIMED','SEARCHING','REPLENISHING')
    and first_reported_at<=now()-make_interval(mins=>greatest(15,v_minutes)) order by first_reported_at for update skip locked
  loop
    v_old:=r.status;
    update public.issues set status='SKIP_ALLOWED',resolved_at=now(),issue_version=issue_version+1,updated_at=now() where id=r.id returning * into r;
    insert into public.issue_audit(issue_id,actor_id,action,from_status,to_status,detail)
    values(r.id,null,'AUTO_SKIP',v_old,'SKIP_ALLOWED',jsonb_build_object('configured_minutes',v_minutes,'issue_version',r.issue_version));
    insert into public.sheet_export_queue(event_type,payload)
    values('ISSUE_STATUS',public.issue_json(r)||jsonb_build_object('actor_id',null,'action','AUTO_SKIP','configured_minutes',v_minutes));
    issue_id:=r.id; return next;
  end loop;
end $$;
revoke all on function public.auto_skip_overdue_service() from public,anon,authenticated;
grant execute on function public.auto_skip_overdue_service() to service_role;

create or replace function public.service_usage_snapshot()
returns jsonb language sql stable security definer set search_path=public as $$
select jsonb_build_object(
 'database_bytes',pg_database_size(current_database()),'sku_active',(select count(*) from public.sku_catalog where active=true),
 'profiles_total',(select count(*) from public.profiles),'profiles_active',(select count(*) from public.profiles where active=true),
 'issues_total',(select count(*) from public.issues),'issues_active',(select count(*) from public.issues where status in ('OPEN','CLAIMED','SEARCHING','REPLENISHING')),
 'notification_events',(select count(*) from public.notification_events),'active_device_tokens',(select count(*) from public.device_tokens where active=true),
 'sheet_pending',(select count(*) from public.sheet_export_queue where exported_at is null),'diagnostic_logs',(select count(*) from public.diagnostic_logs),
 'diagnostic_log_bytes',coalesce((select sum(compressed_bytes) from public.diagnostic_logs),0),
 'catalog_revision',(select revision from public.catalog_state where singleton=true),'captured_at',now())
$$;
revoke all on function public.service_usage_snapshot() from public,anon,authenticated;
grant execute on function public.service_usage_snapshot() to service_role;

-- Private Realtime topics used by foreground clients.
drop policy if exists "bao_hang_1291_receive_broadcast" on realtime.messages;
create policy "bao_hang_1291_receive_broadcast" on realtime.messages for select to authenticated
using(extension='broadcast' and realtime.topic() in ('site:1291:issues','site:1291:catalog','site:1291:staff')
  and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active=true));
