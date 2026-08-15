begin;

create table if not exists public.authority_recovery_control (
  source_mode text primary key check (source_mode in ('SHEET_FALLBACK','FIREBASE_EMERGENCY')),
  imported_sequence bigint not null default 0,
  sheet_ack_sequence bigint not null default 0,
  state text not null default 'IDLE' check (state in ('IDLE','IMPORTING','BLOCKED','CAUGHT_UP')),
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error_code text,
  last_error_detail text,
  updated_at timestamptz not null default now()
);
alter table public.authority_recovery_control enable row level security;
revoke all on table public.authority_recovery_control from public,anon,authenticated;
insert into public.authority_recovery_control(source_mode) values('SHEET_FALLBACK'),('FIREBASE_EMERGENCY') on conflict do nothing;

create table if not exists public.reconciliation_conflicts (
  event_id uuid primary key,
  source_mode text not null,
  sheet_sequence bigint,
  event_type text not null,
  issue_id uuid,
  sku text,
  actor_account_id uuid,
  error_code text not null,
  error_detail text not null,
  event_payload jsonb not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id),
  resolution text
);
alter table public.reconciliation_conflicts enable row level security;
revoke all on table public.reconciliation_conflicts from public,anon,authenticated;
create index if not exists reconciliation_conflicts_open_idx on public.reconciliation_conflicts(created_at) where resolved_at is null;

create or replace function public.import_authority_event_service(p_event jsonb)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_event_id uuid;
  v_source text:=upper(trim(coalesce(p_event->>'source_mode','SHEET_FALLBACK')));
  v_type text:=upper(trim(coalesce(p_event->>'event_type','')));
  v_sequence bigint:=coalesce((p_event->>'sheet_sequence')::bigint,0);
  v_actor uuid;
  v_role public.user_role;
  v_issue_id uuid;
  v_sku text:=upper(trim(coalesce(p_event->>'sku','')));
  v_version bigint:=greatest(1,coalesce((p_event->>'issue_version')::bigint,1));
  v_payload jsonb;
  v_accepted timestamptz:=coalesce(nullif(p_event->>'accepted_at_authority','')::timestamptz,now());
  v_sheet_ack timestamptz:=coalesce(nullif(p_event->>'sheet_ack_at','')::timestamptz,v_accepted);
  v_issue public.issues%rowtype;
  v_product text;
  v_new_assignee uuid;
  v_action text;
  v_result jsonb;
  v_existing public.authority_events%rowtype;
  v_expected_previous bigint;
