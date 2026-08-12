-- Báo hàng 1291 target D1-D12: canonical ticket lifecycle, audit-safe reassignment,
-- versioned notifications, private Realtime Broadcast and inventory snapshot/job model.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

alter table public.issues
  add column if not exists previous_issue_id uuid references public.issues(id) on delete set null,
  add column if not exists issue_version bigint not null default 1 check (issue_version > 0);
create index if not exists issues_previous_issue_idx on public.issues(previous_issue_id) where previous_issue_id is not null;

alter table public.notification_events
  add column if not exists issue_version bigint not null default 1 check (issue_version > 0);

alter table public.app_config
  add column if not exists inventory_auto_sync_enabled boolean not null default false,
  add column if not exists inventory_sync_interval_minutes integer not null default 10 check (inventory_sync_interval_minutes between 10 and 120),
  add column if not exists inventory_operating_start_hour smallint not null default 0 check (inventory_operating_start_hour between 0 and 23),
  add column if not exists inventory_operating_end_hour smallint not null default 23 check (inventory_operating_end_hour between 0 and 23),
  add column if not exists inventory_fresh_minutes integer not null default 10 check (inventory_fresh_minutes between 1 and 120),
  add column if not exists inventory_stale_minutes integer not null default 30 check (inventory_stale_minutes between 2 and 480);

