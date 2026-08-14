begin;

create or replace function public.active_role_rpc_internal()
returns public.user_role
language sql
stable
security definer
set search_path=''
as $$
  select role from public.profiles where id=auth.uid() and active=true
$$;

create or replace function public.issue_client_json_internal(p_issue public.issues, p_include_count boolean)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id',p_issue.id,
    'sku',p_issue.sku,
    'product_name',p_issue.product_name_snapshot,
    'status',p_issue.status,
    'report_count',case when p_include_count then p_issue.report_count else null end,
    'reported_at',p_issue.first_reported_at,
    'updated_at',p_issue.updated_at,
    'resolved_at',p_issue.resolved_at,
    'claimed_at',p_issue.claimed_at,
    'issue_version',p_issue.issue_version,
    'previous_issue_id',p_issue.previous_issue_id,
    'assigned_id',case when p_include_count then p_issue.claimed_by else null end,
    'assigned_name',case when p_include_count and p_issue.claimed_by is not null then (select full_name from public.profiles where id=p_issue.claimed_by) else null end
  ));
$$;

create or replace function public.issue_board_rpc(p_limit integer default 250)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare v_role public.user_role; v_limit integer:=greatest(1,least(coalesce(p_limit,250),500));
begin
  v_role:=public.active_role_rpc_internal();
  if v_role not in ('INVENT','ADMIN_INVENT','ADMIN') then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'open',coalesce((select jsonb_agg(public.issue_client_json_internal(x,true) order by x.first_reported_at) from (select * from public.issues where status='OPEN' order by first_reported_at limit v_limit)x),'[]'::jsonb),
    'claimed',coalesce((select jsonb_agg(public.issue_client_json_internal(x,true) order by x.first_reported_at) from (select * from public.issues where status in('CLAIMED','SEARCHING','REPLENISHING') order by first_reported_at limit v_limit)x),'[]'::jsonb),
    'recent',coalesce((select jsonb_agg(public.issue_client_json_internal(x,true) order by x.updated_at desc) from (select * from public.issues where status in('AVAILABLE','SKIP_ALLOWED') order by updated_at desc limit v_limit)x),'[]'::jsonb)
  );
end;
$$;

create or replace function public.my_issues_rpc(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare v_uid uuid:=auth.uid(); v_limit integer:=greatest(1,least(coalesce(p_limit,200),500));
begin
  if v_uid is null or not exists(select 1 from public.profiles where id=v_uid and active=true) then raise exception 'AUTH_REQUIRED'; end if;
  return coalesce((
    select jsonb_agg(public.issue_client_json_internal(i,false) order by i.updated_at desc)
    from public.issues i
    join (select issue_id,max(reported_at) last_report from public.issue_reports where reporter_id=v_uid group by issue_id order by max(reported_at) desc limit v_limit) r on r.issue_id=i.id
  ),'[]'::jsonb);
end;
$$;

create or replace function public.issue_detail_rpc(p_issue_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare v_uid uuid:=auth.uid(); v_role public.user_role; v_issue public.issues%rowtype; v_include boolean;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select role into v_role from public.profiles where id=v_uid and active=true;
  select * into v_issue from public.issues where id=p_issue_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  v_include:=v_role in ('INVENT','ADMIN_INVENT','ADMIN');
  if not v_include and not exists(select 1 from public.issue_reports where issue_id=p_issue_id and reporter_id=v_uid) then raise exception 'FORBIDDEN'; end if;
  return public.issue_client_json_internal(v_issue,v_include);
end;
$$;

create or replace function public.pending_alerts_rpc()
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare v_uid uuid:=auth.uid();
begin
  if v_uid is null or not exists(select 1 from public.profiles where id=v_uid and active=true) then raise exception 'AUTH_REQUIRED'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',n.id,'issue_id',n.issue_id,'issue_version',n.issue_version,'status',n.status,
      'title',n.title,'message',n.message,'critical',n.critical,'created_at',n.created_at,
      'sent_at',n.sent_at,'fcm_accepted_at',n.fcm_accepted_at,
      'issue',public.issue_client_json_internal(i,false)
    ) order by n.created_at)
    from public.notification_events n join public.issues i on i.id=n.issue_id
    where n.target_user_id=v_uid and n.critical=true and n.acknowledged_at is null
      and n.status in ('AVAILABLE','SKIP_ALLOWED') and n.expires_at>now()
      and i.status=n.status and i.issue_version=n.issue_version
  ),'[]'::jsonb);
