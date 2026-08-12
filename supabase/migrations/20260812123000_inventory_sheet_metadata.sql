-- Keep Google Sheet as reporting/conciliation only: export inventory metadata, never full snapshot rows.
create or replace function public.finalize_inventory_snapshot(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path=public,private as $$
declare
  v_job public.inventory_sync_jobs%rowtype;
  v_snapshot uuid;
  v_count integer;
  v_existing uuid;
begin
  select * into v_job from public.inventory_sync_jobs where id=p_job_id for update;
  if not found then raise exception 'JOB_NOT_FOUND'; end if;
  if v_job.state in ('SUCCEEDED','NO_CHANGE') then
    return jsonb_build_object('job_id',v_job.id,'state',v_job.state);
  end if;
  if v_job.state not in ('VALIDATING','PUBLISHING') then raise exception 'JOB_NOT_READY'; end if;
  if v_job.sha256 is null or v_job.source_captured_at is null then raise exception 'JOB_METADATA_INCOMPLETE'; end if;

  select count(*) into v_count from private.inventory_staging_items where job_id=p_job_id;
  if v_count=0 or v_count<>v_job.normalized_row_count then raise exception 'ROW_COUNT_MISMATCH'; end if;
  if exists(
    select 1 from private.inventory_staging_items
    where job_id=p_job_id and (trim(sku)='' or bin_qty<0 or pending_out_qty<0)
  ) then raise exception 'INVALID_STAGING_ROW'; end if;

  select id into v_existing from public.inventory_snapshots
  where warehouse_site_id=v_job.warehouse_site_id and sha256=v_job.sha256
  order by published_at desc limit 1;
  if v_existing is not null then
    update public.inventory_sync_jobs
    set state='NO_CHANGE',finished_at=now(),updated_at=now(),error_code='',error_message=''
    where id=p_job_id;
    delete from private.inventory_staging_items where job_id=p_job_id;
    insert into public.inventory_sync_audit(job_id,actor_id,action,detail)
    values(p_job_id,v_job.requested_by,'NO_CHANGE',jsonb_build_object('snapshot_id',v_existing));
    insert into public.sheet_export_queue(event_type,payload)
    values('INVENTORY_NO_CHANGE',jsonb_build_object(
      'job_id',p_job_id,'snapshot_id',v_existing,'warehouse_site_id',v_job.warehouse_site_id,
      'warehouse_code',v_job.warehouse_code,'source',v_job.source,'source_endpoint',v_job.source_endpoint,
      'source_captured_at',v_job.source_captured_at,'raw_row_count',v_job.raw_row_count,
      'normalized_row_count',v_job.normalized_row_count,'sha256',v_job.sha256,'state','NO_CHANGE'
    ));
    return jsonb_build_object('job_id',p_job_id,'state','NO_CHANGE','snapshot_id',v_existing);
  end if;

  update public.inventory_sync_jobs set state='PUBLISHING',updated_at=now() where id=p_job_id;
  insert into public.inventory_snapshots(
    job_id,warehouse_code,warehouse_site_id,source,source_endpoint,source_captured_at,requested_at,requested_by,
    credential_version,page_count,raw_row_count,normalized_row_count,sha256
  ) values(
    v_job.id,v_job.warehouse_code,v_job.warehouse_site_id,v_job.source,v_job.source_endpoint,v_job.source_captured_at,
    v_job.requested_at,v_job.requested_by,v_job.credential_version,v_job.page_count,v_job.raw_row_count,
    v_job.normalized_row_count,v_job.sha256
  ) returning id into v_snapshot;

  insert into public.inventory_snapshot_items(
    snapshot_id,sku,pickable_bin_qty,pickable_pending_out_qty,pickable_available_qty,other_stock_qty
  )
  select v_snapshot,sku,
    coalesce(sum(bin_qty) filter(where is_pickable),0),
    coalesce(sum(pending_out_qty) filter(where is_pickable),0),
    coalesce(sum(greatest(bin_qty-pending_out_qty,0)) filter(where is_pickable),0),
    coalesce(sum(bin_qty) filter(where not is_pickable),0)
  from private.inventory_staging_items where job_id=p_job_id group by sku;

  delete from public.inventory_current where warehouse_site_id=v_job.warehouse_site_id;
  insert into public.inventory_current(
    warehouse_site_id,sku,snapshot_id,snapshot_captured_at,pickable_bin_qty,pickable_pending_out_qty,pickable_available_qty,other_stock_qty
  )
  select v_job.warehouse_site_id,i.sku,v_snapshot,v_job.source_captured_at,
    i.pickable_bin_qty,i.pickable_pending_out_qty,i.pickable_available_qty,i.other_stock_qty
  from public.inventory_snapshot_items i where i.snapshot_id=v_snapshot;

  update public.inventory_sync_jobs
  set state='SUCCEEDED',finished_at=now(),updated_at=now(),error_code='',error_message=''
  where id=p_job_id;
  insert into public.inventory_sync_audit(job_id,actor_id,action,detail)
  values(p_job_id,v_job.requested_by,'PUBLISHED',jsonb_build_object('snapshot_id',v_snapshot,'sha256',v_job.sha256,'rows',v_count));
  insert into public.sheet_export_queue(event_type,payload)
  values('INVENTORY_SNAPSHOT',jsonb_build_object(
    'job_id',p_job_id,'snapshot_id',v_snapshot,'warehouse_site_id',v_job.warehouse_site_id,
    'warehouse_code',v_job.warehouse_code,'source',v_job.source,'source_endpoint',v_job.source_endpoint,
    'source_captured_at',v_job.source_captured_at,'page_count',v_job.page_count,
    'raw_row_count',v_job.raw_row_count,'normalized_row_count',v_job.normalized_row_count,
    'sha256',v_job.sha256,'schema_version','inventory.v1','state','SUCCEEDED'
  ));
  delete from private.inventory_staging_items where job_id=p_job_id;

  perform realtime.send(
    jsonb_build_object('snapshot_id',v_snapshot,'warehouse_site_id',v_job.warehouse_site_id,'captured_at',v_job.source_captured_at,'sha256',v_job.sha256),
    'snapshot_published','site:1291:inventory',true
  );
  return jsonb_build_object('job_id',p_job_id,'state','SUCCEEDED','snapshot_id',v_snapshot);
end $$;

revoke all on function public.finalize_inventory_snapshot(uuid) from public,anon,authenticated;
grant execute on function public.finalize_inventory_snapshot(uuid) to service_role;
