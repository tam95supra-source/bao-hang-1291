-- BÁO HÀNG 1291 — production hotfix 2026-08-25
-- Scope: eliminate false ISSUE_NOT_OWNED on unclaimed active issues while preserving ownership isolation.
-- INVENT may take an unclaimed active issue as part of the same transaction before AVAILABLE/NOT_FOUND.
-- An issue already owned by another account remains forbidden, except an idempotent retry of the same final state.

CREATE OR REPLACE FUNCTION public.api_update_issue_rpc(
  p_issue_id uuid,
  p_action text,
  p_client_request_id uuid DEFAULT gen_random_uuid(),
  p_test_role text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_role public.user_role;
  v_uid uuid := public.app_uid();
  v_claimed_by uuid;
  v_status public.issue_status;
  v_action text := upper(trim(p_action));
  v_same_final boolean := false;
  r jsonb;
BEGIN
  v_role := public.require_role_rpc(
    p_test_role,
    ARRAY['ADMIN','ADMIN_INVENT','INVENT']::public.user_role[]
  );

  IF v_action = 'SKIP_ALLOWED' THEN v_action := 'NOT_FOUND'; END IF;

  IF v_role = 'INVENT'::public.user_role THEN
    SELECT i.claimed_by, i.status
      INTO v_claimed_by, v_status
      FROM public.issues i
     WHERE i.id = p_issue_id
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ISSUE_NOT_FOUND';
    END IF;

    v_same_final :=
      (v_action = 'AVAILABLE' AND v_status = 'AVAILABLE')
      OR (v_action = 'NOT_FOUND' AND v_status = 'SKIP_ALLOWED');

    IF NOT v_same_final THEN
      IF v_claimed_by IS NULL
         AND v_status IN ('OPEN','CLAIMED','SEARCHING','REPLENISHING') THEN
        -- Canonical OPEN -> CLAIMED transition is recorded before the final action.
        PERFORM public.update_issue_atomic(p_issue_id, v_uid, 'CLAIM');
        v_claimed_by := v_uid;
      END IF;

      IF v_claimed_by IS DISTINCT FROM v_uid THEN
        RAISE EXCEPTION 'ISSUE_NOT_OWNED';
      END IF;
    END IF;
  END IF;

  r := public.update_issue_rpc(p_issue_id, v_action, p_client_request_id);
  RETURN jsonb_build_object('issue', r);
END
$function$;

CREATE OR REPLACE FUNCTION public.api_update_issue_rpc(
  p_issue_id uuid,
  p_action text,
  p_test_role text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_role public.user_role;
  v_uid uuid := public.app_uid();
  v_claimed_by uuid;
  v_status public.issue_status;
  v_action text := upper(trim(p_action));
  v_same_final boolean := false;
  r jsonb;
BEGIN
  v_role := public.require_role_rpc(
    p_test_role,
    ARRAY['ADMIN','ADMIN_INVENT','INVENT']::public.user_role[]
  );

  IF v_action = 'SKIP_ALLOWED' THEN v_action := 'NOT_FOUND'; END IF;

  IF v_role = 'INVENT'::public.user_role THEN
    SELECT i.claimed_by, i.status
      INTO v_claimed_by, v_status
      FROM public.issues i
     WHERE i.id = p_issue_id
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ISSUE_NOT_FOUND';
    END IF;

    v_same_final :=
      (v_action = 'AVAILABLE' AND v_status = 'AVAILABLE')
      OR (v_action = 'NOT_FOUND' AND v_status = 'SKIP_ALLOWED');

    IF NOT v_same_final THEN
      IF v_claimed_by IS NULL
         AND v_status IN ('OPEN','CLAIMED','SEARCHING','REPLENISHING') THEN
        PERFORM public.update_issue_atomic(p_issue_id, v_uid, 'CLAIM');
        v_claimed_by := v_uid;
      END IF;

      IF v_claimed_by IS DISTINCT FROM v_uid THEN
        RAISE EXCEPTION 'ISSUE_NOT_OWNED';
      END IF;
    END IF;
  END IF;

  r := public.update_issue_rpc(p_issue_id, v_action);
  RETURN jsonb_build_object('issue', r);
END
$function$;

CREATE OR REPLACE FUNCTION public.api_issue_board_rpc(p_test_role text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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
BEGIN
  v_role := public.require_role_rpc(
    p_test_role,
    ARRAY['ADMIN','ADMIN_INVENT','INVENT']::public.user_role[]
  );

  day_start := (date_trunc('day', now() AT TIME ZONE tz) AT TIME ZONE tz);
  day_end := day_start + interval '1 day';

  SELECT coalesce(jsonb_agg(public.issue_api_json(i,true) ORDER BY i.first_reported_at),'[]'::jsonb), count(*)
    INTO active, active_count
    FROM public.issues i
   WHERE i.status IN ('OPEN','CLAIMED','SEARCHING','REPLENISHING')
     AND (
       v_role <> 'INVENT'::public.user_role
       OR i.claimed_by IS NULL
       OR i.claimed_by = v_uid
     );

  SELECT coalesce(jsonb_agg(public.issue_api_json(i,true) ORDER BY i.resolved_at DESC),'[]'::jsonb)
    INTO recent
    FROM public.issues i
   WHERE i.status IN ('AVAILABLE','SKIP_ALLOWED')
     AND i.resolved_at >= day_start
     AND i.resolved_at < day_end;

  SELECT count(*) INTO available_count
    FROM public.issues
   WHERE status='AVAILABLE' AND resolved_at>=day_start AND resolved_at<day_end;

  SELECT count(*) INTO skipped_count
    FROM public.issues
   WHERE status='SKIP_ALLOWED' AND resolved_at>=day_start AND resolved_at<day_end;

  RETURN jsonb_build_object(
    'open','[]'::jsonb,
    'claimed',active,
    'recent',recent,
    'skipped',coalesce((SELECT jsonb_agg(x) FROM jsonb_array_elements(recent) x WHERE x->>'status'='SKIP_ALLOWED'),'[]'::jsonb),
    'available',coalesce((SELECT jsonb_agg(x) FROM jsonb_array_elements(recent) x WHERE x->>'status'='AVAILABLE'),'[]'::jsonb),
    'counts',jsonb_build_object('open',0,'claimed',active_count,'available',available_count,'skipped',skipped_count),
    'scope',jsonb_build_object('active','CURRENT','resolved','TODAY','day_start',day_start,'day_end',day_end)
  );
END
$function$;
