-- BÁO HÀNG 1291 — auto-skip policy + found-item picker reminder.
-- 2026-09-04. Production authority: Neon project tiny-boat-19315489.
-- No secret material.

ALTER TABLE public.app_config
  DROP CONSTRAINT IF EXISTS app_config_auto_skip_disabled;

ALTER TABLE public.app_config
  ADD COLUMN IF NOT EXISTS found_item_reminder_minutes integer NOT NULL DEFAULT 5;

ALTER TABLE public.app_config
  DROP CONSTRAINT IF EXISTS app_config_found_item_reminder_minutes_check;

ALTER TABLE public.app_config
  ADD CONSTRAINT app_config_found_item_reminder_minutes_check
  CHECK (found_item_reminder_minutes >= 1 AND found_item_reminder_minutes <= 60);

ALTER TABLE public.notification_events
  ADD COLUMN IF NOT EXISTS reminder_interval_minutes integer;

ALTER TABLE public.notification_events
  DROP CONSTRAINT IF EXISTS notification_events_reminder_interval_minutes_check;

ALTER TABLE public.notification_events
  ADD CONSTRAINT notification_events_reminder_interval_minutes_check
  CHECK (reminder_interval_minutes IS NULL OR (reminder_interval_minutes >= 1 AND reminder_interval_minutes <= 60));

