-- Service-only helpers keep Supra ciphertext and staging outside the exposed Data API.

alter table public.notification_events
  add column if not exists fcm_accepted_at timestamptz,
  add column if not exists client_received_at timestamptz,
  add column if not exists displayed_at timestamptz;

create or replace function public.get_supra_connection_service(p_site text default '1291')
returns jsonb language sql stable security definer set search_path=private,public as $$
  select case when c.warehouse_site_id is null then null else jsonb_build_object(
    'warehouse_site_id',c.warehouse_site_id,'warehouse_code',c.warehouse_code,'client_code',c.client_code,
    'api_base_url',c.api_base_url,'encrypted_credential_bundle',c.encrypted_credential_bundle,
    'encryption_version',c.encryption_version,'credential_version',c.credential_version,
    'sign_prefix',c.sign_prefix,'enabled',c.enabled,'status',c.status,'source_contract',c.source_contract,
    'last_tested_at',c.last_tested_at,'last_test_error',c.last_test_error,'updated_at',c.updated_at
  ) end from private.supra_connections c where c.warehouse_site_id=p_site
$$;

create or replace function public.set_supra_connection_service(
  p_site text,p_ciphertext text,p_updated_by uuid,p_enabled boolean default false,
  p_status text default 'SOURCE_CONTRACT_UNVERIFIED',p_source_contract jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path=private,public as $$
declare v private.supra_connections%rowtype;
begin
  if p_status not in ('DISABLED','CONNECTED','AUTH_EXPIRED','SOURCE_CONTRACT_UNVERIFIED','SOURCE_SCHEMA_CHANGED','ERROR') then raise exception 'INVALID_CONNECTION_STATUS'; end if;
  update private.supra_connections set encrypted_credential_bundle=p_ciphertext,credential_version=credential_version+1,
    enabled=p_enabled,status=p_status,source_contract=coalesce(p_source_contract,'{}'::jsonb),last_test_error='',updated_by=p_updated_by,updated_at=now()
    where warehouse_site_id=p_site returning * into v;
  if not found then raise exception 'CONNECTION_NOT_FOUND'; end if;
  return jsonb_build_object('warehouse_site_id',v.warehouse_site_id,'credential_version',v.credential_version,'enabled',v.enabled,'status',v.status,'updated_at',v.updated_at);
end $$;

create or replace function public.update_supra_connection_test_service(
  p_site text,p_status text,p_source_contract jsonb default null,p_error text default ''
)
returns void language plpgsql security definer set search_path=private,public as $$
begin
  if p_status not in ('DISABLED','CONNECTED','AUTH_EXPIRED','SOURCE_CONTRACT_UNVERIFIED','SOURCE_SCHEMA_CHANGED','ERROR') then raise exception 'INVALID_CONNECTION_STATUS'; end if;
  update private.supra_connections set status=p_status,
    source_contract=coalesce(p_source_contract,source_contract),last_tested_at=now(),last_test_error=left(coalesce(p_error,''),1000),updated_at=now()
    where warehouse_site_id=p_site;
end $$;

create or replace function public.stage_inventory_items_service(p_job_id uuid,p_rows jsonb)
returns integer language plpgsql security definer set search_path=private,public as $$
declare v_count integer;
begin
  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 or jsonb_array_length(p_rows)>1000 then raise exception 'INVALID_STAGE_BATCH'; end if;
  if not exists(select 1 from public.inventory_sync_jobs where id=p_job_id and state in ('QUEUED','CONNECTING','FETCHING')) then raise exception 'JOB_NOT_STAGEABLE'; end if;
  insert into private.inventory_staging_items(job_id,row_key,sku,bin_code,storage_type,is_pickable,bin_qty,pending_out_qty,raw_row_hash)
  select p_job_id,trim(x.row_key),trim(x.sku),coalesce(trim(x.bin_code),''),coalesce(trim(x.storage_type),''),x.is_pickable,x.bin_qty,x.pending_out_qty,lower(x.raw_row_hash)
  from jsonb_to_recordset(p_rows) as x(row_key text,sku text,bin_code text,storage_type text,is_pickable boolean,bin_qty numeric,pending_out_qty numeric,raw_row_hash text)
  where trim(coalesce(x.row_key,''))<>'' and trim(coalesce(x.sku,''))<>'' and x.bin_qty>=0 and x.pending_out_qty>=0 and lower(x.raw_row_hash)~'^[0-9a-f]{64}$'
  on conflict(job_id,row_key) do update set sku=excluded.sku,bin_code=excluded.bin_code,storage_type=excluded.storage_type,is_pickable=excluded.is_pickable,bin_qty=excluded.bin_qty,pending_out_qty=excluded.pending_out_qty,raw_row_hash=excluded.raw_row_hash;
  get diagnostics v_count=row_count;
  return v_count;
end $$;

create or replace function public.inventory_staging_digest_input_service(p_job_id uuid)
returns text language sql stable security definer set search_path=private,public as $$
  select string_agg(row_key||':'||raw_row_hash,E'\n' order by row_key) from private.inventory_staging_items where job_id=p_job_id
$$;

create or replace function public.inventory_staging_count_service(p_job_id uuid)
returns integer language sql stable security definer set search_path=private,public as $$
  select count(*)::integer from private.inventory_staging_items where job_id=p_job_id
$$;

create or replace function public.reassign_issue_atomic(p_issue_id uuid,p_actor uuid,p_new_assignee uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_issue public.issues%rowtype; v_role public.user_role; v_target_role public.user_role; v_old_assignee uuid; v_old_status public.issue_status; v_reason text:=trim(coalesce(p_reason,''));
begin
  select role into v_role from public.profiles where id=p_actor and active=true;
  if v_role not in ('ADMIN'::public.user_role,'ADMIN_INVENT'::public.user_role) then raise exception 'FORBIDDEN'; end if;
  if length(v_reason)<3 then raise exception 'REASSIGN_REASON_REQUIRED'; end if;
  select role into v_target_role from public.profiles where id=p_new_assignee and active=true;
  if v_target_role not in ('INVENT'::public.user_role,'ADMIN_INVENT'::public.user_role) then raise exception 'INVALID_ASSIGNEE'; end if;
  select * into v_issue from public.issues where id=p_issue_id for update; if not found then raise exception 'ISSUE_NOT_FOUND'; end if;
  if v_issue.status not in ('OPEN','CLAIMED','SEARCHING','REPLENISHING') then raise exception 'ISSUE_ALREADY_RESOLVED'; end if;
  v_old_assignee:=v_issue.claimed_by; v_old_status:=v_issue.status;
  if v_old_assignee is not distinct from p_new_assignee and v_issue.status='CLAIMED' then return public.issue_json(v_issue); end if;
  update public.issues set status='CLAIMED',claimed_by=p_new_assignee,claimed_at=now(),issue_version=issue_version+1,updated_at=now() where id=p_issue_id returning * into v_issue;
  insert into public.issue_audit(issue_id,actor_id,action,from_status,to_status,detail) values(v_issue.id,p_actor,'REASSIGN',v_old_status,v_issue.status,jsonb_build_object('old_assignee',v_old_assignee,'new_assignee',p_new_assignee,'reason',v_reason,'issue_version',v_issue.issue_version));
  insert into public.sheet_export_queue(event_type,payload) values('ISSUE_REASSIGN',public.issue_json(v_issue)||jsonb_build_object('actor_id',p_actor,'old_assignee',v_old_assignee,'new_assignee',p_new_assignee,'reason',v_reason));
  return public.issue_json(v_issue)||jsonb_build_object('old_assignee_id',v_old_assignee,'new_assignee_id',p_new_assignee,'reassign_reason',v_reason);
end $$;

revoke all on function public.get_supra_connection_service(text) from public,anon,authenticated;
revoke all on function public.set_supra_connection_service(text,text,uuid,boolean,text,jsonb) from public,anon,authenticated;
revoke all on function public.update_supra_connection_test_service(text,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.stage_inventory_items_service(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.inventory_staging_digest_input_service(uuid) from public,anon,authenticated;
revoke all on function public.inventory_staging_count_service(uuid) from public,anon,authenticated;
grant execute on function public.get_supra_connection_service(text) to service_role;
grant execute on function public.set_supra_connection_service(text,text,uuid,boolean,text,jsonb) to service_role;
grant execute on function public.update_supra_connection_test_service(text,text,jsonb,text) to service_role;
grant execute on function public.stage_inventory_items_service(uuid,jsonb) to service_role;
grant execute on function public.inventory_staging_digest_input_service(uuid) to service_role;
grant execute on function public.inventory_staging_count_service(uuid) to service_role;
