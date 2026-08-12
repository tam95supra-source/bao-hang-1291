-- Báo hàng 1291 target D1-D12: canonical ticket lifecycle and versioned notifications.

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
declare
  v_item public.sku_catalog%rowtype;
  v_issue public.issues%rowtype;
  v_previous uuid;
  v_already boolean:=false;
begin
  perform pg_advisory_xact_lock(hashtextextended(trim(p_sku),1291));
  if p_client_request_id is not null then
    select i.* into v_issue
    from public.issue_reports r join public.issues i on i.id=r.issue_id
    where r.client_request_id=p_client_request_id;
    if found then
      return jsonb_build_object('issue',public.issue_json(v_issue),'already_reported',true,'duplicate_request',true,'message','Yêu cầu đã được đồng bộ trước đó');
    end if;
  end if;
  select * into v_item from public.sku_catalog where sku=trim(p_sku);
  if not found then raise exception 'SKU_NOT_FOUND'; end if;
  if not exists(select 1 from public.profiles where id=p_reporter and active=true) then raise exception 'USER_INACTIVE'; end if;
  select * into v_issue from public.issues
  where sku=v_item.sku and status in ('OPEN','CLAIMED','SEARCHING','REPLENISHING')
  order by first_reported_at asc limit 1 for update;
  if found then
    v_already:=true;
    update public.issues set report_count=report_count+1,issue_version=issue_version+1,updated_at=now()
    where id=v_issue.id returning * into v_issue;
  else
    select id into v_previous from public.issues
    where sku=v_item.sku and status in ('AVAILABLE','SKIP_ALLOWED','CLOSED')
    order by coalesce(resolved_at,updated_at) desc limit 1;
    insert into public.issues(sku,product_name_snapshot,status,report_count,first_reported_at,previous_issue_id,issue_version)
    values(v_item.sku,v_item.product_name,'OPEN',1,now(),v_previous,1) returning * into v_issue;
  end if;
  insert into public.issue_reports(issue_id,reporter_id,client_request_id) values(v_issue.id,p_reporter,p_client_request_id);
  insert into public.issue_audit(issue_id,actor_id,action,to_status,detail)
  values(v_issue.id,p_reporter,'REPORT_SHORTAGE',v_issue.status,jsonb_build_object('already_reported',v_already,'report_count',v_issue.report_count,'issue_version',v_issue.issue_version,'previous_issue_id',v_issue.previous_issue_id));
  insert into public.sheet_export_queue(event_type,payload)
  values('REPORT_SHORTAGE',public.issue_json(v_issue)||jsonb_build_object('reporter_id',p_reporter));
  return jsonb_build_object('issue',public.issue_json(v_issue),'already_reported',v_already,'duplicate_request',false,'message',case when v_already then 'Đã ghi nhận thêm lượt báo của bạn' else 'Đã báo nhóm Người báo hàng' end);
end $$;

