create extension if not exists pgcrypto;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$ begin
  create type public.user_role as enum ('PICKER', 'INVENT_USER', 'INVENT_ADMIN');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.issue_status as enum (
    'OPEN', 'CLAIMED', 'SEARCHING', 'REPLENISHING', 'AVAILABLE', 'SKIP_ALLOWED', 'CLOSED'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  employee_code text not null unique,
  full_name text not null,
  contractor text not null default '',
  role public.user_role not null default 'PICKER',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_role_active_idx on public.profiles(role, active);
create unique index if not exists profiles_employee_code_ci_unique on public.profiles(lower(employee_code));

create table if not exists public.sku_catalog (
  sku text primary key,
  product_name text not null,
  first_imported_at timestamptz not null default now(),
  last_imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sku_catalog_name_idx on public.sku_catalog using gin(to_tsvector('simple', product_name));

create table if not exists public.issues (
  id uuid primary key default gen_random_uuid(),
  sku text not null references public.sku_catalog(sku),
  product_name_snapshot text not null,
  status public.issue_status not null default 'OPEN',
  report_count integer not null default 1 check (report_count > 0),
  reopen_count integer not null default 0 check (reopen_count >= 0),
  first_reported_at timestamptz not null default now(),
  claimed_by uuid references public.profiles(id),
  claimed_at timestamptz,
  resolved_at timestamptz,
  last_reminded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists one_active_issue_per_sku
  on public.issues(sku)
  where status in ('OPEN', 'CLAIMED', 'SEARCHING', 'REPLENISHING');
create index if not exists issues_queue_idx on public.issues(status, first_reported_at);
create index if not exists issues_updated_idx on public.issues(updated_at desc);
create index if not exists issues_resolved_idx on public.issues(resolved_at) where resolved_at is not null;

create table if not exists public.issue_reports (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issues(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id),
  reported_at timestamptz not null default now(),
  client_request_id text,
  created_at timestamptz not null default now()
);

create index if not exists issue_reports_issue_idx on public.issue_reports(issue_id, reported_at);
create index if not exists issue_reports_reporter_idx on public.issue_reports(reporter_id, reported_at desc);
create unique index if not exists issue_reports_client_request_unique
  on public.issue_reports(client_request_id) where client_request_id is not null;

create table if not exists public.issue_audit (
  id bigint generated always as identity primary key,
  issue_id uuid not null references public.issues(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  action text not null,
  from_status public.issue_status,
  to_status public.issue_status,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists issue_audit_issue_idx on public.issue_audit(issue_id, created_at);

create table if not exists public.device_tokens (
  fcm_token text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null default 'android',
  device_name text not null default '',
  app_version text not null default '',
  active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists device_tokens_user_idx on public.device_tokens(user_id, active);

create table if not exists public.notification_events (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid references public.issues(id) on delete cascade,
  target_user_id uuid not null references public.profiles(id) on delete cascade,
  status public.issue_status not null,
  title text not null,
  message text not null,
  critical boolean not null default false,
  sent_at timestamptz,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notification_events_target_idx
  on public.notification_events(target_user_id, created_at desc);

create table if not exists public.app_config (
  singleton boolean primary key default true check (singleton),
  acknowledge_minutes integer not null default 15 check (acknowledge_minutes between 1 and 480),
  reminder_minutes integer not null default 5 check (reminder_minutes between 1 and 480),
  skip_minutes integer not null default 30 check (skip_minutes between 1 and 480),
  replenish_minutes integer not null default 15 check (replenish_minutes between 1 and 480),
  retention_days integer not null default 60 check (retention_days between 7 and 365),
  sheet_webhook_enabled boolean not null default false,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

insert into public.app_config(singleton) values (true) on conflict (singleton) do nothing;

create table if not exists public.sheet_export_queue (
  id bigint generated always as identity primary key,
  event_type text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  exported_at timestamptz,
  attempts integer not null default 0,
  last_error text not null default ''
);

create index if not exists sheet_export_pending_idx on public.sheet_export_queue(id) where exported_at is null;

create table if not exists public.app_releases (
  version_code integer primary key,
  version_name text not null,
  apk_url text not null,
  sha256 text not null,
  mandatory boolean not null default false,
  release_notes text not null default '',
  published_at timestamptz not null default now()
);

create or replace function public.current_role()
returns public.user_role
language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() and active = true $$;

create or replace function public.is_invent_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce(public.current_role() = 'INVENT_ADMIN', false) $$;

create or replace function public.issue_json(p_issue public.issues)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'id', p_issue.id,
    'sku', p_issue.sku,
    'product_name', p_issue.product_name_snapshot,
    'status', p_issue.status,
    'report_count', p_issue.report_count,
    'reopen_count', p_issue.reopen_count,
    'reported_at', p_issue.first_reported_at,
    'updated_at', p_issue.updated_at,
    'assigned_name', coalesce((select full_name from public.profiles where id = p_issue.claimed_by), ''),
    'latest_reporter_name', coalesce((
      select p.full_name from public.issue_reports r join public.profiles p on p.id = r.reporter_id
      where r.issue_id = p_issue.id order by r.reported_at desc limit 1
    ), ''),
    'latest_message', ''
  )
$$;

create or replace function public.report_shortage_atomic(p_sku text, p_reporter uuid, p_client_request_id text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_item public.sku_catalog%rowtype;
  v_issue public.issues%rowtype;
  v_already boolean := false;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_sku, 1291));
  if p_client_request_id is not null then
    select i.* into v_issue
      from public.issue_reports r join public.issues i on i.id=r.issue_id
      where r.client_request_id=p_client_request_id;
    if found then
      return jsonb_build_object(
        'issue', public.issue_json(v_issue),
        'already_reported', true,
        'duplicate_request', true,
        'message', 'Yêu cầu đã được đồng bộ trước đó'
      );
    end if;
  end if;
  select * into v_item from public.sku_catalog where sku = trim(p_sku);
  if not found then raise exception 'SKU_NOT_FOUND'; end if;
  if not exists(select 1 from public.profiles where id = p_reporter and active = true) then
    raise exception 'USER_INACTIVE';
  end if;

  select * into v_issue from public.issues
  where sku = v_item.sku and status in ('OPEN','CLAIMED','SEARCHING','REPLENISHING')
  order by first_reported_at desc limit 1 for update;

  if found then
    v_already := true;
    update public.issues set report_count = report_count + 1, updated_at = now()
      where id = v_issue.id returning * into v_issue;
  else
    select * into v_issue from public.issues
      where sku = v_item.sku and status = 'AVAILABLE' and resolved_at >= now() - interval '30 minutes'
      order by resolved_at desc limit 1 for update;
    if found then
      v_already := true;
      update public.issues set status = 'OPEN', report_count = report_count + 1,
        reopen_count = reopen_count + 1, first_reported_at = now(), claimed_by = null,
        claimed_at = null, resolved_at = null, last_reminded_at = null, updated_at = now()
        where id = v_issue.id returning * into v_issue;
    else
      insert into public.issues(sku, product_name_snapshot)
        values (v_item.sku, v_item.product_name) returning * into v_issue;
    end if;
  end if;

  insert into public.issue_reports(issue_id, reporter_id, client_request_id)
    values(v_issue.id, p_reporter, p_client_request_id);
  insert into public.issue_audit(issue_id, actor_id, action, to_status, detail)
    values(v_issue.id, p_reporter, 'REPORT_SHORTAGE', v_issue.status,
      jsonb_build_object('already_reported', v_already, 'report_count', v_issue.report_count));
  insert into public.sheet_export_queue(event_type, payload)
    values('REPORT_SHORTAGE', public.issue_json(v_issue) || jsonb_build_object('reporter_id', p_reporter));

  return jsonb_build_object(
    'issue', public.issue_json(v_issue),
    'already_reported', v_already,
    'duplicate_request', false,
    'message', case when v_already then 'Đã ghi nhận thêm lượt báo của bạn' else 'Đã báo nhóm Invent' end
  );
end $$;

create or replace function public.update_issue_atomic(p_issue_id uuid, p_actor uuid, p_action text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_issue public.issues%rowtype;
  v_old public.issue_status;
  v_role public.user_role;
  v_next public.issue_status;
begin
  select role into v_role from public.profiles where id = p_actor and active = true;
  if v_role not in ('INVENT_USER','INVENT_ADMIN') then raise exception 'FORBIDDEN'; end if;
  select * into v_issue from public.issues where id = p_issue_id for update;
  if not found then raise exception 'ISSUE_NOT_FOUND'; end if;
  v_old := v_issue.status;

  if upper(p_action) = 'CLAIM' then
    if v_issue.claimed_by is not null and v_issue.claimed_by <> p_actor then raise exception 'ALREADY_CLAIMED'; end if;
    update public.issues set status='CLAIMED', claimed_by=p_actor,
      claimed_at=coalesce(claimed_at, now()), updated_at=now()
      where id=p_issue_id returning * into v_issue;
  else
    if v_issue.claimed_by is null then
      update public.issues set claimed_by=p_actor, claimed_at=now() where id=p_issue_id returning * into v_issue;
    elsif v_issue.claimed_by <> p_actor and v_role <> 'INVENT_ADMIN' then
      raise exception 'ISSUE_OWNED_BY_ANOTHER_USER';
    end if;
    v_next := case upper(p_action)
      when 'SEARCHING' then 'SEARCHING'::public.issue_status
      when 'REPLENISHING' then 'REPLENISHING'::public.issue_status
      when 'AVAILABLE' then 'AVAILABLE'::public.issue_status
      when 'NOT_FOUND' then 'SKIP_ALLOWED'::public.issue_status
      when 'CLOSE' then 'CLOSED'::public.issue_status
      else null end;
    if v_next is null then raise exception 'INVALID_ACTION'; end if;
    update public.issues set status=v_next,
      resolved_at=case when v_next in ('AVAILABLE','SKIP_ALLOWED','CLOSED') then now() else null end,
      updated_at=now() where id=p_issue_id returning * into v_issue;
  end if;

  insert into public.issue_audit(issue_id, actor_id, action, from_status, to_status)
    values(v_issue.id, p_actor, upper(p_action), v_old, v_issue.status);
  insert into public.sheet_export_queue(event_type, payload)
    values('ISSUE_STATUS', public.issue_json(v_issue) || jsonb_build_object('actor_id', p_actor));
  return public.issue_json(v_issue);
end $$;

create or replace function public.process_sla()
returns table(issue_id uuid, event_status public.issue_status, event_kind text)
language plpgsql security definer set search_path = public
as $$
declare
  cfg public.app_config%rowtype;
  item public.issues%rowtype;
begin
  select * into cfg from public.app_config where singleton=true;
  for item in select * from public.issues
    where status in ('OPEN','CLAIMED','SEARCHING','REPLENISHING') for update skip locked
  loop
    if now() >= item.first_reported_at + make_interval(mins => cfg.skip_minutes) then
      update public.issues set status='SKIP_ALLOWED', resolved_at=now(), updated_at=now()
        where id=item.id returning * into item;
      insert into public.issue_audit(issue_id, action, from_status, to_status)
        values(item.id, 'SLA_SKIP_ALLOWED', item.status, 'SKIP_ALLOWED');
      insert into public.sheet_export_queue(event_type,payload)
        values('SLA_SKIP_ALLOWED', public.issue_json(item));
      issue_id := item.id; event_status := 'SKIP_ALLOWED'; event_kind := 'SKIP_ALLOWED'; return next;
    elsif item.status='OPEN' and now() >= item.first_reported_at + make_interval(mins => cfg.acknowledge_minutes)
      and (item.last_reminded_at is null or now() >= item.last_reminded_at + make_interval(mins => cfg.reminder_minutes)) then
      update public.issues set last_reminded_at=now(), updated_at=now() where id=item.id;
      issue_id := item.id; event_status := 'OPEN'; event_kind := 'ACK_OVERDUE'; return next;
    elsif item.status in ('CLAIMED','SEARCHING','REPLENISHING')
      and now() >= coalesce(item.claimed_at,item.first_reported_at) + make_interval(mins => cfg.replenish_minutes)
      and (item.last_reminded_at is null or now() >= item.last_reminded_at + make_interval(mins => cfg.reminder_minutes)) then
      update public.issues set last_reminded_at=now(), updated_at=now() where id=item.id;
      issue_id := item.id; event_status := item.status; event_kind := 'PROCESS_OVERDUE'; return next;
    end if;
  end loop;
end $$;

create or replace function public.purge_old_data()
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_days integer; v_count integer;
begin
  select retention_days into v_days from public.app_config where singleton=true;
  delete from public.issues where status in ('AVAILABLE','SKIP_ALLOWED','CLOSED')
    and resolved_at < now() - make_interval(days => v_days);
  get diagnostics v_count = row_count;
  delete from public.notification_events where created_at < now() - make_interval(days => v_days);
  delete from public.sheet_export_queue where exported_at < now() - interval '7 days';
  return v_count;
end $$;

create or replace function public.configure_automation(p_project_url text, p_cron_secret text)
returns boolean
language plpgsql security definer set search_path = public, vault, cron, net
as $$
declare
  v_id uuid;
  v_job_id bigint;
begin
  if p_project_url !~ '^https://[a-z0-9-]+[.]supabase[.]co$' then raise exception 'INVALID_PROJECT_URL'; end if;
  if length(p_cron_secret) < 32 then raise exception 'CRON_SECRET_TOO_SHORT'; end if;

  select id into v_id from vault.secrets where name='bao_hang_1291_project_url';
  if v_id is null then
    perform vault.create_secret(trim(trailing '/' from p_project_url), 'bao_hang_1291_project_url', 'Edge Function base URL');
  else
    perform vault.update_secret(v_id, trim(trailing '/' from p_project_url), 'bao_hang_1291_project_url', 'Edge Function base URL');
  end if;
  select id into v_id from vault.secrets where name='bao_hang_1291_cron_secret';
  if v_id is null then
    perform vault.create_secret(p_cron_secret, 'bao_hang_1291_cron_secret', 'SLA cron authentication');
  else
    perform vault.update_secret(v_id, p_cron_secret, 'bao_hang_1291_cron_secret', 'SLA cron authentication');
  end if;

  select jobid into v_job_id from cron.job where jobname='bao-hang-1291-sla';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  select jobid into v_job_id from cron.job where jobname='bao-hang-1291-cleanup';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;

  perform cron.schedule('bao-hang-1291-sla', '*/5 * * * *', $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name='bao_hang_1291_project_url') || '/functions/v1/api/sla-tick',
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name='bao_hang_1291_cron_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $job$);
  perform cron.schedule('bao-hang-1291-cleanup', '20 18 * * *', $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name='bao_hang_1291_project_url') || '/functions/v1/api/cleanup',
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name='bao_hang_1291_cron_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $job$);
  return true;
end $$;

alter table public.profiles enable row level security;
alter table public.sku_catalog enable row level security;
alter table public.issues enable row level security;
alter table public.issue_reports enable row level security;
alter table public.issue_audit enable row level security;
alter table public.device_tokens enable row level security;
alter table public.notification_events enable row level security;
alter table public.app_config enable row level security;
alter table public.sheet_export_queue enable row level security;
alter table public.app_releases enable row level security;

drop policy if exists profile_read_self on public.profiles;
create policy profile_read_self on public.profiles for select to authenticated using (id=auth.uid());
drop policy if exists release_read on public.app_releases;
create policy release_read on public.app_releases for select to authenticated using (true);

revoke all on all tables in schema public from anon, authenticated;
grant select on public.profiles to authenticated;
grant select on public.app_releases to authenticated;
-- SECURITY DEFINER helpers must not be directly callable by client roles.
revoke all on function public.current_role() from public, anon, authenticated;
revoke all on function public.is_invent_admin() from public, anon, authenticated;
revoke all on function public.issue_json(public.issues) from public, anon, authenticated;
revoke all on function public.report_shortage_atomic(text,uuid,text) from public, anon, authenticated;
revoke all on function public.update_issue_atomic(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.process_sla() from public, anon, authenticated;
revoke all on function public.purge_old_data() from public, anon, authenticated;
revoke all on function public.configure_automation(text,text) from public, anon, authenticated;
grant execute on function public.current_role() to service_role;
grant execute on function public.is_invent_admin() to service_role;
grant execute on function public.issue_json(public.issues) to service_role;
grant execute on function public.report_shortage_atomic(text,uuid,text) to service_role;
grant execute on function public.update_issue_atomic(uuid,uuid,text) to service_role;
grant execute on function public.process_sla() to service_role;
grant execute on function public.purge_old_data() to service_role;
grant execute on function public.configure_automation(text,text) to service_role;

comment on table public.profiles is 'Không lưu mật khẩu tại đây; mật khẩu do Supabase Auth băm và quản lý.';
comment on column public.profiles.employee_code is 'Mã nhân viên dùng làm tên đăng nhập trong ứng dụng.';
comment on column public.app_config.retention_days is 'Mặc định giữ log 60 ngày.';
