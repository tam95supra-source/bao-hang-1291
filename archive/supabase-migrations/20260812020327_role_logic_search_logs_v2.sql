create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

update public.profiles set role='ADMIN'::public.user_role, updated_at=now() where employee_code='6281280';
create unique index if not exists profiles_single_admin_idx on public.profiles(role) where role='ADMIN'::public.user_role;

create or replace function public.protect_single_admin()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='DELETE' and old.role='ADMIN'::public.user_role then raise exception 'ADMIN_PROTECTED'; end if;
  if tg_op='UPDATE' and old.role='ADMIN'::public.user_role then
    if new.role <> 'ADMIN'::public.user_role or new.active is not true then raise exception 'ADMIN_PROTECTED'; end if;
  end if;
  if tg_op in ('INSERT','UPDATE') and new.role='ADMIN'::public.user_role then
    if exists(select 1 from public.profiles p where p.role='ADMIN'::public.user_role and p.id<>new.id) then raise exception 'ADMIN_ALREADY_EXISTS'; end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
drop trigger if exists protect_single_admin_trigger on public.profiles;
create trigger protect_single_admin_trigger before insert or update or delete on public.profiles for each row execute function public.protect_single_admin();

alter table public.sku_catalog add column if not exists search_text text not null default '';
update public.sku_catalog set search_text=lower(extensions.unaccent(trim(sku)||' '||trim(product_name))) where search_text='';
create or replace function public.refresh_sku_search_text()
returns trigger language plpgsql set search_path=public,extensions as $$
begin
  new.search_text := lower(extensions.unaccent(trim(new.sku)||' '||trim(new.product_name)));
  return new;
end $$;
drop trigger if exists sku_catalog_search_text_trigger on public.sku_catalog;
create trigger sku_catalog_search_text_trigger before insert or update of sku,product_name on public.sku_catalog for each row execute function public.refresh_sku_search_text();
create index if not exists sku_catalog_search_trgm_idx on public.sku_catalog using gin(search_text extensions.gin_trgm_ops);

alter table public.app_config
  add column if not exists picker_ack_reminder_minutes integer not null default 3 check (picker_ack_reminder_minutes between 1 and 60),
  add column if not exists diagnostic_log_retention_days integer not null default 14 check (diagnostic_log_retention_days between 1 and 60);
alter table public.notification_events add column if not exists send_count integer not null default 0 check (send_count >= 0);

create table if not exists public.diagnostic_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  employee_code text not null,
  role public.user_role not null,
  device_name text not null default '',
  app_version text not null default '',
  object_path text not null unique,
  compressed_bytes integer not null check (compressed_bytes between 1 and 2097152),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  client_created_at timestamptz,
  created_at timestamptz not null default now(),
  download_count integer not null default 0,
  last_downloaded_at timestamptz,
  last_downloaded_by uuid references public.profiles(id)
);
create index if not exists diagnostic_logs_created_idx on public.diagnostic_logs(created_at desc);
create index if not exists diagnostic_logs_user_idx on public.diagnostic_logs(user_id,created_at desc);
alter table public.diagnostic_logs enable row level security;
revoke all on public.diagnostic_logs from anon,authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('diagnostic-logs','diagnostic-logs',false,2097152,array['application/gzip','application/octet-stream'])
on conflict(id) do update set public=false,file_size_limit=2097152,allowed_mime_types=array['application/gzip','application/octet-stream'];

create or replace function public.current_role()
returns public.user_role language sql stable security definer set search_path=public
as $$ select role from public.profiles where id=auth.uid() and active=true $$;
create or replace function public.is_invent_admin()
returns boolean language sql stable security definer set search_path=public
as $$ select coalesce(public.current_role() in ('ADMIN'::public.user_role,'ADMIN_INVENT'::public.user_role),false) $$;

