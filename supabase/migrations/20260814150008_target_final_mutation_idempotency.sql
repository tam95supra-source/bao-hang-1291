begin;

create table if not exists public.mutation_requests (
  client_request_id uuid primary key,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  action text not null,
  issue_id uuid,
  result_json jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.mutation_requests enable row level security;
create index if not exists mutation_requests_actor_created_idx on public.mutation_requests(actor_id,created_at desc);
revoke all on table public.mutation_requests from public,anon,authenticated;

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
  v_event_id uuid;
  v_payload jsonb;
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

  v_payload:=public.issue_json(v_issue)||jsonb_build_object('reporter_id',p_reporter,'client_request_id',nullif(trim(p_client_request_id),''));
  if coalesce(trim(p_client_request_id),'') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_event_id:=trim(p_client_request_id)::uuid;
  else
    v_event_id:=gen_random_uuid();
  end if;
  insert into public.sheet_export_queue(event_id,event_type,payload,actor_account_id,issue_id,sku,issue_version)
  values(v_event_id,'REPORT_SHORTAGE',v_payload,p_reporter,v_issue.id,v_issue.sku,v_issue.issue_version);
  insert into public.authority_events(event_id,source_mode,event_type,actor_account_id,actor_role,issue_id,sku,issue_version,payload_json,payload_sha256,service_ack_at,reconciliation_status)
  values(v_event_id,'SERVICE','REPORT_SHORTAGE',p_reporter,(select role::text from public.profiles where id=p_reporter),v_issue.id,v_issue.sku,v_issue.issue_version,v_payload,
    encode(extensions.digest(convert_to(v_payload::text,'UTF8'),'sha256'),'hex'),now(),'PENDING')
  on conflict(event_id) do nothing;
  return jsonb_build_object('issue',public.issue_json(v_issue),'already_reported',v_already,'duplicate_request',false,'message','Đã ghi nhận báo thiếu');
end;
$$;

create or replace function public.update_issue_atomic(p_issue_id uuid, p_actor uuid, p_action text, p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_issue public.issues%rowtype;
  v_old public.issue_status;
  v_role public.user_role;
  v_action text:=upper(trim(p_action));
  v_changed boolean:=false;
  v_payload jsonb;
begin
  select role into v_role from public.profiles where id=p_actor and active=true;
  if v_role not in ('ADMIN','ADMIN_INVENT','INVENT') then raise exception 'FORBIDDEN'; end if;
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
    if v_role='INVENT' and v_issue.claimed_by is distinct from p_actor then raise exception 'ISSUE_NOT_OWNED'; end if;
    update public.issues set status=case when v_action='AVAILABLE' then 'AVAILABLE'::public.issue_status else 'SKIP_ALLOWED'::public.issue_status end,
      claimed_by=coalesce(claimed_by,p_actor),claimed_at=coalesce(claimed_at,now()),resolved_at=now(),issue_version=issue_version+1,updated_at=now()
    where id=p_issue_id returning * into v_issue;
    v_changed:=true;
  elsif v_action='CLOSE' and v_role='ADMIN' then
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
    values(v_issue.id,p_actor,v_action,v_old,v_issue.status,jsonb_build_object('claimed_by',v_issue.claimed_by,'issue_version',v_issue.issue_version,'client_request_id',p_event_id));
    v_payload:=public.issue_json(v_issue)||jsonb_build_object('actor_id',p_actor,'action',v_action,'client_request_id',p_event_id);
    insert into public.sheet_export_queue(event_id,event_type,payload,actor_account_id,issue_id,sku,issue_version)
    values(p_event_id,'ISSUE_STATUS',v_payload,p_actor,v_issue.id,v_issue.sku,v_issue.issue_version);
    insert into public.authority_events(event_id,source_mode,event_type,actor_account_id,actor_role,issue_id,sku,issue_version,payload_json,payload_sha256,service_ack_at,reconciliation_status)
    values(p_event_id,'SERVICE',v_action,p_actor,v_role::text,v_issue.id,v_issue.sku,v_issue.issue_version,v_payload,
      encode(extensions.digest(convert_to(v_payload::text,'UTF8'),'sha256'),'hex'),now(),'PENDING')
    on conflict(event_id) do nothing;
  end if;
  return public.issue_json(v_issue);
end;
$$;

create or replace function public.reassign_issue_atomic(p_issue_id uuid,p_actor uuid,p_new_assignee uuid,p_reason text,p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_issue public.issues%rowtype;
  v_role public.user_role;
  v_target_role public.user_role;
  v_old_assignee uuid;
  v_old_status public.issue_status;
  v_reason text:=trim(coalesce(p_reason,''));
  v_payload jsonb;
begin
  select role into v_role from public.profiles where id=p_actor and active=true;
  if v_role not in ('ADMIN','ADMIN_INVENT') then raise exception 'FORBIDDEN'; end if;
  if length(v_reason)<3 then raise exception 'REASSIGN_REASON_REQUIRED'; end if;
  select role into v_target_role from public.profiles where id=p_new_assignee and active=true;
  if v_target_role not in ('INVENT','ADMIN_INVENT') then raise exception 'INVALID_ASSIGNEE'; end if;
  select * into v_issue from public.issues where id=p_issue_id for update;
  if not found then raise exception 'ISSUE_NOT_FOUND'; end if;
  if v_issue.status not in ('OPEN','CLAIMED','SEARCHING','REPLENISHING') then raise exception 'ISSUE_ALREADY_RESOLVED'; end if;
  v_old_assignee:=v_issue.claimed_by;
  v_old_status:=v_issue.status;
  if v_old_assignee is not distinct from p_new_assignee and v_issue.status='CLAIMED' then return public.issue_json(v_issue); end if;
  update public.issues set status='CLAIMED',claimed_by=p_new_assignee,claimed_at=now(),issue_version=issue_version+1,updated_at=now()
  where id=p_issue_id returning * into v_issue;
  insert into public.issue_audit(issue_id,actor_id,action,from_status,to_status,detail)
  values(v_issue.id,p_actor,'REASSIGN',v_old_status,v_issue.status,
    jsonb_build_object('old_assignee',v_old_assignee,'new_assignee',p_new_assignee,'reason',v_reason,'issue_version',v_issue.issue_version,'client_request_id',p_event_id));
  v_payload:=public.issue_json(v_issue)||jsonb_build_object('actor_id',p_actor,'old_assignee',v_old_assignee,'new_assignee',p_new_assignee,'reason',v_reason,'client_request_id',p_event_id);
  insert into public.sheet_export_queue(event_id,event_type,payload,actor_account_id,issue_id,sku,issue_version)
  values(p_event_id,'ISSUE_REASSIGN',v_payload,p_actor,v_issue.id,v_issue.sku,v_issue.issue_version);
  insert into public.authority_events(event_id,source_mode,event_type,actor_account_id,actor_role,issue_id,sku,issue_version,payload_json,payload_sha256,service_ack_at,reconciliation_status)
  values(p_event_id,'SERVICE','REASSIGN',p_actor,v_role::text,v_issue.id,v_issue.sku,v_issue.issue_version,v_payload,
    encode(extensions.digest(convert_to(v_payload::text,'UTF8'),'sha256'),'hex'),now(),'PENDING')
  on conflict(event_id) do nothing;
  return public.issue_json(v_issue)||jsonb_build_object('old_assignee_id',v_old_assignee,'new_assignee_id',p_new_assignee,'reassign_reason',v_reason);
end;
$$;

create or replace function public.claim_issue_rpc(p_issue_id uuid,p_client_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare v_uid uuid:=auth.uid();v_role public.user_role;v_old public.mutation_requests%rowtype;v_result jsonb;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select role into v_role from public.profiles where id=v_uid and active=true;
  if v_role not in ('ADMIN','ADMIN_INVENT','INVENT') then raise exception 'FORBIDDEN'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_client_request_id::text,1291));
  select * into v_old from public.mutation_requests where client_request_id=p_client_request_id;
  if found then
    if v_old.actor_id<>v_uid or v_old.action<>'CLAIM' or v_old.issue_id is distinct from p_issue_id then raise exception 'REQUEST_ID_REUSE_CONFLICT'; end if;
    return v_old.result_json;
  end if;
  v_result:=public.update_issue_atomic(p_issue_id,v_uid,'CLAIM',p_client_request_id);
  insert into public.mutation_requests(client_request_id,actor_id,action,issue_id,result_json) values(p_client_request_id,v_uid,'CLAIM',p_issue_id,v_result);
  return v_result;
end;
$$;

create or replace function public.update_issue_rpc(p_issue_id uuid,p_action text,p_client_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();v_role public.user_role;v_action text:=upper(trim(p_action));v_old public.mutation_requests%rowtype;v_result jsonb;v_status text;v_version bigint;v_sku text;v_message text;v_title text;v_inserted integer:=0;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select role into v_role from public.profiles where id=v_uid and active=true;
  if v_role not in ('ADMIN','ADMIN_INVENT','INVENT') then raise exception 'FORBIDDEN'; end if;
  if v_action='SKIP_ALLOWED' then v_action:='NOT_FOUND'; end if;
  if v_action not in ('AVAILABLE','NOT_FOUND') and not(v_action='CLOSE' and v_role='ADMIN') then raise exception 'INVALID_ACTION'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_client_request_id::text,1291));
  select * into v_old from public.mutation_requests where client_request_id=p_client_request_id;
  if found then
    if v_old.actor_id<>v_uid or v_old.action<>v_action or v_old.issue_id is distinct from p_issue_id then raise exception 'REQUEST_ID_REUSE_CONFLICT'; end if;
    return v_old.result_json;
  end if;
  v_result:=public.update_issue_atomic(p_issue_id,v_uid,v_action,p_client_request_id);
  insert into public.mutation_requests(client_request_id,actor_id,action,issue_id,result_json) values(p_client_request_id,v_uid,v_action,p_issue_id,v_result);
  v_status:=v_result->>'status';v_version:=coalesce((v_result->>'issue_version')::bigint,1);v_sku:=coalesce(v_result->>'sku','');
  if v_status in ('AVAILABLE','SKIP_ALLOWED') then
    update public.notification_events set acknowledged_at=coalesce(acknowledged_at,now())
      where issue_id=p_issue_id and critical=true and acknowledged_at is null and(issue_version<>v_version or status::text<>v_status);
    v_title:=case when v_status='AVAILABLE' then 'ĐÃ CÓ HÀNG • SKU '||v_sku else 'CHO PHÉP SKIP • SKU '||v_sku end;
    v_message:=case when v_status='AVAILABLE' then 'SKU '||v_sku||' đã được bổ sung hàng. Vui lòng quay lại vị trí lấy hàng và tiếp tục thao tác.' else 'Không tìm thấy hàng để bổ sung cho SKU '||v_sku||'. Bạn được phép SKIP SKU này và tiếp tục công việc.' end;
    insert into public.notification_events(issue_id,target_user_id,status,issue_version,title,message,critical,expires_at)
    select p_issue_id,r.reporter_id,v_status::public.issue_status,v_version,v_title,v_message,true,now()+interval '24 hours'
    from(select distinct reporter_id from public.issue_reports where issue_id=p_issue_id)r
    on conflict(target_user_id,issue_id,issue_version,status) where critical=true and issue_id is not null do nothing;
    get diagnostics v_inserted=row_count;
    if v_inserted>0 then
      perform net.http_post(url :=(select decrypted_secret from vault.decrypted_secrets where name='bao_hang_1291_project_url')||'/functions/v1/notification-worker/run',
        headers:=jsonb_build_object('content-type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='bao_hang_1291_cron_secret')),
        body:=jsonb_build_object('issue_id',p_issue_id,'issue_version',v_version,'status',v_status),timeout_milliseconds:=15000);
    end if;
  end if;
  return v_result;
end;
$$;

create or replace function public.reassign_issue_rpc(p_issue_id uuid,p_new_assignee uuid,p_reason text,p_client_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare v_uid uuid:=auth.uid();v_role public.user_role;v_old public.mutation_requests%rowtype;v_result jsonb;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select role into v_role from public.profiles where id=v_uid and active=true;
  if v_role not in ('ADMIN','ADMIN_INVENT') then raise exception 'FORBIDDEN'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_client_request_id::text,1291));
  select * into v_old from public.mutation_requests where client_request_id=p_client_request_id;
  if found then
    if v_old.actor_id<>v_uid or v_old.action<>'REASSIGN' or v_old.issue_id is distinct from p_issue_id then raise exception 'REQUEST_ID_REUSE_CONFLICT'; end if;
    return v_old.result_json;
  end if;
  v_result:=public.reassign_issue_atomic(p_issue_id,v_uid,p_new_assignee,p_reason,p_client_request_id);
  insert into public.mutation_requests(client_request_id,actor_id,action,issue_id,result_json) values(p_client_request_id,v_uid,'REASSIGN',p_issue_id,v_result);
  return v_result;
end;
$$;

revoke execute on function public.update_issue_atomic(uuid,uuid,text,uuid) from public,anon,authenticated;
revoke execute on function public.reassign_issue_atomic(uuid,uuid,uuid,text,uuid) from public,anon,authenticated;
revoke execute on function public.claim_issue_rpc(uuid,uuid) from public,anon;
revoke execute on function public.update_issue_rpc(uuid,text,uuid) from public,anon;
revoke execute on function public.reassign_issue_rpc(uuid,uuid,text,uuid) from public,anon;
grant execute on function public.claim_issue_rpc(uuid,uuid) to authenticated;
grant execute on function public.update_issue_rpc(uuid,text,uuid) to authenticated;
grant execute on function public.reassign_issue_rpc(uuid,uuid,text,uuid) to authenticated;

commit;
