-- BÁO HÀNG 1291 — Workflow V3 follow-up corrections.
-- Non-destructive: function replacements/compatibility overload only.
-- Deprecated app_config columns are intentionally retained for old binary compatibility.

CREATE OR REPLACE FUNCTION public.api_save_operational_config_rpc(
  p_inventory_reminder_minutes integer,
  p_picker_ack_reminder_minutes integer,
  p_auto_skip_enabled boolean,
  p_auto_skip_after_minutes integer,
  p_test_role text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_inventory integer:=greatest(1,least(480,coalesce(p_inventory_reminder_minutes,5)));
  v_picker integer:=greatest(1,least(60,coalesce(p_picker_ack_reminder_minutes,3)));
  v_auto integer:=greatest(1,least(4320,coalesce(p_auto_skip_after_minutes,120)));
BEGIN
  PERFORM public.require_role_rpc(p_test_role,ARRAY['ADMIN','ADMIN_INVENT']::public.user_role[]);
  UPDATE public.app_config
  SET acknowledge_minutes=v_inventory,
      reminder_minutes=v_inventory,
      replenish_minutes=v_inventory,
      picker_ack_reminder_minutes=v_picker,
      found_item_reminder_minutes=v_picker,
      auto_skip_enabled=coalesce(p_auto_skip_enabled,false),
      auto_skip_after_minutes=v_auto,
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
  deadline_at timestamptz;
  note_text text;
BEGIN
  SELECT * INTO cfg FROM public.app_config WHERE singleton=true;

  FOR item IN
    SELECT * FROM public.issues
    WHERE status IN ('OPEN','CLAIMED','SEARCHING','REPLENISHING')
    FOR UPDATE SKIP LOCKED
  LOOP
    deadline_at:=item.first_reported_at+make_interval(mins=>cfg.auto_skip_after_minutes);

    IF cfg.auto_skip_enabled AND now()>=deadline_at THEN
      note_text:='Đã quá hạn Inventory xử lí lúc '||to_char(deadline_at AT TIME ZONE 'Asia/Bangkok','HH24:MI:SS');
      UPDATE public.issues
      SET status='SKIP_ALLOWED',
          claimed_by=NULL,
          claimed_at=NULL,
          resolved_at=deadline_at,
          issue_version=issue_version+1,
          updated_at=now()
      WHERE id=item.id
      RETURNING * INTO changed;

      INSERT INTO public.issue_audit(issue_id,actor_id,action,from_status,to_status,detail)
      VALUES(
        changed.id,NULL,'AUTO_SKIP',item.status,'SKIP_ALLOWED',
        jsonb_build_object(
          'auto_skip_after_minutes',cfg.auto_skip_after_minutes,
          'deadline_at',deadline_at,
          'note',note_text,
          'actor_label','Đã quá hạn Inventory xử lí',
          'issue_version',changed.issue_version
        )
      );

      INSERT INTO public.sheet_export_queue(event_type,payload)
      VALUES(
        'ISSUE_STATUS',
        public.issue_json(changed)||jsonb_build_object(
          'actor_id',NULL,
          'actor_name','Đã quá hạn Inventory xử lí',
          'action','AUTO_SKIP',
          'auto_skip_after_minutes',cfg.auto_skip_after_minutes,
          'deadline_at',deadline_at,
          'note',note_text
        )
      );

      UPDATE public.notification_events
      SET acknowledged_at=coalesce(acknowledged_at,now())
      WHERE issue_id=changed.id
        AND critical=true
        AND acknowledged_at IS NULL
        AND (issue_version<>changed.issue_version OR status::text<>'SKIP_ALLOWED');

      INSERT INTO public.notification_events(
        issue_id,target_user_id,status,issue_version,title,message,critical,expires_at,reminder_interval_minutes
      )
      SELECT
        changed.id,
        r.reporter_id,
        'SKIP_ALLOWED',
        changed.issue_version,
        'ĐƯỢC PHÉP BỎ QUA • SKU '||changed.sku,
        'SKU '||changed.sku||' đã quá hạn Inventory xử lí. Bạn được phép bỏ qua SKU này và tiếp tục công việc.',
        true,
        now()+interval '24 hours',
        greatest(1,cfg.picker_ack_reminder_minutes)
      FROM (SELECT DISTINCT reporter_id FROM public.issue_reports WHERE issue_id=changed.id) r
      ON CONFLICT(target_user_id,issue_id,issue_version,status)
        WHERE critical=true AND issue_id IS NOT NULL
      DO NOTHING;

      issue_id:=changed.id;
      event_status:=changed.status;
      event_kind:='AUTO_SKIP';
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF now()>=item.first_reported_at+make_interval(mins=>cfg.reminder_minutes)
       AND (item.last_reminded_at IS NULL OR now()>=item.last_reminded_at+make_interval(mins=>cfg.reminder_minutes)) THEN
      UPDATE public.issues SET last_reminded_at=now(),updated_at=now() WHERE id=item.id;
      issue_id:=item.id;
      event_status:=item.status;
      event_kind:='INVENTORY_REMINDER';
      RETURN NEXT;
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
  cfg public.app_config%rowtype;
  n integer:=0;
  a integer:=0;
  auto_skipped integer:=0;
BEGIN
  PERFORM public.worker_require_admin();
  SELECT * INTO cfg FROM public.app_config WHERE singleton=true;

  FOR r IN SELECT * FROM public.process_sla() LOOP
    IF r.event_kind='AUTO_SKIP' THEN
      auto_skipped:=auto_skipped+1;
      CONTINUE;
    END IF;

    SELECT * INTO i FROM public.issues WHERE id=r.issue_id;
    IF FOUND THEN
      UPDATE public.notification_events e
      SET acknowledged_at=coalesce(e.acknowledged_at,now())
      WHERE e.issue_id=i.id
        AND e.critical=false
        AND e.acknowledged_at IS NULL
        AND e.target_user_id IN (
          SELECT p.id FROM public.profiles p
          WHERE p.active=true AND p.role IN ('ADMIN','ADMIN_INVENT','INVENT')
        );

      INSERT INTO public.notification_events(
        issue_id,target_user_id,status,issue_version,title,message,critical,expires_at,reminder_interval_minutes
      )
      SELECT
        i.id,
        p.id,
        i.status,
        i.issue_version,
        'CẦN XỬ LÝ • SKU '||i.sku,
        'SKU '||i.sku||' chưa được xử lí sau '||cfg.reminder_minutes||' phút kể từ lúc báo thiếu.',
        false,
        now()+interval '24 hours',
        greatest(1,cfg.reminder_minutes)
      FROM public.profiles p
      WHERE p.active=true AND p.role IN ('ADMIN','ADMIN_INVENT','INVENT');

      GET DIAGNOSTICS a=ROW_COUNT;
      n:=n+a;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'inventory_notifications_queued',n,
    'inventory_reminder_minutes',cfg.reminder_minutes,
    'auto_skip_enabled',cfg.auto_skip_enabled,
    'auto_skipped',auto_skipped,
    'checked_at',now()
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.worker_schedule_rpc(p_realtime_enabled boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  cfg public.app_config%rowtype;
  next_inventory timestamptz;
  next_auto_skip timestamptz;
  next_sla timestamptz;
  next_critical timestamptz;
  pending_now boolean;
  next_at timestamptz;
BEGIN
  PERFORM public.worker_require_admin();
  SELECT * INTO cfg FROM public.app_config WHERE singleton=true;

  SELECT min(
    CASE
      WHEN i.last_reminded_at IS NULL
        THEN i.first_reported_at+make_interval(mins=>greatest(1,cfg.reminder_minutes))
      ELSE i.last_reminded_at+make_interval(mins=>greatest(1,cfg.reminder_minutes))
    END
  )
  INTO next_inventory
  FROM public.issues i
  WHERE i.status IN ('OPEN','CLAIMED','SEARCHING','REPLENISHING');

  IF cfg.auto_skip_enabled THEN
    SELECT min(i.first_reported_at+make_interval(mins=>greatest(1,cfg.auto_skip_after_minutes)))
    INTO next_auto_skip
    FROM public.issues i
    WHERE i.status IN ('OPEN','CLAIMED','SEARCHING','REPLENISHING');
  END IF;

  next_sla:=least(
    coalesce(next_inventory,'infinity'::timestamptz),
    coalesce(next_auto_skip,'infinity'::timestamptz)
  );
  IF next_sla='infinity'::timestamptz THEN next_sla:=NULL; END IF;

  SELECT min(
    coalesce(e.sent_at,e.created_at)+make_interval(
      mins=>greatest(1,coalesce(e.reminder_interval_minutes,cfg.picker_ack_reminder_minutes))
    )
  )
  INTO next_critical
  FROM public.notification_events e
  WHERE e.critical=true AND e.acknowledged_at IS NULL AND e.expires_at>now();

  SELECT
    exists(SELECT 1 FROM public.sheet_export_queue WHERE exported_at IS NULL)
    OR (coalesce(p_realtime_enabled,false) AND exists(SELECT 1 FROM public.realtime_events WHERE published_at IS NULL))
    OR exists(SELECT 1 FROM public.push_outbox WHERE sent_at IS NULL AND created_at>now()-interval '24 hours')
    OR exists(SELECT 1 FROM public.notification_events WHERE acknowledged_at IS NULL AND expires_at>now() AND sent_at IS NULL)
  INTO pending_now;

  next_at:=least(
    coalesce(next_sla,'infinity'::timestamptz),
    coalesce(next_critical,'infinity'::timestamptz)
  );
  IF next_at='infinity'::timestamptz THEN next_at:=now()+interval '30 minutes'; END IF;
  IF pending_now THEN next_at:=now()+interval '1 minute'; END IF;
  IF next_at<now()+interval '1 minute' THEN next_at:=now()+interval '1 minute'; END IF;
  IF next_at>now()+interval '30 minutes' THEN next_at:=now()+interval '30 minutes'; END IF;

  RETURN jsonb_build_object(
    'pending_now',pending_now,
    'next_at',next_at,
    'next_sla_at',next_sla,
    'next_inventory_at',next_inventory,
    'next_auto_skip_at',next_auto_skip,
    'next_critical_at',next_critical,
    'realtime_enabled',coalesce(p_realtime_enabled,false),
    'max_safety_minutes',30
  );
END
$function$;