begin
  begin
    v_event_id:=(p_event->>'event_id')::uuid;
    v_actor:=(p_event->>'actor_account_id')::uuid;
    v_issue_id:=(p_event->>'issue_id')::uuid;
    if v_source not in ('SHEET_FALLBACK','FIREBASE_EMERGENCY') then raise exception 'INVALID_SOURCE_MODE'; end if;
    if v_type not in ('REPORT_SHORTAGE','CLAIM','AVAILABLE','SKIP_ALLOWED','REASSIGN') then raise exception 'INVALID_EVENT_TYPE'; end if;
    if v_sequence<1 then raise exception 'INVALID_SHEET_SEQUENCE'; end if;
    if v_sku='' then raise exception 'SKU_REQUIRED'; end if;
    if not exists(select 1 from public.profiles where id=v_actor) then raise exception 'ACTOR_NOT_PROVISIONED'; end if;
    select role into v_role from public.profiles where id=v_actor;
    if jsonb_typeof(p_event->'payload_json')='object' then v_payload:=p_event->'payload_json';
    elsif nullif(p_event->>'payload_json','') is not null then v_payload:=(p_event->>'payload_json')::jsonb;
    else v_payload:='{}'::jsonb; end if;

    select * into v_existing from public.authority_events where event_id=v_event_id;
    if found then
      if v_existing.source_mode<>v_source or v_existing.event_type<>v_type or v_existing.issue_id is distinct from v_issue_id then raise exception 'EVENT_ID_REUSE_CONFLICT'; end if;
      return jsonb_build_object('ok',true,'idempotent',true,'event_id',v_event_id,'sheet_sequence',v_sequence,'issue_id',v_existing.issue_id,'reconciliation_status',v_existing.reconciliation_status);
    end if;

    perform pg_advisory_xact_lock(hashtextextended(lower(v_sku),1291));

    if v_type='REPORT_SHORTAGE' then
      if exists(select 1 from public.issue_reports where client_request_id=v_event_id::text) then
        select i.* into v_issue from public.issue_reports r join public.issues i on i.id=r.issue_id where r.client_request_id=v_event_id::text;
        if v_issue.id<>v_issue_id then raise exception 'REPORT_REQUEST_CONFLICT'; end if;
      else
        select * into v_issue from public.issues where id=v_issue_id for update;
        if not found then
          if exists(select 1 from public.issues where sku=v_sku and status in('OPEN','CLAIMED','SEARCHING','REPLENISHING') and id<>v_issue_id) then raise exception 'ACTIVE_ISSUE_CONFLICT'; end if;
          select product_name into v_product from public.sku_catalog where sku=v_sku and active=true limit 1;
          if v_product is null then v_product:=coalesce(v_payload->>'product_name',''); end if;
          insert into public.issues(id,sku,product_name_snapshot,status,report_count,first_reported_at,updated_at,issue_version)
          values(v_issue_id,v_sku,v_product,'OPEN',1,v_accepted,v_accepted,1)
          returning * into v_issue;
        else
          if v_issue.sku<>v_sku then raise exception 'ISSUE_SKU_CONFLICT'; end if;
          if v_issue.status not in ('OPEN','CLAIMED','SEARCHING','REPLENISHING') then raise exception 'REPORT_AFTER_TERMINAL_CONFLICT'; end if;
          update public.issues set report_count=report_count+1,updated_at=greatest(updated_at,v_accepted) where id=v_issue_id returning * into v_issue;
        end if;
        insert into public.issue_reports(issue_id,reporter_id,reported_at,client_request_id)
        values(v_issue_id,v_actor,v_accepted,v_event_id::text);
        insert into public.issue_audit(issue_id,actor_id,action,to_status,detail)
        values(v_issue_id,v_actor,'IMPORT_REPORT_SHORTAGE',v_issue.status,jsonb_build_object('source_mode',v_source,'sheet_sequence',v_sequence,'event_id',v_event_id));
      end if;
      v_result:=public.issue_json(v_issue);
      insert into public.mutation_requests(client_request_id,actor_id,action,issue_id,result_json)
      values(v_event_id,v_actor,'REPORT_SHORTAGE',v_issue_id,jsonb_build_object('issue',v_result,'already_reported',v_issue.report_count>1,'duplicate_request',false,'message','Đã phục hồi từ Google Sheet'))
      on conflict(client_request_id) do nothing;

    elsif v_type='CLAIM' then
      select * into v_issue from public.issues where id=v_issue_id for update;
      if not found then raise exception 'ISSUE_NOT_FOUND_FOR_CLAIM'; end if;
      v_expected_previous:=v_version-1;
      if v_issue.issue_version=v_version and v_issue.status='CLAIMED' and v_issue.claimed_by=v_actor then null;
      elsif v_issue.issue_version<>v_expected_previous or v_issue.status not in('OPEN','CLAIMED','SEARCHING','REPLENISHING') then raise exception 'CLAIM_VERSION_CONFLICT';
      elsif v_issue.claimed_by is not null and v_issue.claimed_by<>v_actor then raise exception 'CLAIM_OWNER_CONFLICT';
      else
        update public.issues set status='CLAIMED',claimed_by=v_actor,claimed_at=coalesce(claimed_at,v_accepted),issue_version=v_version,updated_at=greatest(updated_at,v_accepted)
        where id=v_issue_id returning * into v_issue;
        insert into public.issue_audit(issue_id,actor_id,action,from_status,to_status,detail)
        values(v_issue_id,v_actor,'IMPORT_CLAIM','OPEN','CLAIMED',jsonb_build_object('source_mode',v_source,'sheet_sequence',v_sequence,'event_id',v_event_id));
      end if;
      v_result:=public.issue_json(v_issue);
      insert into public.mutation_requests(client_request_id,actor_id,action,issue_id,result_json) values(v_event_id,v_actor,'CLAIM',v_issue_id,v_result) on conflict do nothing;

    elsif v_type in('AVAILABLE','SKIP_ALLOWED') then
      select * into v_issue from public.issues where id=v_issue_id for update;
      if not found then raise exception 'ISSUE_NOT_FOUND_FOR_STATUS'; end if;
      v_expected_previous:=v_version-1;
      if v_issue.issue_version=v_version and v_issue.status::text=v_type then null;
      elsif v_issue.issue_version<>v_expected_previous or v_issue.status not in('OPEN','CLAIMED','SEARCHING','REPLENISHING') then raise exception 'STATUS_VERSION_CONFLICT';
      else
        update public.issues set status=v_type::public.issue_status,claimed_by=coalesce(claimed_by,v_actor),claimed_at=coalesce(claimed_at,v_accepted),resolved_at=v_accepted,issue_version=v_version,updated_at=greatest(updated_at,v_accepted)
        where id=v_issue_id returning * into v_issue;
        insert into public.issue_audit(issue_id,actor_id,action,to_status,detail)
        values(v_issue_id,v_actor,'IMPORT_'||v_type,v_type::public.issue_status,jsonb_build_object('source_mode',v_source,'sheet_sequence',v_sequence,'event_id',v_event_id));
      end if;
      v_result:=public.issue_json(v_issue);
      v_action:=case when v_type='SKIP_ALLOWED' then 'NOT_FOUND' else 'AVAILABLE' end;
      insert into public.mutation_requests(client_request_id,actor_id,action,issue_id,result_json) values(v_event_id,v_actor,v_action,v_issue_id,v_result) on conflict do nothing;
      insert into public.notification_events(issue_id,target_user_id,status,issue_version,title,message,critical,expires_at)
      select v_issue_id,r.reporter_id,v_type::public.issue_status,v_version,
        case when v_type='AVAILABLE' then 'ĐÃ CÓ HÀNG • SKU '||v_sku else 'CHO PHÉP SKIP • SKU '||v_sku end,
        case when v_type='AVAILABLE' then 'SKU '||v_sku||' đã được bổ sung hàng. Vui lòng quay lại vị trí lấy hàng và tiếp tục thao tác.' else 'Không tìm thấy hàng để bổ sung cho SKU '||v_sku||'. Bạn được phép SKIP SKU này và tiếp tục công việc.' end,
        true,now()+interval '24 hours'
      from(select distinct reporter_id from public.issue_reports where issue_id=v_issue_id)r
      on conflict(target_user_id,issue_id,issue_version,status) where critical=true and issue_id is not null do nothing;

    elsif v_type='REASSIGN' then
      select * into v_issue from public.issues where id=v_issue_id for update;
      if not found then raise exception 'ISSUE_NOT_FOUND_FOR_REASSIGN'; end if;
      v_new_assignee:=nullif(v_payload->>'new_assignee_account_id','')::uuid;
      if v_new_assignee is null or not exists(select 1 from public.profiles where id=v_new_assignee and role in('INVENT','ADMIN_INVENT') and active=true) then raise exception 'INVALID_REASSIGN_TARGET'; end if;
      v_expected_previous:=v_version-1;
      if v_issue.issue_version=v_version and v_issue.status='CLAIMED' and v_issue.claimed_by=v_new_assignee then null;
      elsif v_issue.issue_version<>v_expected_previous or v_issue.status not in('OPEN','CLAIMED','SEARCHING','REPLENISHING') then raise exception 'REASSIGN_VERSION_CONFLICT';
      else
        update public.issues set status='CLAIMED',claimed_by=v_new_assignee,claimed_at=v_accepted,issue_version=v_version,updated_at=greatest(updated_at,v_accepted)
        where id=v_issue_id returning * into v_issue;
        insert into public.issue_audit(issue_id,actor_id,action,to_status,detail)
        values(v_issue_id,v_actor,'IMPORT_REASSIGN','CLAIMED',jsonb_build_object('source_mode',v_source,'sheet_sequence',v_sequence,'event_id',v_event_id,'new_assignee',v_new_assignee,'reason',coalesce(v_payload->>'reason','')));
      end if;
      v_result:=public.issue_json(v_issue)||jsonb_build_object('new_assignee_id',v_new_assignee,'reassign_reason',coalesce(v_payload->>'reason',''));
      insert into public.mutation_requests(client_request_id,actor_id,action,issue_id,result_json) values(v_event_id,v_actor,'REASSIGN',v_issue_id,v_result) on conflict do nothing;
    end if;

    insert into public.authority_events(event_id,source_mode,event_type,occurred_at_device,accepted_at_authority,actor_account_id,actor_role,device_id,issue_id,sku,issue_version,payload_json,payload_sha256,service_ack_at,sheet_ack_at,reconciliation_status)
    values(v_event_id,v_source,v_type,nullif(p_event->>'occurred_at_device','')::timestamptz,v_accepted,v_actor,v_role::text,p_event->>'device_id',v_issue_id,v_sku,v_version,v_payload,
      coalesce(nullif(p_event->>'payload_sha256',''),encode(extensions.digest(convert_to(v_payload::text,'UTF8'),'sha256'),'hex')),now(),v_sheet_ack,'SERVICE_ACKED');

    update public.authority_recovery_control set imported_sequence=greatest(imported_sequence,v_sequence),state='IMPORTING',last_success_at=now(),last_error_code=null,last_error_detail=null,updated_at=now()
    where source_mode=v_source;

    return jsonb_build_object('ok',true,'idempotent',false,'event_id',v_event_id,'sheet_sequence',v_sequence,'issue_id',v_issue_id,'result',v_result,'reconciliation_status','SERVICE_ACKED');

  exception when others then
    insert into public.reconciliation_conflicts(event_id,source_mode,sheet_sequence,event_type,issue_id,sku,actor_account_id,error_code,error_detail,event_payload)
    values(coalesce(v_event_id,gen_random_uuid()),coalesce(v_source,'UNKNOWN'),v_sequence,coalesce(v_type,'UNKNOWN'),v_issue_id,v_sku,v_actor,sqlstate,left(sqlerrm,1000),p_event)
    on conflict(event_id) do update set error_code=excluded.error_code,error_detail=excluded.error_detail,event_payload=excluded.event_payload;
    if v_source in('SHEET_FALLBACK','FIREBASE_EMERGENCY') then
      update public.authority_recovery_control set state='BLOCKED',last_error_at=now(),last_error_code=sqlstate,last_error_detail=left(sqlerrm,1000),updated_at=now() where source_mode=v_source;
    end if;
    return jsonb_build_object('ok',false,'blocked',true,'event_id',v_event_id,'sheet_sequence',v_sequence,'error_code',sqlstate,'error',left(sqlerrm,300));
  end;
end;
$$;

revoke execute on function public.import_authority_event_service(jsonb) from public,anon,authenticated;
grant execute on function public.import_authority_event_service(jsonb) to service_role;

commit;