create or replace function public.update_issue_atomic(p_issue_id uuid,p_actor uuid,p_action text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_issue public.issues%rowtype;
  v_old public.issue_status;
  v_role public.user_role;
  v_action text:=upper(trim(p_action));
  v_changed boolean:=false;
begin
  select role into v_role from public.profiles where id=p_actor and active=true;
  if v_role not in ('ADMIN'::public.user_role,'ADMIN_INVENT'::public.user_role,'INVENT'::public.user_role) then raise exception 'FORBIDDEN'; end if;
  select * into v_issue from public.issues where id=p_issue_id for update;
  if not found then raise exception 'ISSUE_NOT_FOUND'; end if;
  v_old:=v_issue.status;
  if v_action='CLAIM' then
    if v_issue.status not in ('OPEN','CLAIMED','SEARCHING','REPLENISHING') then raise exception 'ISSUE_ALREADY_RESOLVED'; end if;
    if v_issue.claimed_by is not null and v_issue.claimed_by<>p_actor then raise exception 'ALREADY_CLAIMED'; end if;
    if v_issue.claimed_by is null or v_issue.status<>'CLAIMED' then
      update public.issues set status='CLAIMED',claimed_by=p_actor,claimed_at=coalesce(claimed_at,now()),issue_version=issue_version+1,updated_at=now()
      where id=p_issue_id returning * into v_issue;
      v_changed:=true;
    end if;
  elsif v_action in ('AVAILABLE','NOT_FOUND') then
    if v_action='NOT_FOUND' and v_issue.status='SKIP_ALLOWED' then return public.issue_json(v_issue); end if;
    if v_action='AVAILABLE' and v_issue.status='AVAILABLE' then return public.issue_json(v_issue); end if;
    if v_action='NOT_FOUND' and v_issue.status not in ('OPEN','CLAIMED','SEARCHING','REPLENISHING') then raise exception 'INVALID_TRANSITION'; end if;
    if v_action='AVAILABLE' and v_issue.status not in ('OPEN','CLAIMED','SEARCHING','REPLENISHING','SKIP_ALLOWED') then raise exception 'INVALID_TRANSITION'; end if;
    if v_role='INVENT'::public.user_role and v_issue.claimed_by is distinct from p_actor then raise exception 'ISSUE_NOT_OWNED'; end if;
    update public.issues set
      status=case when v_action='AVAILABLE' then 'AVAILABLE'::public.issue_status else 'SKIP_ALLOWED'::public.issue_status end,
      claimed_by=coalesce(claimed_by,p_actor),claimed_at=coalesce(claimed_at,now()),resolved_at=now(),issue_version=issue_version+1,updated_at=now()
    where id=p_issue_id returning * into v_issue;
    v_changed:=true;
  elsif v_action='CLOSE' and v_role='ADMIN'::public.user_role then
    if v_issue.status<>'CLOSED' then
      update public.issues set status='CLOSED',resolved_at=coalesce(resolved_at,now()),issue_version=issue_version+1,updated_at=now()
      where id=p_issue_id returning * into v_issue;
      v_changed:=true;
    end if;
  else
    raise exception 'INVALID_ACTION';
  end if;
  if v_changed then
    insert into public.issue_audit(issue_id,actor_id,action,from_status,to_status,detail)
    values(v_issue.id,p_actor,v_action,v_old,v_issue.status,jsonb_build_object('claimed_by',v_issue.claimed_by,'issue_version',v_issue.issue_version));
    insert into public.sheet_export_queue(event_type,payload)
    values('ISSUE_STATUS',public.issue_json(v_issue)||jsonb_build_object('actor_id',p_actor,'action',v_action));
  end if;
  return public.issue_json(v_issue);
end $$;

create or replace function public.reassign_issue_atomic(p_issue_id uuid,p_actor uuid,p_new_assignee uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_issue public.issues%rowtype;
  v_role public.user_role;
  v_target_role public.user_role;
  v_old_assignee uuid;
  v_old_status public.issue_status;
  v_reason text:=trim(coalesce(p_reason,''));
begin
  select role into v_role from public.profiles where id=p_actor and active=true;
  if v_role not in ('ADMIN'::public.user_role,'ADMIN_INVENT'::public.user_role) then raise exception 'FORBIDDEN'; end if;
  if length(v_reason)<3 then raise exception 'REASSIGN_REASON_REQUIRED'; end if;
  select role into v_target_role from public.profiles where id=p_new_assignee and active=true;
  if v_target_role not in ('INVENT'::public.user_role,'ADMIN_INVENT'::public.user_role) then raise exception 'INVALID_ASSIGNEE'; end if;
  select * into v_issue from public.issues where id=p_issue_id for update;
  if not found then raise exception 'ISSUE_NOT_FOUND'; end if;
  if v_issue.status not in ('OPEN','CLAIMED','SEARCHING','REPLENISHING') then raise exception 'ISSUE_ALREADY_RESOLVED'; end if;
  v_old_assignee:=v_issue.claimed_by;
  v_old_status:=v_issue.status;
  if v_old_assignee is not distinct from p_new_assignee and v_issue.status='CLAIMED' then return public.issue_json(v_issue); end if;
  update public.issues set status='CLAIMED',claimed_by=p_new_assignee,claimed_at=now(),issue_version=issue_version+1,updated_at=now()
  where id=p_issue_id returning * into v_issue;
  insert into public.issue_audit(issue_id,actor_id,action,from_status,to_status,detail)
  values(v_issue.id,p_actor,'REASSIGN',v_old_status,v_issue.status,jsonb_build_object('old_assignee',v_old_assignee,'new_assignee',p_new_assignee,'reason',v_reason,'issue_version',v_issue.issue_version));
  insert into public.sheet_export_queue(event_type,payload)
  values('ISSUE_REASSIGN',public.issue_json(v_issue)||jsonb_build_object('actor_id',p_actor,'old_assignee',v_old_assignee,'new_assignee',p_new_assignee,'reason',v_reason));
  return public.issue_json(v_issue)||jsonb_build_object('old_assignee_id',v_old_assignee,'new_assignee_id',p_new_assignee,'reassign_reason',v_reason);
end $$;

revoke all on function public.issue_json(public.issues) from public,anon,authenticated;
revoke all on function public.report_shortage_atomic(text,uuid,text) from public,anon,authenticated;
revoke all on function public.update_issue_atomic(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.reassign_issue_atomic(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.issue_json(public.issues) to service_role;
grant execute on function public.report_shortage_atomic(text,uuid,text) to service_role;
grant execute on function public.update_issue_atomic(uuid,uuid,text) to service_role;
grant execute on function public.reassign_issue_atomic(uuid,uuid,uuid,text) to service_role;