create table if not exists private.supra_connections (
  warehouse_site_id text primary key,
  warehouse_code text not null,
  client_code text not null,
  api_base_url text not null,
  encrypted_credential_bundle text,
  encryption_version integer not null default 1,
  credential_version bigint not null default 0,
  sign_prefix text not null default '910',
  enabled boolean not null default false,
  status text not null default 'DISABLED' check (status in ('DISABLED','CONNECTED','AUTH_EXPIRED','SOURCE_CONTRACT_UNVERIFIED','SOURCE_SCHEMA_CHANGED','ERROR')),
  source_contract jsonb not null default '{}'::jsonb,
  last_tested_at timestamptz,
  last_test_error text not null default '',
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
insert into private.supra_connections(warehouse_site_id,warehouse_code,client_code,api_base_url)
values('1291','HY1','WIN','https://api-supra.winmart.vn')
on conflict(warehouse_site_id) do nothing;
revoke all on private.supra_connections from public, anon, authenticated;
grant select,insert,update,delete on private.supra_connections to service_role;

create table if not exists public.inventory_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  client_request_id text not null unique,
  warehouse_site_id text not null,
  warehouse_code text not null,
  source text not null default 'SUPRA_BIN_STOCK_API',
  source_endpoint text not null default 'BIN_STOCKS_JSON',
  requested_by uuid references public.profiles(id),
  requested_source text not null default 'MANUAL' check (requested_source in ('MANUAL','CRON','RECOVERY')),
  credential_version bigint not null default 0,
  state text not null default 'QUEUED' check (state in ('QUEUED','CONNECTING','FETCHING','VALIDATING','PUBLISHING','SUCCEEDED','NO_CHANGE','AUTH_EXPIRED','NETWORK_ERROR','SOURCE_SCHEMA_CHANGED','VALIDATION_FAILED','TIMEOUT','CANCELLED')),
  checkpoint jsonb not null default '{}'::jsonb,
  lease_owner text,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  page_count integer not null default 0 check (page_count >= 0),
  raw_row_count integer not null default 0 check (raw_row_count >= 0),
  normalized_row_count integer not null default 0 check (normalized_row_count >= 0),
  source_captured_at timestamptz,
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  error_code text not null default '',
  error_message text not null default '',
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index if not exists inventory_one_active_job_idx
  on public.inventory_sync_jobs(warehouse_site_id,source)
  where state in ('QUEUED','CONNECTING','FETCHING','VALIDATING','PUBLISHING');
create index if not exists inventory_jobs_recent_idx on public.inventory_sync_jobs(requested_at desc);
alter table public.inventory_sync_jobs enable row level security;
revoke all on public.inventory_sync_jobs from anon, authenticated;
grant select,insert,update,delete on public.inventory_sync_jobs to service_role;

create table if not exists private.inventory_staging_items (
  job_id uuid not null references public.inventory_sync_jobs(id) on delete cascade,
  row_key text not null,
  sku text not null,
  bin_code text not null default '',
  storage_type text not null default '',
  is_pickable boolean not null,
  bin_qty numeric not null check (bin_qty >= 0),
  pending_out_qty numeric not null default 0 check (pending_out_qty >= 0),
  available_qty numeric generated always as (greatest(bin_qty-pending_out_qty,0)) stored,
  raw_row_hash text not null check (raw_row_hash ~ '^[0-9a-f]{64}$'),
  primary key(job_id,row_key)
);
create index if not exists inventory_staging_job_sku_idx on private.inventory_staging_items(job_id,sku);
revoke all on private.inventory_staging_items from public, anon, authenticated;
grant select,insert,update,delete on private.inventory_staging_items to service_role;

create table if not exists public.inventory_snapshots (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.inventory_sync_jobs(id),
  warehouse_code text not null,
  warehouse_site_id text not null,
  source text not null,
  source_endpoint text not null,
  source_captured_at timestamptz not null,
  requested_at timestamptz not null,
  requested_by uuid references public.profiles(id),
  credential_version bigint not null,
  page_count integer not null check (page_count >= 0),
  raw_row_count integer not null check (raw_row_count >= 0),
  normalized_row_count integer not null check (normalized_row_count >= 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  schema_version text not null default 'inventory.v1',
  published_at timestamptz not null default now(),
  unique(warehouse_site_id,source_captured_at,sha256)
);
create index if not exists inventory_snapshots_site_recent_idx on public.inventory_snapshots(warehouse_site_id,published_at desc);
alter table public.inventory_snapshots enable row level security;
revoke all on public.inventory_snapshots from anon, authenticated;
grant select,insert,update,delete on public.inventory_snapshots to service_role;

create table if not exists public.inventory_snapshot_items (
  snapshot_id uuid not null references public.inventory_snapshots(id) on delete cascade,
  sku text not null,
  pickable_bin_qty numeric not null default 0 check (pickable_bin_qty >= 0),
  pickable_pending_out_qty numeric not null default 0 check (pickable_pending_out_qty >= 0),
  pickable_available_qty numeric not null default 0 check (pickable_available_qty >= 0),
  other_stock_qty numeric not null default 0 check (other_stock_qty >= 0),
  primary key(snapshot_id,sku)
);
alter table public.inventory_snapshot_items enable row level security;
revoke all on public.inventory_snapshot_items from anon, authenticated;
grant select,insert,update,delete on public.inventory_snapshot_items to service_role;

create table if not exists public.inventory_current (
  warehouse_site_id text not null,
  sku text not null,
  snapshot_id uuid not null references public.inventory_snapshots(id),
  snapshot_captured_at timestamptz not null,
  pickable_bin_qty numeric not null default 0 check (pickable_bin_qty >= 0),
  pickable_pending_out_qty numeric not null default 0 check (pickable_pending_out_qty >= 0),
  pickable_available_qty numeric not null default 0 check (pickable_available_qty >= 0),
  other_stock_qty numeric not null default 0 check (other_stock_qty >= 0),
  updated_at timestamptz not null default now(),
  primary key(warehouse_site_id,sku)
);
create index if not exists inventory_current_snapshot_idx on public.inventory_current(snapshot_id);
alter table public.inventory_current enable row level security;
revoke all on public.inventory_current from anon, authenticated;
grant select,insert,update,delete on public.inventory_current to service_role;

create table if not exists public.inventory_import_errors (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.inventory_sync_jobs(id) on delete cascade,
  error_code text not null,
  row_ref text not null default '',
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.inventory_import_errors enable row level security;
revoke all on public.inventory_import_errors from anon, authenticated;
grant select,insert,delete on public.inventory_import_errors to service_role;

create table if not exists public.inventory_sync_audit (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.inventory_sync_jobs(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists inventory_sync_audit_job_idx on public.inventory_sync_audit(job_id,created_at);
alter table public.inventory_sync_audit enable row level security;
revoke all on public.inventory_sync_audit from anon, authenticated;
grant select,insert,delete on public.inventory_sync_audit to service_role;

create or replace function public.issue_json(p_issue public.issues)
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'id',p_issue.id,'sku',p_issue.sku,'product_name',p_issue.product_name_snapshot,
    'status',p_issue.status,'report_count',p_issue.report_count,'reopen_count',p_issue.reopen_count,
    'reported_at',p_issue.first_reported_at,'updated_at',p_issue.updated_at,'resolved_at',p_issue.resolved_at,
    'claimed_at',p_issue.claimed_at,'issue_version',p_issue.issue_version,'previous_issue_id',p_issue.previous_issue_id,
    'recurrence_30m',coalesce(p_issue.previous_issue_id is not null and exists(
      select 1 from public.issues prev where prev.id=p_issue.previous_issue_id and prev.resolved_at is not null
      and p_issue.first_reported_at <= prev.resolved_at + interval '30 minutes'),false),
    'assigned_name',coalesce((select full_name from public.profiles where id=p_issue.claimed_by),''),
    'latest_reporter_name',coalesce((select p.full_name from public.issue_reports r join public.profiles p on p.id=r.reporter_id where r.issue_id=p_issue.id order by r.reported_at desc limit 1),''),
    'latest_message',''
  )
$$;

create or replace function public.report_shortage_atomic(p_sku text,p_reporter uuid,p_client_request_id text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_item public.sku_catalog%rowtype; v_issue public.issues%rowtype; v_previous uuid; v_already boolean:=false;
begin
  perform pg_advisory_xact_lock(hashtextextended(trim(p_sku),1291));
  if p_client_request_id is not null then
    select i.* into v_issue from public.issue_reports r join public.issues i on i.id=r.issue_id where r.client_request_id=p_client_request_id;
    if found then return jsonb_build_object('issue',public.issue_json(v_issue),'already_reported',true,'duplicate_request',true,'message','Yêu cầu đã được đồng bộ trước đó'); end if;
  end if;
  select * into v_item from public.sku_catalog where sku=trim(p_sku); if not found then raise exception 'SKU_NOT_FOUND'; end if;
  if not exists(select 1 from public.profiles where id=p_reporter and active=true) then raise exception 'USER_INACTIVE'; end if;
  select * into v_issue from public.issues where sku=v_item.sku and status in ('OPEN','CLAIMED','SEARCHING','REPLENISHING') order by first_reported_at asc limit 1 for update;
  if found then
    v_already:=true;
    update public.issues set report_count=report_count+1,issue_version=issue_version+1,updated_at=now() where id=v_issue.id returning * into v_issue;
  else
    select id into v_previous from public.issues where sku=v_item.sku and status in ('AVAILABLE','SKIP_ALLOWED','CLOSED') order by coalesce(resolved_at,updated_at) desc limit 1;
    insert into public.issues(sku,product_name_snapshot,status,report_count,first_reported_at,previous_issue_id,issue_version)
      values(v_item.sku,v_item.product_name,'OPEN',1,now(),v_previous,1) returning * into v_issue;
  end if;
  insert into public.issue_reports(issue_id,reporter_id,client_request_id) values(v_issue.id,p_reporter,p_client_request_id);
  insert into public.issue_audit(issue_id,actor_id,action,to_status,detail) values(v_issue.id,p_reporter,'REPORT_SHORTAGE',v_issue.status,jsonb_build_object('already_reported',v_already,'report_count',v_issue.report_count,'issue_version',v_issue.issue_version,'previous_issue_id',v_issue.previous_issue_id));
  insert into public.sheet_export_queue(event_type,payload) values('REPORT_SHORTAGE',public.issue_json(v_issue)||jsonb_build_object('reporter_id',p_reporter));
  return jsonb_build_object('issue',public.issue_json(v_issue),'already_reported',v_already,'duplicate_request',false,'message',case when v_already then 'Đã ghi nhận thêm lượt báo của bạn' else 'Đã báo nhóm Người báo hàng' end);
end $$;

create or replace function public.update_issue_atomic(p_issue_id uuid,p_actor uuid,p_action text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_issue public.issues%rowtype; v_old public.issue_status; v_role public.user_role; v_action text:=upper(trim(p_action)); v_changed boolean:=false;
begin
  select role into v_role from public.profiles where id=p_actor and active=true;
  if v_role not in ('ADMIN'::public.user_role,'ADMIN_INVENT'::public.user_role,'INVENT'::public.user_role) then raise exception 'FORBIDDEN'; end if;
  select * into v_issue from public.issues where id=p_issue_id for update; if not found then raise exception 'ISSUE_NOT_FOUND'; end if;
  v_old:=v_issue.status;
  if v_action='CLAIM' then
    if v_issue.status not in ('OPEN','CLAIMED','SEARCHING','REPLENISHING') then raise exception 'ISSUE_ALREADY_RESOLVED'; end if;
    if v_issue.claimed_by is not null and v_issue.claimed_by<>p_actor then raise exception 'ALREADY_CLAIMED'; end if;
    if v_issue.claimed_by is null or v_issue.status<>'CLAIMED' then
      update public.issues set status='CLAIMED',claimed_by=p_actor,claimed_at=coalesce(claimed_at,now()),issue_version=issue_version+1,updated_at=now() where id=p_issue_id returning * into v_issue; v_changed:=true;
    end if;
  elsif v_action in ('AVAILABLE','NOT_FOUND') then
    if v_action='NOT_FOUND' and v_issue.status='SKIP_ALLOWED' then return public.issue_json(v_issue); end if;
    if v_action='AVAILABLE' and v_issue.status='AVAILABLE' then return public.issue_json(v_issue); end if;
    if v_action='NOT_FOUND' and v_issue.status not in ('OPEN','CLAIMED','SEARCHING','REPLENISHING') then raise exception 'INVALID_TRANSITION'; end if;
    if v_action='AVAILABLE' and v_issue.status not in ('OPEN','CLAIMED','SEARCHING','REPLENISHING','SKIP_ALLOWED') then raise exception 'INVALID_TRANSITION'; end if;
    if v_role='INVENT'::public.user_role and v_issue.claimed_by is distinct from p_actor then raise exception 'ISSUE_NOT_OWNED'; end if;
    update public.issues set status=case when v_action='AVAILABLE' then 'AVAILABLE'::public.issue_status else 'SKIP_ALLOWED'::public.issue_status end,
      claimed_by=coalesce(claimed_by,p_actor),claimed_at=coalesce(claimed_at,now()),resolved_at=now(),issue_version=issue_version+1,updated_at=now()
      where id=p_issue_id returning * into v_issue; v_changed:=true;
  elsif v_action='CLOSE' and v_role='ADMIN'::public.user_role then
    if v_issue.status<>'CLOSED' then update public.issues set status='CLOSED',resolved_at=coalesce(resolved_at,now()),issue_version=issue_version+1,updated_at=now() where id=p_issue_id returning * into v_issue; v_changed:=true; end if;
  else raise exception 'INVALID_ACTION'; end if;
  if v_changed then
    insert into public.issue_audit(issue_id,actor_id,action,from_status,to_status,detail) values(v_issue.id,p_actor,v_action,v_old,v_issue.status,jsonb_build_object('claimed_by',v_issue.claimed_by,'issue_version',v_issue.issue_version));
    insert into public.sheet_export_queue(event_type,payload) values('ISSUE_STATUS',public.issue_json(v_issue)||jsonb_build_object('actor_id',p_actor,'action',v_action));
  end if;
  return public.issue_json(v_issue);
end $$;

create or replace function public.reassign_issue_atomic(p_issue_id uuid,p_actor uuid,p_new_assignee uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_issue public.issues%rowtype; v_role public.user_role; v_target_role public.user_role; v_old_assignee uuid; v_reason text:=trim(coalesce(p_reason,''));
begin
  select role into v_role from public.profiles where id=p_actor and active=true;
  if v_role not in ('ADMIN'::public.user_role,'ADMIN_INVENT'::public.user_role) then raise exception 'FORBIDDEN'; end if;
  if length(v_reason)<3 then raise exception 'REASSIGN_REASON_REQUIRED'; end if;
  select role into v_target_role from public.profiles where id=p_new_assignee and active=true;
  if v_target_role not in ('INVENT'::public.user_role,'ADMIN_INVENT'::public.user_role) then raise exception 'INVALID_ASSIGNEE'; end if;
  select * into v_issue from public.issues where id=p_issue_id for update; if not found then raise exception 'ISSUE_NOT_FOUND'; end if;
  if v_issue.status not in ('OPEN','CLAIMED','SEARCHING','REPLENISHING') then raise exception 'ISSUE_ALREADY_RESOLVED'; end if;
  v_old_assignee:=v_issue.claimed_by;
  if v_old_assignee is not distinct from p_new_assignee then return public.issue_json(v_issue); end if;
  update public.issues set status='CLAIMED',claimed_by=p_new_assignee,claimed_at=now(),issue_version=issue_version+1,updated_at=now() where id=p_issue_id returning * into v_issue;
  insert into public.issue_audit(issue_id,actor_id,action,from_status,to_status,detail) values(v_issue.id,p_actor,'REASSIGN',v_issue.status,v_issue.status,jsonb_build_object('old_assignee',v_old_assignee,'new_assignee',p_new_assignee,'reason',v_reason,'issue_version',v_issue.issue_version));
  insert into public.sheet_export_queue(event_type,payload) values('ISSUE_REASSIGN',public.issue_json(v_issue)||jsonb_build_object('actor_id',p_actor,'old_assignee',v_old_assignee,'new_assignee',p_new_assignee,'reason',v_reason));
  return public.issue_json(v_issue)||jsonb_build_object('old_assignee_id',v_old_assignee,'new_assignee_id',p_new_assignee,'reassign_reason',v_reason);
end $$;

create or replace function public.finalize_inventory_snapshot(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path=public,private as $$
declare v_job public.inventory_sync_jobs%rowtype; v_snapshot uuid; v_count integer; v_existing uuid;
begin
  select * into v_job from public.inventory_sync_jobs where id=p_job_id for update; if not found then raise exception 'JOB_NOT_FOUND'; end if;
  if v_job.state in ('SUCCEEDED','NO_CHANGE') then return jsonb_build_object('job_id',v_job.id,'state',v_job.state); end if;
  if v_job.state not in ('VALIDATING','PUBLISHING') then raise exception 'JOB_NOT_READY'; end if;
  if v_job.sha256 is null or v_job.source_captured_at is null then raise exception 'JOB_METADATA_INCOMPLETE'; end if;
  select count(*) into v_count from private.inventory_staging_items where job_id=p_job_id;
  if v_count=0 or v_count<>v_job.normalized_row_count then raise exception 'ROW_COUNT_MISMATCH'; end if;
  if exists(select 1 from private.inventory_staging_items where job_id=p_job_id and (trim(sku)='' or bin_qty<0 or pending_out_qty<0)) then raise exception 'INVALID_STAGING_ROW'; end if;
  select id into v_existing from public.inventory_snapshots where warehouse_site_id=v_job.warehouse_site_id and sha256=v_job.sha256 order by published_at desc limit 1;
  if v_existing is not null then
    update public.inventory_sync_jobs set state='NO_CHANGE',finished_at=now(),updated_at=now(),error_code='',error_message='' where id=p_job_id;
    delete from private.inventory_staging_items where job_id=p_job_id;
    insert into public.inventory_sync_audit(job_id,actor_id,action,detail) values(p_job_id,v_job.requested_by,'NO_CHANGE',jsonb_build_object('snapshot_id',v_existing));
    return jsonb_build_object('job_id',p_job_id,'state','NO_CHANGE','snapshot_id',v_existing);
  end if;
  update public.inventory_sync_jobs set state='PUBLISHING',updated_at=now() where id=p_job_id;
  insert into public.inventory_snapshots(job_id,warehouse_code,warehouse_site_id,source,source_endpoint,source_captured_at,requested_at,requested_by,credential_version,page_count,raw_row_count,normalized_row_count,sha256)
    values(v_job.id,v_job.warehouse_code,v_job.warehouse_site_id,v_job.source,v_job.source_endpoint,v_job.source_captured_at,v_job.requested_at,v_job.requested_by,v_job.credential_version,v_job.page_count,v_job.raw_row_count,v_job.normalized_row_count,v_job.sha256) returning id into v_snapshot;
  insert into public.inventory_snapshot_items(snapshot_id,sku,pickable_bin_qty,pickable_pending_out_qty,pickable_available_qty,other_stock_qty)
    select v_snapshot,sku,
      coalesce(sum(bin_qty) filter(where is_pickable),0),coalesce(sum(pending_out_qty) filter(where is_pickable),0),coalesce(sum(greatest(bin_qty-pending_out_qty,0)) filter(where is_pickable),0),coalesce(sum(bin_qty) filter(where not is_pickable),0)
    from private.inventory_staging_items where job_id=p_job_id group by sku;
  delete from public.inventory_current where warehouse_site_id=v_job.warehouse_site_id;
  insert into public.inventory_current(warehouse_site_id,sku,snapshot_id,snapshot_captured_at,pickable_bin_qty,pickable_pending_out_qty,pickable_available_qty,other_stock_qty)
    select v_job.warehouse_site_id,i.sku,v_snapshot,v_job.source_captured_at,i.pickable_bin_qty,i.pickable_pending_out_qty,i.pickable_available_qty,i.other_stock_qty from public.inventory_snapshot_items i where i.snapshot_id=v_snapshot;
  update public.inventory_sync_jobs set state='SUCCEEDED',finished_at=now(),updated_at=now(),error_code='',error_message='' where id=p_job_id;
  insert into public.inventory_sync_audit(job_id,actor_id,action,detail) values(p_job_id,v_job.requested_by,'PUBLISHED',jsonb_build_object('snapshot_id',v_snapshot,'sha256',v_job.sha256,'rows',v_count));
  delete from private.inventory_staging_items where job_id=p_job_id;
  perform realtime.send(jsonb_build_object('snapshot_id',v_snapshot,'warehouse_site_id',v_job.warehouse_site_id,'captured_at',v_job.source_captured_at,'sha256',v_job.sha256),'snapshot_published','site:1291:inventory',true);
  return jsonb_build_object('job_id',p_job_id,'state','SUCCEEDED','snapshot_id',v_snapshot);
end $$;

create or replace function public.broadcast_issue_delta()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform realtime.send(jsonb_build_object('issue_id',new.id,'issue_version',new.issue_version,'status',new.status,'sku',new.sku,'updated_at',new.updated_at),'issue_changed','site:1291:issues',true);
  return null;
end $$;
drop trigger if exists issues_realtime_broadcast on public.issues;
create trigger issues_realtime_broadcast after insert or update on public.issues for each row execute function public.broadcast_issue_delta();

alter table realtime.messages enable row level security;
drop policy if exists "bao_hang_1291_receive_broadcast" on realtime.messages;
create policy "bao_hang_1291_receive_broadcast" on realtime.messages for select to authenticated using (
  extension='broadcast' and realtime.topic() in ('site:1291:issues','site:1291:inventory')
  and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active=true)
);

revoke all on function public.issue_json(public.issues) from public,anon,authenticated;
revoke all on function public.report_shortage_atomic(text,uuid,text) from public,anon,authenticated;
revoke all on function public.update_issue_atomic(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.reassign_issue_atomic(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.finalize_inventory_snapshot(uuid) from public,anon,authenticated;
grant execute on function public.issue_json(public.issues) to service_role;
grant execute on function public.report_shortage_atomic(text,uuid,text) to service_role;
grant execute on function public.update_issue_atomic(uuid,uuid,text) to service_role;
grant execute on function public.reassign_issue_atomic(uuid,uuid,uuid,text) to service_role;
grant execute on function public.finalize_inventory_snapshot(uuid) to service_role;