end;
$$;

create or replace function public.mark_alert_received_rpc(p_event_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid();
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  update public.notification_events set client_received_at=coalesce(client_received_at,now()) where id=p_event_id and target_user_id=v_uid;
  return found;
end;$$;

create or replace function public.mark_alert_displayed_rpc(p_event_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid();
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  update public.notification_events set displayed_at=coalesce(displayed_at,now()) where id=p_event_id and target_user_id=v_uid;
  return found;
end;$$;

create or replace function public.ack_alert_rpc(p_event_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid(); v_event public.notification_events%rowtype; v_issue public.issues%rowtype;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_event from public.notification_events where id=p_event_id and target_user_id=v_uid for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into v_issue from public.issues where id=v_event.issue_id;
  if not found or v_issue.status<>v_event.status or v_issue.issue_version<>v_event.issue_version then raise exception 'STALE_ALERT'; end if;
  update public.notification_events set acknowledged_at=coalesce(acknowledged_at,now()) where id=p_event_id;
  return true;
end;$$;

create or replace function public.register_device_rpc(p_fcm_token text,p_platform text,p_device_name text,p_app_version text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid();
begin
  if v_uid is null or length(trim(coalesce(p_fcm_token,'')))<20 then raise exception 'INVALID_DEVICE'; end if;
  if not exists(select 1 from public.profiles where id=v_uid and active=true) then raise exception 'FORBIDDEN'; end if;
  insert into public.device_tokens(fcm_token,user_id,platform,device_name,app_version,active,last_seen_at)
  values(trim(p_fcm_token),v_uid,left(coalesce(p_platform,'android'),30),left(coalesce(p_device_name,''),200),left(coalesce(p_app_version,''),80),true,now())
  on conflict(fcm_token) do update set user_id=excluded.user_id,platform=excluded.platform,device_name=excluded.device_name,app_version=excluded.app_version,active=true,last_seen_at=now();
  return true;
end;$$;

create or replace function public.search_skus_rpc(p_query text,p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid(); v_q text:=lower(trim(coalesce(p_query,''))); v_limit integer:=greatest(1,least(coalesce(p_limit,20),50));
begin
  if v_uid is null or not exists(select 1 from public.profiles where id=v_uid and active=true) then raise exception 'AUTH_REQUIRED'; end if;
  if v_q='' then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('sku',s.sku,'product_name',s.product_name) order by case when lower(s.sku)=v_q then 0 when lower(s.sku) like v_q||'%' then 1 else 2 end,s.sku) from (select sku,product_name from public.sku_catalog where active=true and (lower(sku) like '%'||v_q||'%' or search_text like '%'||v_q||'%') limit v_limit)s),'[]'::jsonb);
end;$$;

revoke execute on function public.active_role_rpc_internal() from public,anon,authenticated;
revoke execute on function public.issue_client_json_internal(public.issues,boolean) from public,anon,authenticated;
revoke execute on function public.issue_board_rpc(integer) from public,anon;
revoke execute on function public.my_issues_rpc(integer) from public,anon;
revoke execute on function public.issue_detail_rpc(uuid) from public,anon;
revoke execute on function public.pending_alerts_rpc() from public,anon;
revoke execute on function public.mark_alert_received_rpc(uuid) from public,anon;
revoke execute on function public.mark_alert_displayed_rpc(uuid) from public,anon;
revoke execute on function public.ack_alert_rpc(uuid) from public,anon;
revoke execute on function public.register_device_rpc(text,text,text,text) from public,anon;
revoke execute on function public.search_skus_rpc(text,integer) from public,anon;
grant execute on function public.issue_board_rpc(integer),public.my_issues_rpc(integer),public.issue_detail_rpc(uuid),public.pending_alerts_rpc(),public.mark_alert_received_rpc(uuid),public.mark_alert_displayed_rpc(uuid),public.ack_alert_rpc(uuid),public.register_device_rpc(text,text,text,text),public.search_skus_rpc(text,integer) to authenticated;

commit;