create or replace function public.report_shortage_atomic(p_sku text,p_reporter uuid,p_client_request_id text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_item public.sku_catalog%rowtype; v_issue public.issues%rowtype; v_already boolean:=false;
begin
  perform pg_advisory_xact_lock(hashtextextended(trim(p_sku),1291));
  if p_client_request_id is not null then
    select i.* into v_issue from public.issue_reports r join public.issues i on i.id=r.issue_id where r.client_request_id=p_client_request_id;
    if found then return jsonb_build_object('issue',public.issue_json(v_issue),'already_reported',true,'duplicate_request',true,'message','Yêu cầu đã được đồng bộ trước đó'); end if;
  end if;
  select * into v_item from public.sku_catalog where sku=trim(p_sku);
  if not found then raise exception 'SKU_NOT_FOUND'; end if;
  if not exists(select 1 from public.profiles where id=p_reporter and active=true) then raise exception 'USER_INACTIVE'; end if;
  select * into v_issue from public.issues where sku=v_item.sku and status in ('OPEN','CLAIMED','SEARCHING','REPLENISHING') order by first_reported_at asc limit 1 for update;
  if found then
    v_already:=true;
    update public.issues set report_count=report_count+1,updated_at=now() where id=v_issue.id returning * into v_issue;
  else
    insert into public.issues(sku,product_name_snapshot,status,report_count,first_reported_at) values(v_item.sku,v_item.product_name,'OPEN',1,now()) returning * into v_issue;
  end if;
  insert into public.issue_reports(issue_id,reporter_id,client_request_id) values(v_issue.id,p_reporter,p_client_request_id);
  insert into public.issue_audit(issue_id,actor_id,action,to_status,detail) values(v_issue.id,p_reporter,'REPORT_SHORTAGE',v_issue.status,jsonb_build_object('already_reported',v_already,'report_count',v_issue.report_count));
  insert into public.sheet_export_queue(event_type,payload) values('REPORT_SHORTAGE',public.issue_json(v_issue)||jsonb_build_object('reporter_id',p_reporter));
  return jsonb_build_object('issue',public.issue_json(v_issue),'already_reported',v_already,'duplicate_request',false,'message',case when v_already then 'Đã ghi nhận thêm lượt báo của bạn' else 'Đã báo nhóm Invent' end);
end $$;

create or replace function public.update_issue_atomic(p_issue_id uuid,p_actor uuid,p_action text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_issue public.issues%rowtype; v_old public.issue_status; v_role public.user_role; v_action text:=upper(trim(p_action));
begin
  select role into v_role from public.profiles where id=p_actor and active=true;
  if v_role not in ('ADMIN'::public.user_role,'ADMIN_INVENT'::public.user_role,'INVENT'::public.user_role) then raise exception 'FORBIDDEN'; end if;
  select * into v_issue from public.issues where id=p_issue_id for update;
  if not found then raise exception 'ISSUE_NOT_FOUND'; end if;
  v_old:=v_issue.status;
  if v_action='CLAIM' then
    if v_issue.status not in ('OPEN','CLAIMED','SEARCHING','REPLENISHING') then raise exception 'ISSUE_ALREADY_RESOLVED'; end if;
    if v_issue.claimed_by is not null and v_issue.claimed_by<>p_actor and v_role='INVENT'::public.user_role then raise exception 'ALREADY_CLAIMED'; end if;
    update public.issues set claimed_by=p_actor,claimed_at=coalesce(claimed_at,now()),updated_at=now() where id=p_issue_id returning * into v_issue;
  elsif v_action in ('AVAILABLE','NOT_FOUND') then
    if v_action='NOT_FOUND' and v_issue.status='SKIP_ALLOWED' then return public.issue_json(v_issue); end if;
    if v_action='AVAILABLE' and v_issue.status='AVAILABLE' then return public.issue_json(v_issue); end if;
    if v_action='NOT_FOUND' and v_issue.status not in ('OPEN','CLAIMED','SEARCHING','REPLENISHING') then raise exception 'INVALID_TRANSITION'; end if;
    if v_action='AVAILABLE' and v_issue.status not in ('OPEN','CLAIMED','SEARCHING','REPLENISHING','SKIP_ALLOWED') then raise exception 'INVALID_TRANSITION'; end if;
    if v_issue.claimed_by is null then v_issue.claimed_by:=p_actor;
    elsif v_issue.claimed_by<>p_actor and v_role='INVENT'::public.user_role then raise exception 'ISSUE_OWNED_BY_ANOTHER_USER'; end if;
    update public.issues set status=case when v_action='AVAILABLE' then 'AVAILABLE'::public.issue_status else 'SKIP_ALLOWED'::public.issue_status end,
      claimed_by=coalesce(claimed_by,p_actor),claimed_at=coalesce(claimed_at,now()),resolved_at=now(),updated_at=now()
    where id=p_issue_id returning * into v_issue;
  elsif v_action='CLOSE' and v_role='ADMIN'::public.user_role then
    update public.issues set status='CLOSED',resolved_at=coalesce(resolved_at,now()),updated_at=now() where id=p_issue_id returning * into v_issue;
  else raise exception 'INVALID_ACTION'; end if;
  insert into public.issue_audit(issue_id,actor_id,action,from_status,to_status,detail) values(v_issue.id,p_actor,v_action,v_old,v_issue.status,jsonb_build_object('claimed_by',v_issue.claimed_by));
  insert into public.sheet_export_queue(event_type,payload) values('ISSUE_STATUS',public.issue_json(v_issue)||jsonb_build_object('actor_id',p_actor,'action',v_action));
  return public.issue_json(v_issue);
end $$;

create or replace function public.process_sla()
returns table(issue_id uuid,event_status public.issue_status,event_kind text)
language plpgsql security definer set search_path=public as $$
declare cfg public.app_config%rowtype; item public.issues%rowtype;
begin
  select * into cfg from public.app_config where singleton=true;
  for item in select * from public.issues where status in ('OPEN','CLAIMED','SEARCHING','REPLENISHING') for update skip locked loop
    if item.claimed_by is null and now()>=item.first_reported_at+make_interval(mins=>cfg.acknowledge_minutes)
       and (item.last_reminded_at is null or now()>=item.last_reminded_at+make_interval(mins=>cfg.reminder_minutes)) then
      update public.issues set last_reminded_at=now(),updated_at=now() where id=item.id;
      issue_id:=item.id;event_status:=item.status;event_kind:='ACK_OVERDUE';return next;
    elsif item.claimed_by is not null and now()>=coalesce(item.claimed_at,item.first_reported_at)+make_interval(mins=>cfg.replenish_minutes)
       and (item.last_reminded_at is null or now()>=item.last_reminded_at+make_interval(mins=>cfg.reminder_minutes)) then
      update public.issues set last_reminded_at=now(),updated_at=now() where id=item.id;
      issue_id:=item.id;event_status:=item.status;event_kind:='PROCESS_OVERDUE';return next;
    end if;
  end loop;
end $$;

create or replace function public.configure_automation(p_project_url text,p_cron_secret text)
returns boolean language plpgsql security definer set search_path=public,vault,cron,net as $$
declare v_id uuid;v_job_id bigint;
begin
  if p_project_url !~ '^https://[a-z0-9-]+[.]supabase[.]co$' then raise exception 'INVALID_PROJECT_URL'; end if;
  if length(p_cron_secret)<32 then raise exception 'CRON_SECRET_TOO_SHORT'; end if;
  select id into v_id from vault.secrets where name='bao_hang_1291_project_url';
  if v_id is null then perform vault.create_secret(trim(trailing '/' from p_project_url),'bao_hang_1291_project_url','Edge Function base URL'); else perform vault.update_secret(v_id,trim(trailing '/' from p_project_url),'bao_hang_1291_project_url','Edge Function base URL'); end if;
  select id into v_id from vault.secrets where name='bao_hang_1291_cron_secret';
  if v_id is null then perform vault.create_secret(p_cron_secret,'bao_hang_1291_cron_secret','SLA cron authentication'); else perform vault.update_secret(v_id,p_cron_secret,'bao_hang_1291_cron_secret','SLA cron authentication'); end if;
  select jobid into v_job_id from cron.job where jobname='bao-hang-1291-sla'; if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  select jobid into v_job_id from cron.job where jobname='bao-hang-1291-cleanup'; if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  perform cron.schedule('bao-hang-1291-sla','* * * * *',$job$
    select net.http_post(url := (select decrypted_secret from vault.decrypted_secrets where name='bao_hang_1291_project_url') || '/functions/v1/api/sla-tick',headers := jsonb_build_object('content-type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='bao_hang_1291_cron_secret')),body := '{}'::jsonb,timeout_milliseconds := 60000);
  $job$);
  perform cron.schedule('bao-hang-1291-cleanup','20 18 * * *',$job$
    select net.http_post(url := (select decrypted_secret from vault.decrypted_secrets where name='bao_hang_1291_project_url') || '/functions/v1/api/cleanup',headers := jsonb_build_object('content-type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='bao_hang_1291_cron_secret')),body := '{}'::jsonb,timeout_milliseconds := 60000);
  $job$);
  return true;
end $$;
