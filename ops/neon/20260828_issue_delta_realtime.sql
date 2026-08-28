-- Additive, backward-compatible operator issue delta API.
-- Stable clients ignore the extra realtime_seq field on api_issue_board_rpc.
-- Rollback: DROP FUNCTION IF EXISTS public.api_issue_delta_rpc(bigint,integer,text);
-- Then restore api_issue_board_rpc from the prior migration/source definition if the extra key must be removed.

CREATE OR REPLACE FUNCTION public.api_issue_board_rpc(p_test_role text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  tz text := 'Asia/Bangkok';
  day_start timestamptz;
  day_end timestamptz;
  active jsonb;
  recent jsonb;
  available_count int;
  skipped_count int;
  active_count int;
  v_role public.user_role;
  v_uid uuid := public.app_uid();
  v_realtime_seq bigint;
BEGIN
  v_role := public.require_role_rpc(p_test_role, ARRAY['ADMIN','ADMIN_INVENT','INVENT']::public.user_role[]);
  day_start := (date_trunc('day', now() at time zone tz) at time zone tz);
  day_end := day_start + interval '1 day';

  SELECT coalesce(jsonb_agg(public.issue_api_json(i,true) order by i.first_reported_at),'[]'::jsonb), count(*)
  INTO active, active_count
  FROM public.issues i
  WHERE i.status IN ('OPEN','CLAIMED','SEARCHING','REPLENISHING')
    AND (v_role <> 'INVENT'::public.user_role OR i.claimed_by IS NULL OR i.claimed_by = v_uid);

  SELECT coalesce(jsonb_agg(public.issue_api_json(i,true) order by i.resolved_at desc),'[]'::jsonb)
  INTO recent
  FROM public.issues i
  WHERE i.status IN ('AVAILABLE','SKIP_ALLOWED')
    AND i.resolved_at >= day_start AND i.resolved_at < day_end;

  SELECT count(*) INTO available_count FROM public.issues
  WHERE status='AVAILABLE' AND resolved_at>=day_start AND resolved_at<day_end;
  SELECT count(*) INTO skipped_count FROM public.issues
  WHERE status='SKIP_ALLOWED' AND resolved_at>=day_start AND resolved_at<day_end;
  SELECT coalesce(max(id),0) INTO v_realtime_seq FROM public.realtime_events WHERE topic='issues';

  RETURN jsonb_build_object(
    'open','[]'::jsonb,
    'claimed',active,
    'recent',recent,
    'skipped',coalesce((SELECT jsonb_agg(x) FROM jsonb_array_elements(recent)x WHERE x->>'status'='SKIP_ALLOWED'),'[]'::jsonb),
    'available',coalesce((SELECT jsonb_agg(x) FROM jsonb_array_elements(recent)x WHERE x->>'status'='AVAILABLE'),'[]'::jsonb),
    'counts',jsonb_build_object('open',0,'claimed',active_count,'available',available_count,'skipped',skipped_count),
    'scope',jsonb_build_object('active','CURRENT','resolved','TODAY','day_start',day_start,'day_end',day_end),
    'realtime_seq',v_realtime_seq
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.api_issue_delta_rpc(
  p_after_seq bigint DEFAULT 0,
  p_limit integer DEFAULT 200,
  p_test_role text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_role public.user_role;
  v_uid uuid := public.app_uid();
  v_limit integer := least(500, greatest(1, coalesce(p_limit,200)));
  v_after bigint := greatest(0, coalesce(p_after_seq,0));
  v_min_seq bigint;
  v_server_seq bigint;
  v_latest_seq bigint;
  v_events jsonb;
  v_has_more boolean := false;
  v_requires_full boolean := false;
  v_day_start timestamptz := (date_trunc('day',now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok');
  v_day_end timestamptz := v_day_start + interval '1 day';
BEGIN
  v_role := public.require_role_rpc(p_test_role, ARRAY['ADMIN','ADMIN_INVENT','INVENT']::public.user_role[]);
  SELECT min(id), coalesce(max(id),0) INTO v_min_seq, v_server_seq
  FROM public.realtime_events WHERE topic='issues';

  v_requires_full := v_after > 0 AND v_min_seq IS NOT NULL AND v_after < v_min_seq;

  WITH raw AS (
    SELECT r.id, r.entity_id, r.entity_version
    FROM public.realtime_events r
    WHERE r.topic='issues' AND r.id > v_after
    ORDER BY r.id
    LIMIT v_limit
  ),
  latest AS (
    SELECT DISTINCT ON (entity_id) id, entity_id, entity_version
    FROM raw
    ORDER BY entity_id, id DESC
  ),
  enriched AS (
    SELECT
      l.id AS seq,
      l.entity_id,
      l.entity_version,
      i.*,
      (
        (i.status IN ('OPEN','CLAIMED','SEARCHING','REPLENISHING')
          AND (v_role <> 'INVENT'::public.user_role OR i.claimed_by IS NULL OR i.claimed_by=v_uid))
        OR
        (i.status IN ('AVAILABLE','SKIP_ALLOWED') AND i.resolved_at>=v_day_start AND i.resolved_at<v_day_end)
      ) AS visible,
      EXISTS (
        SELECT 1 FROM public.issue_audit a
        WHERE a.issue_id=i.id
          AND upper(a.action)='WITHDRAW_SHORTAGE'
          AND coalesce((a.detail->>'issue_version')::bigint,0)=coalesce(l.entity_version,0)
      ) AS withdrawn_changed
    FROM latest l
    LEFT JOIN public.issues i ON i.id::text=l.entity_id
  )
  SELECT
    coalesce(jsonb_agg(
      jsonb_build_object(
        'seq',e.seq,
        'entity_id',e.entity_id,
        'entity_version',e.entity_version,
        'visible',coalesce(e.visible,false),
        'withdrawn_changed',coalesce(e.withdrawn_changed,false),
        'issue',CASE WHEN coalesce(e.visible,false) THEN public.issue_api_json(e,true) ELSE NULL END
      )
      ORDER BY e.seq
    ),'[]'::jsonb),
    coalesce((SELECT max(id) FROM raw),v_after)
  INTO v_events, v_latest_seq
  FROM enriched e;

  v_has_more := v_latest_seq < v_server_seq;

  RETURN jsonb_build_object(
    'events',v_events,
    'latest_seq',v_latest_seq,
    'server_seq',v_server_seq,
    'has_more',v_has_more,
    'requires_full_reconcile',v_requires_full
  );
END
$function$;

REVOKE ALL ON FUNCTION public.api_issue_delta_rpc(bigint,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.api_issue_delta_rpc(bigint,integer,text) TO anonymous, authenticated;


-- Candidate-capability registration keeps legacy Stable/Beta per-token realtime working
-- while topic-capable clients use one FCM publish per topic/burst.
ALTER TABLE public.device_tokens
  ADD COLUMN IF NOT EXISTS realtime_topic_capable boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.api_register_device_v2_rpc(
  p_fcm_token text,
  p_device_name text DEFAULT ''::text,
  p_app_version text DEFAULT ''::text,
  p_platform text DEFAULT 'android'::text,
  p_realtime_topic_capable boolean DEFAULT true,
  p_test_role text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := public.app_uid();
BEGIN
  PERFORM public.effective_role_rpc(p_test_role);
  PERFORM public.register_device_rpc(p_fcm_token,p_platform,p_device_name,p_app_version);
  UPDATE public.device_tokens
  SET realtime_topic_capable=coalesce(p_realtime_topic_capable,false),
      last_seen_at=now()
  WHERE fcm_token=p_fcm_token
    AND user_id=v_uid;
  RETURN jsonb_build_object(
    'registered',true,
    'realtime_topic_capable',coalesce(p_realtime_topic_capable,false)
  );
END
$function$;

REVOKE ALL ON FUNCTION public.api_register_device_v2_rpc(text,text,text,text,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.api_register_device_v2_rpc(text,text,text,text,boolean,text) TO anonymous, authenticated;

CREATE OR REPLACE FUNCTION public.worker_realtime_batch_rpc(p_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  ids bigint[];
  result jsonb;
BEGIN
  PERFORM public.worker_require_admin();
  WITH due AS (
    SELECT id
    FROM public.realtime_events
    WHERE published_at IS NULL
    ORDER BY id
    LIMIT least(500,greatest(1,coalesce(p_limit,200)))
    FOR UPDATE SKIP LOCKED
  ), marked AS (
    UPDATE public.realtime_events r
    SET attempts=attempts+1,last_error=''
    FROM due d
    WHERE r.id=d.id
    RETURNING r.id
  )
  SELECT array_agg(id) INTO ids FROM marked;
  IF ids IS NULL THEN RETURN '[]'::jsonb; END IF;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id',r.id,
      'topic',r.topic,
      'event_type',r.event_type,
      'entity_id',r.entity_id,
      'entity_version',r.entity_version,
      'payload',r.payload,
      'created_at',r.created_at,
      -- Old clients keep per-token delivery. Candidate clients set the capability
      -- flag and receive the topic marker instead.
      'device_tokens',coalesce((
        SELECT jsonb_agg(d.fcm_token ORDER BY d.fcm_token)
        FROM public.device_tokens d
        JOIN public.profiles p ON p.id=d.user_id
        WHERE d.active=true
          AND (
            r.topic='catalog'
            OR (r.topic='issues'
                AND p.role IN ('ADMIN','ADMIN_INVENT','INVENT')
                AND d.realtime_topic_capable=false)
            OR (r.topic IN ('staff','config')
                AND p.role IN ('ADMIN','ADMIN_INVENT','INVENT'))
          )
      ),'[]'::jsonb)
    )
    ORDER BY r.id
  ),'[]'::jsonb)
  INTO result
  FROM public.realtime_events r
  WHERE r.id=ANY(ids);
  RETURN result;
END
$function$;

CREATE OR REPLACE FUNCTION public.worker_realtime_results_rpc(p_results jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  item jsonb;
  ids bigint[];
  invalid text[];
  ok boolean;
  err text;
  updated_count integer := 0;
  n integer;
BEGIN
  PERFORM public.worker_require_admin();
  FOR item IN SELECT value FROM jsonb_array_elements(coalesce(p_results,'[]'::jsonb))
  LOOP
    SELECT coalesce(array_agg(value::bigint),ARRAY[]::bigint[])
      INTO ids FROM jsonb_array_elements_text(coalesce(item->'ids','[]'::jsonb));
    SELECT coalesce(array_agg(value),ARRAY[]::text[])
      INTO invalid FROM jsonb_array_elements_text(coalesce(item->'invalid_tokens','[]'::jsonb));
    ok := coalesce((item->>'published')::boolean,false);
    err := left(coalesce(item->>'error',''),500);
    IF coalesce(array_length(invalid,1),0)>0 THEN
      UPDATE public.device_tokens SET active=false WHERE fcm_token=ANY(invalid);
    END IF;
    UPDATE public.realtime_events
    SET published_at=CASE WHEN ok THEN coalesce(published_at,now()) ELSE published_at END,
        last_error=CASE WHEN ok THEN '' ELSE err END
    WHERE id=ANY(ids);
    GET DIAGNOSTICS n = ROW_COUNT;
    updated_count := updated_count + n;
  END LOOP;
  RETURN jsonb_build_object('updated',updated_count);
END
$function$;

CREATE OR REPLACE FUNCTION public.worker_notification_results_rpc(p_results jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  item jsonb;
  invalid text[];
  accepted boolean;
  event_id uuid;
  updated_count integer := 0;
  n integer;
BEGIN
  PERFORM public.worker_require_admin();
  FOR item IN SELECT value FROM jsonb_array_elements(coalesce(p_results,'[]'::jsonb))
  LOOP
    event_id := nullif(item->>'event_id','')::uuid;
    accepted := coalesce((item->>'accepted')::boolean,false);
    SELECT coalesce(array_agg(value),ARRAY[]::text[])
      INTO invalid FROM jsonb_array_elements_text(coalesce(item->'invalid_tokens','[]'::jsonb));
    IF coalesce(array_length(invalid,1),0)>0 THEN
      UPDATE public.device_tokens SET active=false WHERE fcm_token=ANY(invalid);
    END IF;
    UPDATE public.notification_events
    SET sent_at=CASE WHEN accepted THEN now() ELSE sent_at END,
        fcm_accepted_at=CASE WHEN accepted THEN now() ELSE fcm_accepted_at END,
        send_count=CASE WHEN accepted THEN send_count+1 ELSE send_count END,
        last_attempt_at=now()
    WHERE id=event_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    updated_count := updated_count + n;
  END LOOP;
  RETURN jsonb_build_object('updated',updated_count);
END
$function$;

CREATE OR REPLACE FUNCTION public.worker_push_results_rpc(p_results jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  item jsonb;
  invalid text[];
  accepted boolean;
  event_id uuid;
  updated_count integer := 0;
  n integer;
BEGIN
  PERFORM public.worker_require_admin();
  FOR item IN SELECT value FROM jsonb_array_elements(coalesce(p_results,'[]'::jsonb))
  LOOP
    event_id := nullif(item->>'id','')::uuid;
    accepted := coalesce((item->>'accepted')::boolean,false);
    SELECT coalesce(array_agg(value),ARRAY[]::text[])
      INTO invalid FROM jsonb_array_elements_text(coalesce(item->'invalid_tokens','[]'::jsonb));
    IF coalesce(array_length(invalid,1),0)>0 THEN
      UPDATE public.device_tokens SET active=false WHERE fcm_token=ANY(invalid);
    END IF;
    UPDATE public.push_outbox
    SET sent_at=CASE WHEN accepted THEN coalesce(sent_at,now()) ELSE sent_at END,
        last_error=CASE WHEN accepted THEN '' ELSE left(coalesce(item->>'error',''),500) END,
        last_attempt_at=now()
    WHERE id=event_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    updated_count := updated_count + n;
  END LOOP;
  RETURN jsonb_build_object('updated',updated_count);
END
$function$;

REVOKE ALL ON FUNCTION public.worker_realtime_results_rpc(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.worker_notification_results_rpc(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.worker_push_results_rpc(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.worker_realtime_results_rpc(jsonb) TO anonymous, authenticated;
GRANT EXECUTE ON FUNCTION public.worker_notification_results_rpc(jsonb) TO anonymous, authenticated;
GRANT EXECUTE ON FUNCTION public.worker_push_results_rpc(jsonb) TO anonymous, authenticated;


-- Keep aggregated reports visible to sequence/version based realtime clients.
CREATE OR REPLACE FUNCTION public.report_shortage_atomic(p_sku text, p_reporter uuid, p_client_request_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$declare v_item public.sku_catalog%rowtype;v_issue public.issues%rowtype;v_previous uuid;v_already boolean:=false;v_normalized text:=lower(trim(p_sku));v_event_id uuid;v_payload jsonb;begin perform pg_advisory_xact_lock(hashtextextended(v_normalized,1291));if p_client_request_id is not null and trim(p_client_request_id)<>'' then select i.* into v_issue from public.issue_reports r join public.issues i on i.id=r.issue_id where r.client_request_id=trim(p_client_request_id);if found then return jsonb_build_object('issue',public.issue_json(v_issue),'already_reported',true,'duplicate_request',true,'message','Yêu cầu đã được đồng bộ trước đó');end if;end if;select * into v_item from public.sku_catalog where lower(sku)=v_normalized and active=true limit 1;if not found then raise exception 'SKU_NOT_FOUND';end if;if not exists(select 1 from public.profiles where id=p_reporter and active=true) then raise exception 'USER_INACTIVE';end if;select * into v_issue from public.issues where sku=v_item.sku and status in('OPEN','CLAIMED','SEARCHING','REPLENISHING') order by first_reported_at asc limit 1 for update;if found then v_already:=true;update public.issues set report_count=report_count+1,issue_version=issue_version+1,updated_at=now() where id=v_issue.id returning * into v_issue;else select id into v_previous from public.issues where sku=v_item.sku and status in('AVAILABLE','SKIP_ALLOWED','CLOSED') order by coalesce(resolved_at,updated_at) desc limit 1;insert into public.issues(sku,product_name_snapshot,status,report_count,first_reported_at,previous_issue_id,issue_version) values(v_item.sku,v_item.product_name,'OPEN',1,now(),v_previous,1) returning * into v_issue;end if;insert into public.issue_reports(issue_id,reporter_id,client_request_id) values(v_issue.id,p_reporter,nullif(trim(p_client_request_id),''));insert into public.issue_audit(issue_id,actor_id,action,to_status,detail) values(v_issue.id,p_reporter,'REPORT_SHORTAGE',v_issue.status,jsonb_build_object('already_reported',v_already,'report_count',v_issue.report_count,'issue_version',v_issue.issue_version,'previous_issue_id',v_issue.previous_issue_id));v_payload:=public.issue_json(v_issue)||jsonb_build_object('reporter_id',p_reporter,'client_request_id',nullif(trim(p_client_request_id),''));if coalesce(trim(p_client_request_id),'') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then v_event_id:=trim(p_client_request_id)::uuid;else v_event_id:=gen_random_uuid();end if;insert into public.sheet_export_queue(event_id,event_type,payload,actor_account_id,issue_id,sku,issue_version) values(v_event_id,'REPORT_SHORTAGE',v_payload,p_reporter,v_issue.id,v_issue.sku,v_issue.issue_version);insert into public.authority_events(event_id,source_mode,event_type,actor_account_id,actor_role,issue_id,sku,issue_version,payload_json,payload_sha256,service_ack_at,reconciliation_status) values(v_event_id,'SERVICE','REPORT_SHORTAGE',p_reporter,(select role::text from public.profiles where id=p_reporter),v_issue.id,v_issue.sku,v_issue.issue_version,v_payload,encode(public.digest(convert_to(v_payload::text,'UTF8'),'sha256'),'hex'),now(),'PENDING') on conflict(event_id) do nothing;return jsonb_build_object('issue',public.issue_json(v_issue),'already_reported',v_already,'duplicate_request',false,'message','Đã ghi nhận báo thiếu');end;$function$