CREATE OR REPLACE FUNCTION public.api_get_operational_config_rpc(p_test_role text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  PERFORM public.require_role_rpc(p_test_role, ARRAY['ADMIN','ADMIN_INVENT']::public.user_role[]);
  RETURN (
    SELECT to_jsonb(x)
    FROM (
      SELECT acknowledge_minutes,
             reminder_minutes,
             replenish_minutes,
             picker_ack_reminder_minutes,
             found_item_reminder_minutes,
             auto_skip_enabled,
             auto_skip_after_minutes
      FROM public.app_config
      WHERE singleton=true
    ) x
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.api_save_config_rpc(p_config jsonb, p_test_role text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  PERFORM public.require_role_rpc(p_test_role, ARRAY['ADMIN','ADMIN_INVENT']::public.user_role[]);
  UPDATE public.app_config
  SET acknowledge_minutes=coalesce((p_config->>'acknowledge_minutes')::int,acknowledge_minutes),
      reminder_minutes=coalesce((p_config->>'reminder_minutes')::int,reminder_minutes),
      skip_minutes=coalesce((p_config->>'skip_minutes')::int,skip_minutes),
      replenish_minutes=coalesce((p_config->>'replenish_minutes')::int,replenish_minutes),
      retention_days=coalesce((p_config->>'retention_days')::int,retention_days),
      picker_ack_reminder_minutes=coalesce((p_config->>'picker_ack_reminder_minutes')::int,picker_ack_reminder_minutes),
      found_item_reminder_minutes=coalesce((p_config->>'found_item_reminder_minutes')::int,found_item_reminder_minutes),
      diagnostic_log_retention_days=coalesce((p_config->>'diagnostic_log_retention_days')::int,diagnostic_log_retention_days),
      staff_auto_sync_enabled=coalesce((p_config->>'staff_auto_sync_enabled')::boolean,staff_auto_sync_enabled),
      staff_sync_interval_minutes=coalesce((p_config->>'staff_sync_interval_minutes')::int,staff_sync_interval_minutes),
      auto_skip_enabled=coalesce((p_config->>'auto_skip_enabled')::boolean,auto_skip_enabled),
      auto_skip_after_minutes=coalesce((p_config->>'auto_skip_after_minutes')::int,auto_skip_after_minutes),
      updated_by=public.app_uid(),
      updated_at=now()
  WHERE singleton=true;
  RETURN public.api_get_config_rpc(p_test_role);
END
$function$;

-- Keep the existing signature working for older clients.
CREATE OR REPLACE FUNCTION public.api_save_operational_config_rpc(
  p_acknowledge_minutes integer,
  p_reminder_minutes integer,
  p_replenish_minutes integer,
  p_picker_ack_reminder_minutes integer DEFAULT 3,
  p_auto_skip_enabled boolean DEFAULT false,
  p_auto_skip_after_minutes integer DEFAULT 120,
  p_test_role text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  PERFORM public.require_role_rpc(p_test_role, ARRAY['ADMIN','ADMIN_INVENT']::public.user_role[]);
  UPDATE public.app_config
  SET acknowledge_minutes=p_acknowledge_minutes,
      reminder_minutes=p_reminder_minutes,
      replenish_minutes=p_replenish_minutes,
      picker_ack_reminder_minutes=p_picker_ack_reminder_minutes,
      auto_skip_enabled=coalesce(p_auto_skip_enabled,false),
      auto_skip_after_minutes=p_auto_skip_after_minutes,
      updated_by=public.app_uid(),
      updated_at=now()
  WHERE singleton=true;
  RETURN public.api_get_operational_config_rpc(p_test_role);
END
$function$;

-- New Web signature with dedicated "item found after skip" reminder.
CREATE OR REPLACE FUNCTION public.api_save_operational_config_rpc(
  p_acknowledge_minutes integer,
  p_reminder_minutes integer,
  p_replenish_minutes integer,
  p_picker_ack_reminder_minutes integer,
  p_found_item_reminder_minutes integer,
  p_auto_skip_enabled boolean,
  p_auto_skip_after_minutes integer,
  p_test_role text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  PERFORM public.require_role_rpc(p_test_role, ARRAY['ADMIN','ADMIN_INVENT']::public.user_role[]);
  UPDATE public.app_config
  SET acknowledge_minutes=p_acknowledge_minutes,
      reminder_minutes=p_reminder_minutes,
      replenish_minutes=p_replenish_minutes,
      picker_ack_reminder_minutes=p_picker_ack_reminder_minutes,
      found_item_reminder_minutes=p_found_item_reminder_minutes,
      auto_skip_enabled=coalesce(p_auto_skip_enabled,false),
      auto_skip_after_minutes=p_auto_skip_after_minutes,
      updated_by=public.app_uid(),
      updated_at=now()
  WHERE singleton=true;
  RETURN public.api_get_operational_config_rpc(p_test_role);
END
$function$;

CREATE OR REPLACE FUNCTION public.process_sla()
RETURNS TABLE(issue_id uuid, event_status public.issue_status, event_kind text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  cfg public.app_config%rowtype;
  item public.issues%rowtype;
  changed public.issues%rowtype;
BEGIN
  SELECT * INTO cfg FROM public.app_config WHERE singleton=true;

  FOR item IN
    SELECT *
    FROM public.issues
    WHERE status IN ('OPEN','CLAIMED','SEARCHING','REPLENISHING')
    FOR UPDATE SKIP LOCKED
  LOOP
    IF cfg.auto_skip_enabled
       AND now() >= item.first_reported_at + make_interval(mins=>greatest(15,cfg.auto_skip_after_minutes)) THEN

      UPDATE public.issues
      SET status='SKIP_ALLOWED'::public.issue_status,
          resolved_at=now(),
          issue_version=issue_version+1,
          updated_at=now()
      WHERE id=item.id
      RETURNING * INTO changed;

      INSERT INTO public.issue_audit(issue_id,actor_id,action,from_status,to_status,detail)
      VALUES (
        changed.id,
        NULL,
        'AUTO_SKIP',
        item.status,
        'SKIP_ALLOWED'::public.issue_status,
        jsonb_build_object(
          'auto_skip_after_minutes',cfg.auto_skip_after_minutes,
          'issue_version',changed.issue_version
        )
      );

      INSERT INTO public.sheet_export_queue(event_type,payload)
      VALUES (
        'ISSUE_STATUS',
        public.issue_json(changed) ||
        jsonb_build_object('actor_id',NULL,'action','AUTO_SKIP','auto_skip_after_minutes',cfg.auto_skip_after_minutes)
      );

      UPDATE public.notification_events
      SET acknowledged_at=coalesce(acknowledged_at,now())
      WHERE public.notification_events.issue_id=changed.id
        AND critical=true
        AND acknowledged_at IS NULL
        AND (issue_version<>changed.issue_version OR status::text<>'SKIP_ALLOWED');

      INSERT INTO public.notification_events(
        issue_id,target_user_id,status,issue_version,title,message,critical,expires_at
      )
      SELECT changed.id,
             r.reporter_id,
             'SKIP_ALLOWED'::public.issue_status,
             changed.issue_version,
             'ĐƯỢC PHÉP BỎ QUA • SKU '||changed.sku,
             'SKU '||changed.sku||' đã chờ quá thời gian quy định. Bạn được phép bỏ qua SKU này và tiếp tục công việc.',
             true,
             now()+interval '24 hours'
      FROM (SELECT DISTINCT ir.reporter_id FROM public.issue_reports ir WHERE ir.issue_id=changed.id) r
      ON CONFLICT(target_user_id,issue_id,issue_version,status)
      WHERE critical=true AND issue_id IS NOT NULL
      DO NOTHING;

      issue_id:=changed.id;
      event_status:=changed.status;
      event_kind:='AUTO_SKIP';
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF item.claimed_by IS NULL
       AND now()>=item.first_reported_at+make_interval(mins=>cfg.acknowledge_minutes)
       AND (item.last_reminded_at IS NULL OR now()>=item.last_reminded_at+make_interval(mins=>cfg.reminder_minutes)) THEN
      UPDATE public.issues SET last_reminded_at=now(),updated_at=now() WHERE id=item.id;
      issue_id:=item.id; event_status:=item.status; event_kind:='ACK_OVERDUE'; RETURN NEXT;
    ELSIF item.claimed_by IS NOT NULL
       AND now()>=coalesce(item.claimed_at,item.first_reported_at)+make_interval(mins=>cfg.replenish_minutes)
       AND (item.last_reminded_at IS NULL OR now()>=item.last_reminded_at+make_interval(mins=>cfg.reminder_minutes)) THEN
      UPDATE public.issues SET last_reminded_at=now(),updated_at=now() WHERE id=item.id;
      issue_id:=item.id; event_status:=item.status; event_kind:='PROCESS_OVERDUE'; RETURN NEXT;
    END IF;
  END LOOP;
END
$function$;

CREATE OR REPLACE FUNCTION public.worker_tick_rpc()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  r record;
  i public.issues%rowtype;
  n integer:=0;
  a integer:=0;
  auto_skipped integer:=0;
  auto_enabled boolean:=false;
BEGIN
  PERFORM public.worker_require_admin();
  SELECT auto_skip_enabled INTO auto_enabled FROM public.app_config WHERE singleton=true;

  FOR r IN SELECT * FROM public.process_sla()
  LOOP
    IF r.event_kind='AUTO_SKIP' THEN
      auto_skipped:=auto_skipped+1;
      CONTINUE;
    END IF;

    SELECT * INTO i FROM public.issues WHERE id=r.issue_id;
    IF FOUND THEN
      INSERT INTO public.notification_events(issue_id,target_user_id,status,issue_version,title,message,critical,expires_at)
      SELECT i.id,p.id,i.status,i.issue_version,
             'Cần xử lý • SKU '||i.sku,
             'SKU '||i.sku||' đã vượt thời gian nghiệp vụ; cần kiểm tra và phản hồi.',
             false,
             now()+interval '24 hours'
      FROM public.profiles p
      WHERE p.active=true AND p.role IN ('ADMIN','ADMIN_INVENT','INVENT');
      GET DIAGNOSTICS a=ROW_COUNT;
      n:=n+a;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'sla_notifications_queued',n,
    'auto_skip_enabled',auto_enabled,
    'auto_skipped',auto_skipped,
    'checked_at',now()
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.api_restore_skipped_issue_rpc(
  p_issue_id uuid,
  p_reason text DEFAULT ''::text,
  p_test_role text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_role public.user_role;
  v_issue jsonb;
  v_version bigint;
  v_sku text;
  v_reminder integer;
BEGIN
  v_role := public.require_role_rpc(p_test_role, ARRAY['ADMIN','ADMIN_INVENT','INVENT']::public.user_role[]);
  v_issue := public.restore_skipped_issue_available(p_issue_id, public.app_uid(), p_reason);
  v_version:=coalesce((v_issue->>'issue_version')::bigint,1);
  v_sku:=coalesce(v_issue->>'sku','');
  SELECT greatest(1,found_item_reminder_minutes) INTO v_reminder
  FROM public.app_config WHERE singleton=true;

  UPDATE public.notification_events
  SET acknowledged_at=coalesce(acknowledged_at,now())
  WHERE issue_id=p_issue_id
    AND critical=true
    AND acknowledged_at IS NULL
    AND (issue_version<>v_version OR status::text<>'AVAILABLE');

  INSERT INTO public.notification_events(
    issue_id,target_user_id,status,issue_version,title,message,critical,expires_at,reminder_interval_minutes
  )
  SELECT p_issue_id,
         r.reporter_id,
         'AVAILABLE'::public.issue_status,
         v_version,
         'ĐÃ TÌM THẤY HÀNG • SKU '||v_sku,
         'SKU '||v_sku||' trước đó đã được phép bỏ qua nhưng hiện đã tìm thấy hàng. Vui lòng quay lại lấy hàng.',
         true,
         now()+interval '24 hours',
         v_reminder
  FROM (SELECT DISTINCT reporter_id FROM public.issue_reports WHERE issue_id=p_issue_id) r
  ON CONFLICT(target_user_id,issue_id,issue_version,status)
  WHERE critical=true AND issue_id IS NOT NULL
  DO NOTHING;

  RETURN jsonb_build_object('issue',v_issue,'picker_reminder_minutes',v_reminder);
END
$function$;

CREATE OR REPLACE FUNCTION public.worker_notification_batch_rpc(p_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  lim integer:=least(500,greatest(1,coalesce(p_limit,200)));
  default_rem integer;
  ids uuid[];
  result jsonb;
BEGIN
  PERFORM public.worker_require_admin();
  SELECT greatest(1,picker_ack_reminder_minutes) INTO default_rem FROM public.app_config WHERE singleton=true;

  UPDATE public.notification_events e
  SET acknowledged_at=coalesce(e.acknowledged_at,now())
  WHERE e.acknowledged_at IS NULL
    AND (
      e.expires_at<=now()
      OR e.issue_id IS NULL
      OR NOT EXISTS(
        SELECT 1 FROM public.issues i
        WHERE i.id=e.issue_id AND i.status=e.status AND i.issue_version=e.issue_version
      )
    );

  WITH due AS (
    SELECT e.id
    FROM public.notification_events e
    JOIN public.issues i
      ON i.id=e.issue_id AND i.status=e.status AND i.issue_version=e.issue_version
    WHERE e.acknowledged_at IS NULL
      AND e.expires_at>now()
      AND (
        (e.critical=true AND (
          e.sent_at IS NULL
          OR e.sent_at < now()-make_interval(mins=>greatest(1,coalesce(e.reminder_interval_minutes,default_rem)))
        ))
        OR (e.critical=false AND e.sent_at IS NULL)
      )
    ORDER BY e.created_at
    LIMIT lim
    FOR UPDATE SKIP LOCKED
  ), marked AS (
    UPDATE public.notification_events e
    SET last_attempt_at=now()
    FROM due d
    WHERE e.id=d.id
    RETURNING e.id
  )
  SELECT array_agg(id) INTO ids FROM marked;

  IF ids IS NULL THEN RETURN '[]'::jsonb; END IF;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'event_id',e.id,
      'issue_id',e.issue_id,
      'issue_version',e.issue_version,
      'target_user_id',e.target_user_id,
      'status',e.status,
      'title',e.title,
      'message',e.message,
      'critical',e.critical,
      'send_count',e.send_count,
      'sku',i.sku,
      'product_name',i.product_name_snapshot,
      'device_tokens',coalesce((
        SELECT jsonb_agg(d.fcm_token ORDER BY d.fcm_token)
        FROM public.device_tokens d
        WHERE d.user_id=e.target_user_id AND d.active=true
      ),'[]'::jsonb)
    )
    ORDER BY e.created_at
  ),'[]'::jsonb)
  INTO result
  FROM public.notification_events e
  JOIN public.issues i ON i.id=e.issue_id
  WHERE e.id=ANY(ids);

  RETURN result;
END
$function$;
