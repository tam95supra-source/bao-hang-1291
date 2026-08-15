begin;

create or replace function public.update_issue_rpc(p_issue_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid:=auth.uid();
  v_role public.user_role;
  v_action text:=upper(trim(p_action));
  v_result jsonb;
  v_status text;
  v_version bigint;
  v_sku text;
  v_message text;
  v_title text;
  v_inserted integer:=0;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select role into v_role from public.profiles where id=v_uid and active=true;
  if v_role not in ('ADMIN','ADMIN_INVENT','INVENT') then raise exception 'FORBIDDEN'; end if;
  if v_action='SKIP_ALLOWED' then v_action:='NOT_FOUND'; end if;
  if v_action not in ('AVAILABLE','NOT_FOUND') and not (v_action='CLOSE' and v_role='ADMIN') then raise exception 'INVALID_ACTION'; end if;

  v_result:=public.update_issue_atomic(p_issue_id,v_uid,v_action);
  v_status:=v_result->>'status';
  v_version:=coalesce((v_result->>'issue_version')::bigint,1);
  v_sku:=coalesce(v_result->>'sku','');

  if v_status in ('AVAILABLE','SKIP_ALLOWED') then
    update public.notification_events
      set acknowledged_at=coalesce(acknowledged_at,now())
      where issue_id=p_issue_id and critical=true and acknowledged_at is null
        and (issue_version<>v_version or status::text<>v_status);

    v_title:=case when v_status='AVAILABLE' then 'ĐÃ CÓ HÀNG • SKU '||v_sku else 'CHO PHÉP SKIP • SKU '||v_sku end;
    v_message:=case when v_status='AVAILABLE'
      then 'SKU '||v_sku||' đã được bổ sung hàng. Vui lòng quay lại vị trí lấy hàng và tiếp tục thao tác.'
      else 'Không tìm thấy hàng để bổ sung cho SKU '||v_sku||'. Bạn được phép SKIP SKU này và tiếp tục công việc.' end;

    insert into public.notification_events(issue_id,target_user_id,status,issue_version,title,message,critical,expires_at)
    select p_issue_id,r.reporter_id,v_status::public.issue_status,v_version,v_title,v_message,true,now()+interval '24 hours'
    from (select distinct reporter_id from public.issue_reports where issue_id=p_issue_id) r
    on conflict (target_user_id,issue_id,issue_version,status)
      where critical=true and issue_id is not null do nothing;
    get diagnostics v_inserted=row_count;

    if v_inserted>0 then
      perform net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name='bao_hang_1291_project_url') || '/functions/v1/notification-worker/run',
        headers := jsonb_build_object(
          'content-type','application/json',
          'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='bao_hang_1291_cron_secret')
        ),
        body := jsonb_build_object('issue_id',p_issue_id,'issue_version',v_version,'status',v_status),
        timeout_milliseconds := 15000
      );
    end if;
  end if;
  return v_result;
end;
$$;

revoke execute on function public.update_issue_rpc(uuid,text) from public,anon;
grant execute on function public.update_issue_rpc(uuid,text) to authenticated;

commit;
