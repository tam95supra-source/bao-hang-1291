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
