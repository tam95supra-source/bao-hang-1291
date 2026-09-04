-- BÁO HÀNG 1291 — workflow V3: no receive/claim stage, three timers, report pagination.
-- Approved 2026-09-04. No secret material.

DO $cleanup$
BEGIN
  DELETE FROM public.issue_audit WHERE upper(action) IN ('CLAIM','REASSIGN','REASSIGN_ISSUE','CLAIM_ISSUE');
  DELETE FROM public.mutation_requests WHERE upper(action) IN ('CLAIM','REASSIGN','REASSIGN_ISSUE','CLAIM_ISSUE');
  DELETE FROM public.authority_events WHERE upper(event_type) IN ('CLAIM','REASSIGN','REASSIGN_ISSUE','CLAIM_ISSUE');
  DELETE FROM public.sheet_export_queue WHERE upper(coalesce(payload->>'action','')) IN ('CLAIM','REASSIGN','REASSIGN_ISSUE','CLAIM_ISSUE');
  UPDATE public.issues SET claimed_by=NULL, claimed_at=NULL WHERE claimed_by IS NOT NULL OR claimed_at IS NOT NULL;
END
$cleanup$;

CREATE OR REPLACE FUNCTION public.api_get_operational_config_rpc(p_test_role text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
BEGIN
  PERFORM public.require_role_rpc(p_test_role, ARRAY['ADMIN','ADMIN_INVENT']::public.user_role[]);
  RETURN (SELECT jsonb_build_object(
    'inventory_reminder_minutes',reminder_minutes,
    'picker_ack_reminder_minutes',picker_ack_reminder_minutes,
    'auto_skip_enabled',auto_skip_enabled,
    'auto_skip_after_minutes',auto_skip_after_minutes,
    'acknowledge_minutes',reminder_minutes,
    'reminder_minutes',reminder_minutes,
    'replenish_minutes',reminder_minutes,
    'found_item_reminder_minutes',picker_ack_reminder_minutes
  ) FROM public.app_config WHERE singleton=true);
END
$function$;

CREATE OR REPLACE FUNCTION public.api_save_operational_config_rpc(
  p_acknowledge_minutes integer,p_reminder_minutes integer,p_replenish_minutes integer,
  p_picker_ack_reminder_minutes integer DEFAULT 3,p_auto_skip_enabled boolean DEFAULT false,
  p_auto_skip_after_minutes integer DEFAULT 120,p_test_role text DEFAULT NULL::text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
  v_inventory integer:=greatest(1,least(480,coalesce(p_reminder_minutes,p_acknowledge_minutes,p_replenish_minutes,5)));
  v_picker integer:=greatest(1,least(60,coalesce(p_picker_ack_reminder_minutes,3)));
BEGIN
  PERFORM public.require_role_rpc(p_test_role,ARRAY['ADMIN','ADMIN_INVENT']::public.user_role[]);
  UPDATE public.app_config SET
    acknowledge_minutes=v_inventory,reminder_minutes=v_inventory,replenish_minutes=v_inventory,
    picker_ack_reminder_minutes=v_picker,found_item_reminder_minutes=v_picker,
    auto_skip_enabled=coalesce(p_auto_skip_enabled,false),auto_skip_after_minutes=p_auto_skip_after_minutes,
    updated_by=public.app_uid(),updated_at=now()
  WHERE singleton=true;
  RETURN public.api_get_operational_config_rpc(p_test_role);
END
$function$;

CREATE OR REPLACE FUNCTION public.api_save_operational_config_rpc(
  p_acknowledge_minutes integer,p_reminder_minutes integer,p_replenish_minutes integer,
  p_picker_ack_reminder_minutes integer,p_found_item_reminder_minutes integer,
  p_auto_skip_enabled boolean,p_auto_skip_after_minutes integer,p_test_role text DEFAULT NULL::text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
  v_inventory integer:=greatest(1,least(480,coalesce(p_reminder_minutes,p_acknowledge_minutes,p_replenish_minutes,5)));
  v_picker integer:=greatest(1,least(60,coalesce(p_picker_ack_reminder_minutes,p_found_item_reminder_minutes,3)));
BEGIN
  PERFORM public.require_role_rpc(p_test_role,ARRAY['ADMIN','ADMIN_INVENT']::public.user_role[]);
  UPDATE public.app_config SET
    acknowledge_minutes=v_inventory,reminder_minutes=v_inventory,replenish_minutes=v_inventory,
    picker_ack_reminder_minutes=v_picker,found_item_reminder_minutes=v_picker,
    auto_skip_enabled=coalesce(p_auto_skip_enabled,false),auto_skip_after_minutes=p_auto_skip_after_minutes,
    updated_by=public.app_uid(),updated_at=now()
  WHERE singleton=true;
  RETURN public.api_get_operational_config_rpc(p_test_role);
END
$function$;

CREATE OR REPLACE FUNCTION public.api_claim_issue_rpc(p_issue_id uuid,p_client_request_id uuid DEFAULT gen_random_uuid(),p_test_role text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
BEGIN
  PERFORM public.require_role_rpc(p_test_role,ARRAY['ADMIN','ADMIN_INVENT','INVENT']::public.user_role[]);
  RAISE EXCEPTION 'RECEIVE_FLOW_REMOVED';
END
$function$;

CREATE OR REPLACE FUNCTION public.api_reassign_issue_rpc(p_issue_id uuid,p_new_assignee_id uuid,p_reason text,p_client_request_id uuid DEFAULT gen_random_uuid(),p_test_role text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
BEGIN
  PERFORM public.require_role_rpc(p_test_role,ARRAY['ADMIN','ADMIN_INVENT']::public.user_role[]);
  RAISE EXCEPTION 'RECEIVE_FLOW_REMOVED';
END
$function$;

CREATE OR REPLACE FUNCTION public.update_issue_atomic(p_issue_id uuid,p_actor uuid,p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE v_issue public.issues%rowtype; v_old public.issue_status; v_role public.user_role; v_action text:=upper(trim(p_action)); v_changed boolean:=false;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id=p_actor AND active=true;
  IF v_role NOT IN ('ADMIN','ADMIN_INVENT','INVENT') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO v_issue FROM public.issues WHERE id=p_issue_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ISSUE_NOT_FOUND'; END IF;
  v_old:=v_issue.status;
  IF v_action='CLAIM' THEN RAISE EXCEPTION 'RECEIVE_FLOW_REMOVED'; END IF;
  IF v_action='SKIP_ALLOWED' THEN v_action:='NOT_FOUND'; END IF;
  IF v_action IN ('AVAILABLE','NOT_FOUND') THEN
    IF v_action='AVAILABLE' AND v_issue.status='AVAILABLE' THEN RETURN public.issue_json(v_issue); END IF;
    IF v_action='NOT_FOUND' AND v_issue.status='SKIP_ALLOWED' THEN RETURN public.issue_json(v_issue); END IF;
    IF v_action='NOT_FOUND' AND v_issue.status NOT IN ('OPEN','CLAIMED','SEARCHING','REPLENISHING') THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
    IF v_action='AVAILABLE' AND v_issue.status NOT IN ('OPEN','CLAIMED','SEARCHING','REPLENISHING','SKIP_ALLOWED') THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
    UPDATE public.issues SET
      status=CASE WHEN v_action='AVAILABLE' THEN 'AVAILABLE'::public.issue_status ELSE 'SKIP_ALLOWED'::public.issue_status END,
      claimed_by=NULL,claimed_at=NULL,resolved_at=now(),issue_version=issue_version+1,updated_at=now()
    WHERE id=p_issue_id RETURNING * INTO v_issue;
    v_changed:=true;
  ELSIF v_action='CLOSE' AND v_role='ADMIN' THEN
    UPDATE public.issues SET status='CLOSED',claimed_by=NULL,claimed_at=NULL,resolved_at=coalesce(resolved_at,now()),issue_version=issue_version+1,updated_at=now()
    WHERE id=p_issue_id AND status<>'CLOSED' RETURNING * INTO v_issue;
    v_changed:=FOUND;
  ELSE RAISE EXCEPTION 'INVALID_ACTION'; END IF;
  IF v_changed THEN
    INSERT INTO public.issue_audit(issue_id,actor_id,action,from_status,to_status,detail)
    VALUES(v_issue.id,p_actor,v_action,v_old,v_issue.status,jsonb_build_object('issue_version',v_issue.issue_version));
    INSERT INTO public.sheet_export_queue(event_type,payload)
    VALUES('ISSUE_STATUS',public.issue_json(v_issue)||jsonb_build_object('actor_id',p_actor,'action',v_action));
  END IF;
  RETURN public.issue_json(v_issue);
END
$function$;

CREATE OR REPLACE FUNCTION public.update_issue_atomic(p_issue_id uuid,p_actor uuid,p_action text,p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE v_issue public.issues%rowtype; v_old public.issue_status; v_role public.user_role; v_action text:=upper(trim(p_action)); v_changed boolean:=false; v_payload jsonb;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id=p_actor AND active=true;
  IF v_role NOT IN ('ADMIN','ADMIN_INVENT','INVENT') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO v_issue FROM public.issues WHERE id=p_issue_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ISSUE_NOT_FOUND'; END IF;
  v_old:=v_issue.status;
  IF v_action='CLAIM' THEN RAISE EXCEPTION 'RECEIVE_FLOW_REMOVED'; END IF;
  IF v_action='SKIP_ALLOWED' THEN v_action:='NOT_FOUND'; END IF;
  IF v_action IN ('AVAILABLE','NOT_FOUND') THEN
    IF v_action='AVAILABLE' AND v_issue.status='AVAILABLE' THEN RETURN public.issue_json(v_issue); END IF;
    IF v_action='NOT_FOUND' AND v_issue.status='SKIP_ALLOWED' THEN RETURN public.issue_json(v_issue); END IF;
    IF v_action='NOT_FOUND' AND v_issue.status NOT IN ('OPEN','CLAIMED','SEARCHING','REPLENISHING') THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
    IF v_action='AVAILABLE' AND v_issue.status NOT IN ('OPEN','CLAIMED','SEARCHING','REPLENISHING','SKIP_ALLOWED') THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
    UPDATE public.issues SET
      status=CASE WHEN v_action='AVAILABLE' THEN 'AVAILABLE'::public.issue_status ELSE 'SKIP_ALLOWED'::public.issue_status END,
      claimed_by=NULL,claimed_at=NULL,resolved_at=now(),issue_version=issue_version+1,updated_at=now()
    WHERE id=p_issue_id RETURNING * INTO v_issue;
    v_changed:=true;
  ELSIF v_action='CLOSE' AND v_role='ADMIN' THEN
    UPDATE public.issues SET status='CLOSED',claimed_by=NULL,claimed_at=NULL,resolved_at=coalesce(resolved_at,now()),issue_version=issue_version+1,updated_at=now()
    WHERE id=p_issue_id AND status<>'CLOSED' RETURNING * INTO v_issue;
    v_changed:=FOUND;
  ELSE RAISE EXCEPTION 'INVALID_ACTION'; END IF;
  IF v_changed THEN
    INSERT INTO public.issue_audit(issue_id,actor_id,action,from_status,to_status,detail)
    VALUES(v_issue.id,p_actor,v_action,v_old,v_issue.status,jsonb_build_object('issue_version',v_issue.issue_version,'client_request_id',p_event_id));
    v_payload:=public.issue_json(v_issue)||jsonb_build_object('actor_id',p_actor,'action',v_action,'client_request_id',p_event_id);
    INSERT INTO public.sheet_export_queue(event_id,event_type,payload,actor_account_id,issue_id,sku,issue_version)
    VALUES(p_event_id,'ISSUE_STATUS',v_payload,p_actor,v_issue.id,v_issue.sku,v_issue.issue_version);
    INSERT INTO public.authority_events(event_id,source_mode,event_type,actor_account_id,actor_role,issue_id,sku,issue_version,payload_json,payload_sha256,service_ack_at,reconciliation_status)
    VALUES(p_event_id,'SERVICE',v_action,p_actor,v_role::text,v_issue.id,v_issue.sku,v_issue.issue_version,v_payload,
      encode(public.digest(convert_to(v_payload::text,'UTF8'),'sha256'),'hex'),now(),'PENDING')
    ON CONFLICT(event_id) DO NOTHING;
  END IF;
  RETURN public.issue_json(v_issue);
END
$function$;

CREATE OR REPLACE FUNCTION public.api_update_issue_rpc(p_issue_id uuid,p_action text,p_test_role text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE v_action text:=upper(trim(p_action)); r jsonb;
BEGIN
  PERFORM public.require_role_rpc(p_test_role,ARRAY['ADMIN','ADMIN_INVENT','INVENT']::public.user_role[]);
  IF v_action='SKIP_ALLOWED' THEN v_action:='NOT_FOUND'; END IF;
  r:=public.update_issue_rpc(p_issue_id,v_action);
  RETURN jsonb_build_object('issue',r);
END
$function$;

CREATE OR REPLACE FUNCTION public.api_update_issue_rpc(p_issue_id uuid,p_action text,p_client_request_id uuid DEFAULT gen_random_uuid(),p_test_role text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE v_action text:=upper(trim(p_action)); r jsonb;
BEGIN
  PERFORM public.require_role_rpc(p_test_role,ARRAY['ADMIN','ADMIN_INVENT','INVENT']::public.user_role[]);
  IF v_action='SKIP_ALLOWED' THEN v_action:='NOT_FOUND'; END IF;
  r:=public.update_issue_rpc(p_issue_id,v_action,p_client_request_id);
  RETURN jsonb_build_object('issue',r);
END
$function$;

CREATE OR REPLACE FUNCTION public.restore_skipped_issue_available(p_issue_id uuid,p_actor uuid,p_reason text DEFAULT ''::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE v_issue public.issues%rowtype; v_role public.user_role; v_skip_action text; v_reason text:=left(trim(coalesce(p_reason,'')),500);
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id=p_actor AND active=true;
  IF v_role NOT IN ('ADMIN','ADMIN_INVENT','INVENT') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO v_issue FROM public.issues WHERE id=p_issue_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ISSUE_NOT_FOUND'; END IF;
  IF v_issue.status<>'SKIP_ALLOWED' THEN RAISE EXCEPTION 'ISSUE_NOT_SKIPPED'; END IF;
  SELECT action INTO v_skip_action FROM public.issue_audit WHERE issue_id=p_issue_id AND action IN ('AUTO_SKIP','NOT_FOUND') ORDER BY created_at DESC LIMIT 1;
  UPDATE public.issues SET status='AVAILABLE',claimed_by=NULL,claimed_at=NULL,resolved_at=now(),issue_version=issue_version+1,updated_at=now()
  WHERE id=p_issue_id RETURNING * INTO v_issue;
  INSERT INTO public.issue_audit(issue_id,actor_id,action,from_status,to_status,detail)
  VALUES(v_issue.id,p_actor,'RESTORE_AVAILABLE','SKIP_ALLOWED','AVAILABLE',jsonb_build_object('reason',v_reason,'reversed_skip_action',coalesce(v_skip_action,'UNKNOWN'),'issue_version',v_issue.issue_version));
  INSERT INTO public.sheet_export_queue(event_type,payload)
  VALUES('ISSUE_STATUS',public.issue_json(v_issue)||jsonb_build_object('actor_id',p_actor,'action','RESTORE_AVAILABLE','reason',v_reason,'reversed_skip_action',coalesce(v_skip_action,'UNKNOWN')));
  RETURN public.issue_json(v_issue)||jsonb_build_object('restored_from_skip',true,'restore_reason',v_reason,'reversed_skip_action',coalesce(v_skip_action,'UNKNOWN'));
END
$function$;

CREATE OR REPLACE FUNCTION public.api_restore_skipped_issue_rpc(p_issue_id uuid,p_reason text DEFAULT ''::text,p_test_role text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE v_issue jsonb; v_version bigint; v_sku text; v_reminder integer;
BEGIN
  PERFORM public.require_role_rpc(p_test_role,ARRAY['ADMIN','ADMIN_INVENT','INVENT']::public.user_role[]);
  v_issue:=public.restore_skipped_issue_available(p_issue_id,public.app_uid(),p_reason);
  v_version:=coalesce((v_issue->>'issue_version')::bigint,1); v_sku:=coalesce(v_issue->>'sku','');
  SELECT greatest(1,picker_ack_reminder_minutes) INTO v_reminder FROM public.app_config WHERE singleton=true;
  UPDATE public.notification_events SET acknowledged_at=coalesce(acknowledged_at,now())
  WHERE issue_id=p_issue_id AND critical=true AND acknowledged_at IS NULL AND (issue_version<>v_version OR status::text<>'AVAILABLE');
  INSERT INTO public.notification_events(issue_id,target_user_id,status,issue_version,title,message,critical,expires_at,reminder_interval_minutes)
  SELECT p_issue_id,r.reporter_id,'AVAILABLE',v_version,'ĐÃ CÓ HÀNG • SKU '||v_sku,
    'SKU '||v_sku||' hiện đã có hàng. Vui lòng quay lại lấy hàng.',true,now()+interval '24 hours',v_reminder
  FROM (SELECT DISTINCT reporter_id FROM public.issue_reports WHERE issue_id=p_issue_id) r
  ON CONFLICT(target_user_id,issue_id,issue_version,status) WHERE critical=true AND issue_id IS NOT NULL DO NOTHING;
  RETURN jsonb_build_object('issue',v_issue,'picker_reminder_minutes',v_reminder);
END
$function$;

CREATE OR REPLACE FUNCTION public.issue_api_json(p_issue public.issues,p_include_count boolean DEFAULT true)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
SELECT public.issue_client_json_internal(p_issue,p_include_count) || jsonb_build_object(
  'latest_reporter_name',coalesce((SELECT p.full_name FROM public.issue_reports r JOIN public.profiles p ON p.id=r.reporter_id WHERE r.issue_id=p_issue.id ORDER BY r.reported_at DESC LIMIT 1),''),
  'handled_by_name',coalesce((SELECT CASE WHEN upper(a.action)='AUTO_SKIP' THEN 'Đã quá hạn Inventory xử lí' ELSE coalesce(p.full_name,'') END FROM public.issue_audit a LEFT JOIN public.profiles p ON p.id=a.actor_id WHERE a.issue_id=p_issue.id AND upper(a.action) IN ('AVAILABLE','NOT_FOUND','RESTORE_AVAILABLE','RESTORE_SKIPPED','AUTO_SKIP') ORDER BY a.created_at DESC LIMIT 1),''),
  'latest_message',coalesce((SELECT CASE WHEN upper(a.action)='AUTO_SKIP' THEN coalesce(a.detail->>'note','') ELSE coalesce(a.detail->>'reason','') END FROM public.issue_audit a WHERE a.issue_id=p_issue.id AND upper(a.action) IN ('AVAILABLE','NOT_FOUND','RESTORE_AVAILABLE','RESTORE_SKIPPED','AUTO_SKIP') ORDER BY a.created_at DESC LIMIT 1),'')
)
$function$;

CREATE OR REPLACE FUNCTION public.api_issue_board_rpc(p_test_role text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE tz text:='Asia/Bangkok'; day_start timestamptz; day_end timestamptz; active jsonb; recent jsonb; available_count int; skipped_count int; active_count int; v_realtime_seq bigint; cfg public.app_config%rowtype;
BEGIN
  PERFORM public.require_role_rpc(p_test_role,ARRAY['ADMIN','ADMIN_INVENT','INVENT']::public.user_role[]);
  SELECT * INTO cfg FROM public.app_config WHERE singleton=true;
  day_start:=(date_trunc('day',now() at time zone tz) at time zone tz); day_end:=day_start+interval '1 day';
  SELECT coalesce(jsonb_agg(public.issue_api_json(i,true) ORDER BY i.first_reported_at),'[]'::jsonb),count(*) INTO active,active_count
  FROM public.issues i WHERE i.status IN ('OPEN','CLAIMED','SEARCHING','REPLENISHING');
  SELECT coalesce(jsonb_agg(public.issue_api_json(i,true) ORDER BY i.resolved_at DESC),'[]'::jsonb) INTO recent
  FROM public.issues i WHERE i.status IN ('AVAILABLE','SKIP_ALLOWED') AND i.resolved_at>=day_start AND i.resolved_at<day_end;
  SELECT count(*) INTO available_count FROM public.issues WHERE status='AVAILABLE' AND resolved_at>=day_start AND resolved_at<day_end;
  SELECT count(*) INTO skipped_count FROM public.issues WHERE status='SKIP_ALLOWED' AND resolved_at>=day_start AND resolved_at<day_end;
  SELECT coalesce(max(id),0) INTO v_realtime_seq FROM public.realtime_events WHERE topic='issues';
  RETURN jsonb_build_object(
    'open','[]'::jsonb,'claimed',active,'recent',recent,
    'skipped',coalesce((SELECT jsonb_agg(x) FROM jsonb_array_elements(recent)x WHERE x->>'status'='SKIP_ALLOWED'),'[]'::jsonb),
    'available',coalesce((SELECT jsonb_agg(x) FROM jsonb_array_elements(recent)x WHERE x->>'status'='AVAILABLE'),'[]'::jsonb),
    'counts',jsonb_build_object('open',0,'claimed',active_count,'available',available_count,'skipped',skipped_count),
    'scope',jsonb_build_object('active','CURRENT','resolved','TODAY','day_start',day_start,'day_end',day_end,
      'inventory_reminder_minutes',cfg.reminder_minutes,'auto_skip_enabled',cfg.auto_skip_enabled,'auto_skip_after_minutes',cfg.auto_skip_after_minutes),
    'realtime_seq',v_realtime_seq
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.api_issue_delta_rpc(p_after_seq bigint DEFAULT 0,p_limit integer DEFAULT 200,p_test_role text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE v_limit integer:=least(500,greatest(1,coalesce(p_limit,200))); v_after bigint:=greatest(0,coalesce(p_after_seq,0)); v_min_seq bigint; v_server_seq bigint; v_latest_seq bigint; v_events jsonb; v_has_more boolean:=false; v_requires_full boolean:=false; v_day_start timestamptz:=(date_trunc('day',now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok'); v_day_end timestamptz:=v_day_start+interval '1 day';
BEGIN
  PERFORM public.require_role_rpc(p_test_role,ARRAY['ADMIN','ADMIN_INVENT','INVENT']::public.user_role[]);
  SELECT min(id),coalesce(max(id),0) INTO v_min_seq,v_server_seq FROM public.realtime_events WHERE topic='issues';
  v_requires_full:=v_after>0 AND v_min_seq IS NOT NULL AND v_after<v_min_seq;
  WITH raw AS (SELECT r.id,r.entity_id,r.entity_version FROM public.realtime_events r WHERE r.topic='issues' AND r.id>v_after ORDER BY r.id LIMIT v_limit),
  latest AS (SELECT DISTINCT ON(entity_id) id,entity_id,entity_version FROM raw ORDER BY entity_id,id DESC),
  enriched AS (
    SELECT l.id seq,l.entity_id,l.entity_version,i.*,
      ((i.status IN ('OPEN','CLAIMED','SEARCHING','REPLENISHING')) OR (i.status IN ('AVAILABLE','SKIP_ALLOWED') AND i.resolved_at>=v_day_start AND i.resolved_at<v_day_end)) visible,
      EXISTS(SELECT 1 FROM public.issue_audit a WHERE a.issue_id=i.id AND upper(a.action)='WITHDRAW_SHORTAGE' AND coalesce((a.detail->>'issue_version')::bigint,0)=coalesce(l.entity_version,0)) withdrawn_changed
    FROM latest l LEFT JOIN public.issues i ON i.id::text=l.entity_id)
  SELECT coalesce(jsonb_agg(jsonb_build_object('seq',e.seq,'entity_id',e.entity_id,'entity_version',e.entity_version,'visible',coalesce(e.visible,false),'withdrawn_changed',coalesce(e.withdrawn_changed,false),'issue',CASE WHEN coalesce(e.visible,false) THEN public.issue_api_json(e,true) ELSE NULL END) ORDER BY e.seq),'[]'::jsonb),coalesce((SELECT max(id) FROM raw),v_after)
  INTO v_events,v_latest_seq FROM enriched e;
  v_has_more:=v_latest_seq<v_server_seq;
  RETURN jsonb_build_object('events',v_events,'latest_seq',v_latest_seq,'server_seq',v_server_seq,'has_more',v_has_more,'requires_full_reconcile',v_requires_full);
END
$function$;

CREATE OR REPLACE FUNCTION public.process_sla()
RETURNS TABLE(issue_id uuid,event_status public.issue_status,event_kind text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE cfg public.app_config%rowtype; item public.issues%rowtype; changed public.issues%rowtype; deadline_at timestamptz; note_text text;
BEGIN
  SELECT * INTO cfg FROM public.app_config WHERE singleton=true;
  FOR item IN SELECT * FROM public.issues WHERE status IN ('OPEN','CLAIMED','SEARCHING','REPLENISHING') FOR UPDATE SKIP LOCKED LOOP
    deadline_at:=item.first_reported_at+make_interval(mins=>cfg.auto_skip_after_minutes);
    IF cfg.auto_skip_enabled AND now()>=deadline_at THEN
      note_text:='Đã quá hạn Inventory xử lí lúc '||to_char(deadline_at AT TIME ZONE 'Asia/Bangkok','HH24:MI:SS');
      UPDATE public.issues SET status='SKIP_ALLOWED',claimed_by=NULL,claimed_at=NULL,resolved_at=now(),issue_version=issue_version+1,updated_at=now()
      WHERE id=item.id RETURNING * INTO changed;
      INSERT INTO public.issue_audit(issue_id,actor_id,action,from_status,to_status,detail)
      VALUES(changed.id,NULL,'AUTO_SKIP',item.status,'SKIP_ALLOWED',jsonb_build_object('auto_skip_after_minutes',cfg.auto_skip_after_minutes,'deadline_at',deadline_at,'note',note_text,'actor_label','Đã quá hạn Inventory xử lí','issue_version',changed.issue_version));
      INSERT INTO public.sheet_export_queue(event_type,payload)
      VALUES('ISSUE_STATUS',public.issue_json(changed)||jsonb_build_object('actor_id',NULL,'actor_name','Đã quá hạn Inventory xử lí','action','AUTO_SKIP','auto_skip_after_minutes',cfg.auto_skip_after_minutes,'deadline_at',deadline_at,'note',note_text));
      UPDATE public.notification_events SET acknowledged_at=coalesce(acknowledged_at,now())
      WHERE issue_id=changed.id AND critical=true AND acknowledged_at IS NULL AND (issue_version<>changed.issue_version OR status::text<>'SKIP_ALLOWED');
      INSERT INTO public.notification_events(issue_id,target_user_id,status,issue_version,title,message,critical,expires_at,reminder_interval_minutes)
      SELECT changed.id,r.reporter_id,'SKIP_ALLOWED',changed.issue_version,'ĐƯỢC PHÉP BỎ QUA • SKU '||changed.sku,
        'SKU '||changed.sku||' đã quá hạn Inventory xử lí. Bạn được phép bỏ qua SKU này và tiếp tục công việc.',true,now()+interval '24 hours',greatest(1,cfg.picker_ack_reminder_minutes)
      FROM (SELECT DISTINCT reporter_id FROM public.issue_reports WHERE issue_id=changed.id) r
      ON CONFLICT(target_user_id,issue_id,issue_version,status) WHERE critical=true AND issue_id IS NOT NULL DO NOTHING;
      issue_id:=changed.id; event_status:=changed.status; event_kind:='AUTO_SKIP'; RETURN NEXT; CONTINUE;
    END IF;
    IF now()>=item.first_reported_at+make_interval(mins=>cfg.reminder_minutes)
       AND (item.last_reminded_at IS NULL OR now()>=item.last_reminded_at+make_interval(mins=>cfg.reminder_minutes)) THEN
      UPDATE public.issues SET last_reminded_at=now(),updated_at=now() WHERE id=item.id;
      issue_id:=item.id; event_status:=item.status; event_kind:='INVENTORY_REMINDER'; RETURN NEXT;
    END IF;
  END LOOP;
END
$function$;

CREATE OR REPLACE FUNCTION public.worker_tick_rpc()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE r record; i public.issues%rowtype; cfg public.app_config%rowtype; n integer:=0; a integer:=0; auto_skipped integer:=0;
BEGIN
  PERFORM public.worker_require_admin(); SELECT * INTO cfg FROM public.app_config WHERE singleton=true;
  FOR r IN SELECT * FROM public.process_sla() LOOP
    IF r.event_kind='AUTO_SKIP' THEN auto_skipped:=auto_skipped+1; CONTINUE; END IF;
    SELECT * INTO i FROM public.issues WHERE id=r.issue_id;
    IF FOUND THEN
      UPDATE public.notification_events e SET acknowledged_at=coalesce(e.acknowledged_at,now())
      WHERE e.issue_id=i.id AND e.critical=false AND e.acknowledged_at IS NULL
        AND e.target_user_id IN (SELECT p.id FROM public.profiles p WHERE p.active=true AND p.role IN ('ADMIN_INVENT','INVENT'));
      INSERT INTO public.notification_events(issue_id,target_user_id,status,issue_version,title,message,critical,expires_at)
      SELECT i.id,p.id,i.status,i.issue_version,'NHẮC XỬ LÝ • SKU '||i.sku,
        'SKU '||i.sku||' chưa được xử lí sau '||cfg.reminder_minutes||' phút kể từ khi báo thiếu.',false,now()+interval '24 hours'
      FROM public.profiles p WHERE p.active=true AND p.role IN ('ADMIN_INVENT','INVENT');
      GET DIAGNOSTICS a=ROW_COUNT; n:=n+a;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('inventory_notifications_queued',n,'inventory_reminder_minutes',cfg.reminder_minutes,
    'auto_skip_enabled',cfg.auto_skip_enabled,'auto_skipped',auto_skipped,'checked_at',now());
END
$function$;

CREATE OR REPLACE FUNCTION public.api_admin_summary_rpc(p_test_role text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE sr jsonb; active_count bigint;
BEGIN
  PERFORM public.require_role_rpc(p_test_role,ARRAY['ADMIN','ADMIN_INVENT']::public.user_role[]);
  SELECT to_jsonb(x) INTO sr FROM (SELECT status,finished_at,eligible_rows,failed_count FROM public.staff_sync_runs ORDER BY started_at DESC LIMIT 1)x;
  SELECT count(*) INTO active_count FROM public.issues WHERE status IN ('OPEN','CLAIMED','SEARCHING','REPLENISHING');
  RETURN jsonb_build_object('sku_count',(SELECT count(*) FROM public.sku_catalog WHERE active),'profile_count',(SELECT count(*) FROM public.profiles),
    'active_user_count',(SELECT count(*) FROM public.profiles WHERE active),'open_issue_count',active_count,'claimed_issue_count',0,'active_issue_count',active_count,
    'pending_sheet_count',(SELECT count(*) FROM public.sheet_export_queue WHERE exported_at IS NULL),'diagnostic_log_count',(SELECT count(*) FROM public.diagnostic_logs),'staff_sync',sr);
END
$function$;

CREATE OR REPLACE FUNCTION public.api_reports_summary_v2_rpc(p_from timestamptz DEFAULT NULL,p_to timestamptz DEFAULT NULL,p_test_role text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE cfg public.app_config%rowtype; v_from timestamptz:=coalesce(p_from,now()-interval '30 days'); v_to timestamptz:=coalesce(p_to,now()); result jsonb;
BEGIN
  PERFORM public.require_role_rpc(p_test_role,ARRAY['ADMIN','ADMIN_INVENT']::public.user_role[]); SELECT * INTO cfg FROM public.app_config WHERE singleton=true;
  IF v_to<=v_from THEN RAISE EXCEPTION 'INVALID_REPORT_RANGE'; END IF;
  WITH r AS (SELECT * FROM public.issues WHERE first_reported_at>=v_from AND first_reported_at<v_to),
  d AS (SELECT extract(epoch FROM(resolved_at-first_reported_at))/60.0 v FROM r WHERE resolved_at IS NOT NULL),
  s AS (SELECT status::text status,count(*) n FROM r GROUP BY status),
  top AS (SELECT i.sku,max(sc.product_name) product_name,sum(i.report_count)::bigint reports FROM r i LEFT JOIN public.sku_catalog sc ON sc.sku=i.sku GROUP BY i.sku ORDER BY sum(i.report_count) DESC,i.sku LIMIT 20),
  autos AS (SELECT i.sku,max(sc.product_name) product_name,count(*)::bigint n FROM r i JOIN public.issue_audit a ON a.issue_id=i.id AND a.action='AUTO_SKIP' LEFT JOIN public.sku_catalog sc ON sc.sku=i.sku GROUP BY i.sku ORDER BY count(*) DESC,i.sku LIMIT 20),
  daily AS (SELECT (i.first_reported_at AT TIME ZONE 'Asia/Bangkok')::date day_key,sum(i.report_count)::bigint reports,count(*)::bigint issues FROM r i GROUP BY 1 ORDER BY 1),
  hourly AS (SELECT h,coalesce(sum(i.report_count),0)::bigint reports FROM generate_series(0,23) h LEFT JOIN public.issues i ON i.first_reported_at>=now()-interval '24 hours' AND extract(hour FROM i.first_reported_at AT TIME ZONE 'Asia/Bangkok')=h GROUP BY h ORDER BY h),
  picker AS (SELECT e.* FROM public.notification_events e WHERE e.critical=true AND e.status IN ('AVAILABLE','SKIP_ALLOWED') AND e.created_at>=v_from AND e.created_at<v_to)
  SELECT jsonb_build_object(
    'from',v_from,'to',v_to,'issues',(SELECT count(*) FROM r),'reports',coalesce((SELECT sum(report_count) FROM r),0),
    'available',(SELECT count(*) FROM r WHERE status='AVAILABLE'),'skipped',(SELECT count(*) FROM r WHERE status='SKIP_ALLOWED'),
    'withdrawn',(SELECT count(DISTINCT a.issue_id) FROM public.issue_audit a JOIN r i ON i.id=a.issue_id WHERE a.action='WITHDRAW_SHORTAGE'),
    'resolved',(SELECT count(*) FROM r WHERE resolved_at IS NOT NULL),'active_now',(SELECT count(*) FROM public.issues WHERE status IN ('OPEN','CLAIMED','SEARCHING','REPLENISHING')),
    'inventory_overdue_now',(SELECT count(*) FROM public.issues WHERE status IN ('OPEN','CLAIMED','SEARCHING','REPLENISHING') AND now()>=first_reported_at+make_interval(mins=>cfg.reminder_minutes)),
    'inventory_overdue_count',(SELECT count(*) FROM r WHERE coalesce(resolved_at,now())>=first_reported_at+make_interval(mins=>cfg.reminder_minutes)),
    'picker_alert_count',(SELECT count(*) FROM picker),
    'picker_ack_late_count',(SELECT count(*) FROM picker WHERE acknowledged_at IS NULL OR acknowledged_at>=created_at+make_interval(mins=>cfg.picker_ack_reminder_minutes)),
    'picker_waiting_ack_now',(SELECT count(*) FROM public.notification_events e WHERE e.critical=true AND e.acknowledged_at IS NULL AND e.status IN ('AVAILABLE','SKIP_ALLOWED') AND e.expires_at>now()),
    'average_resolution_minutes',(SELECT round(avg(v)) FROM d),'median_resolution_minutes',(SELECT round(percentile_cont(0.5) WITHIN GROUP(ORDER BY v)) FROM d),'p95_resolution_minutes',(SELECT round(percentile_cont(0.95) WITHIN GROUP(ORDER BY v)) FROM d),
    'recurrent_episodes',(SELECT count(*) FROM r WHERE previous_issue_id IS NOT NULL),'auto_skip_count',(SELECT count(*) FROM public.issue_audit a JOIN r i ON i.id=a.issue_id WHERE a.action='AUTO_SKIP'),
    'by_status',coalesce((SELECT jsonb_object_agg(status,n) FROM s),'{}'::jsonb),
    'top_skus',coalesce((SELECT jsonb_agg(jsonb_build_object('sku',sku,'product_name',coalesce(product_name,''),'reports',reports)) FROM top),'[]'::jsonb),
    'top_auto_skip_skus',coalesce((SELECT jsonb_agg(jsonb_build_object('sku',sku,'product_name',coalesce(product_name,''),'count',n)) FROM autos),'[]'::jsonb),
    'daily_reports',coalesce((SELECT jsonb_agg(jsonb_build_object('day',day_key,'reports',reports,'issues',issues) ORDER BY day_key) FROM daily),'[]'::jsonb),
    'hourly_reports_24h',coalesce((SELECT jsonb_agg(reports ORDER BY h) FROM hourly),'[]'::jsonb),
    'inventory_reminder_minutes',cfg.reminder_minutes,'picker_ack_reminder_minutes',cfg.picker_ack_reminder_minutes,
    'auto_skip_enabled',cfg.auto_skip_enabled,'auto_skip_after_minutes',cfg.auto_skip_after_minutes
  ) INTO result;
  RETURN result;
END
$function$;

CREATE OR REPLACE FUNCTION public.api_reports_summary_rpc(p_test_role text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
BEGIN
  RETURN public.api_reports_summary_v2_rpc(now()-interval '30 days',now(),p_test_role);
END
$function$;

CREATE OR REPLACE FUNCTION public.api_issue_history_page_rpc(p_from timestamptz DEFAULT NULL,p_to timestamptz DEFAULT NULL,p_status text DEFAULT NULL,p_limit integer DEFAULT 25,p_offset integer DEFAULT 0,p_test_role text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE lim integer:=least(100,greatest(1,coalesce(p_limit,25))); off integer:=greatest(0,coalesce(p_offset,0)); v_from timestamptz:=coalesce(p_from,'1970-01-01'::timestamptz); v_to timestamptz:=coalesce(p_to,now()+interval '1 day'); total bigint;
BEGIN
  PERFORM public.require_role_rpc(p_test_role,ARRAY['ADMIN','ADMIN_INVENT']::public.user_role[]);
  SELECT count(*) INTO total FROM public.issues i WHERE i.first_reported_at>=v_from AND i.first_reported_at<v_to
    AND (coalesce(trim(p_status),'') IN ('','ALL') OR i.status::text=upper(trim(p_status)));
  RETURN jsonb_build_object('items',coalesce((SELECT jsonb_agg(public.issue_api_json(i,true) ORDER BY i.first_reported_at DESC,i.id)
    FROM (SELECT * FROM public.issues i WHERE i.first_reported_at>=v_from AND i.first_reported_at<v_to
      AND (coalesce(trim(p_status),'') IN ('','ALL') OR i.status::text=upper(trim(p_status)))
      ORDER BY i.first_reported_at DESC,i.id LIMIT lim OFFSET off)i),'[]'::jsonb),'total',total,'limit',lim,'offset',off);
END
$function$;

CREATE OR REPLACE FUNCTION public.api_audit_history_page_rpc(p_limit integer DEFAULT 25,p_offset integer DEFAULT 0,p_test_role text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE lim integer:=least(100,greatest(1,coalesce(p_limit,25))); off integer:=greatest(0,coalesce(p_offset,0)); total bigint;
BEGIN
  PERFORM public.require_role_rpc(p_test_role,ARRAY['ADMIN','ADMIN_INVENT']::public.user_role[]);
  SELECT count(*) INTO total FROM public.issue_audit;
  RETURN jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC,x.id)
    FROM (SELECT a.*,coalesce(p.full_name,'') actor_name FROM public.issue_audit a LEFT JOIN public.profiles p ON p.id=a.actor_id
      ORDER BY a.created_at DESC,a.id LIMIT lim OFFSET off)x),'[]'::jsonb),'total',total,'limit',lim,'offset',off);
END
$function$;
