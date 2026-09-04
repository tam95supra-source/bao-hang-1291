-- BÁO HÀNG 1291 — Workflow V3 follow-up corrections.
-- Non-destructive: function replacements/compatibility overload only.
-- SQL-language bodies intentionally contain one statement each so Neon migration tooling can parse them safely.

CREATE OR REPLACE FUNCTION public.api_save_operational_config_rpc(
  p_inventory_reminder_minutes integer,
  p_picker_ack_reminder_minutes integer,
  p_auto_skip_enabled boolean,
  p_auto_skip_after_minutes integer,
  p_test_role text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
WITH auth AS MATERIALIZED (
  SELECT public.require_role_rpc(p_test_role,ARRAY['ADMIN','ADMIN_INVENT']::public.user_role[])
), vals AS MATERIALIZED (
  SELECT
    greatest(1,least(480,coalesce(p_inventory_reminder_minutes,5))) AS inventory_minutes,
    greatest(1,least(60,coalesce(p_picker_ack_reminder_minutes,3))) AS picker_minutes,
    greatest(1,least(4320,coalesce(p_auto_skip_after_minutes,120))) AS auto_minutes
), upd AS (
  UPDATE public.app_config c
  SET acknowledge_minutes=v.inventory_minutes,
      reminder_minutes=v.inventory_minutes,
      replenish_minutes=v.inventory_minutes,
      picker_ack_reminder_minutes=v.picker_minutes,
      found_item_reminder_minutes=v.picker_minutes,
      auto_skip_enabled=coalesce(p_auto_skip_enabled,false),
      auto_skip_after_minutes=v.auto_minutes,
      updated_by=public.app_uid(),
      updated_at=now()
  FROM vals v, auth
  WHERE c.singleton=true
  RETURNING c.singleton
)
SELECT public.api_get_operational_config_rpc(p_test_role) FROM upd LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.process_sla()
RETURNS TABLE(issue_id uuid, event_status public.issue_status, event_kind text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
WITH cfg AS MATERIALIZED (
  SELECT * FROM public.app_config WHERE singleton=true
), due AS MATERIALIZED (
  SELECT
    i.id,
    i.status AS from_status,
    i.first_reported_at,
    i.last_reminded_at,
    c.auto_skip_enabled,
    c.auto_skip_after_minutes,
    c.reminder_minutes,
    c.picker_ack_reminder_minutes,
    i.first_reported_at+make_interval(mins=>c.auto_skip_after_minutes) AS deadline_at,
    (c.auto_skip_enabled AND now()>=i.first_reported_at+make_interval(mins=>c.auto_skip_after_minutes)) AS auto_due,
    (now()>=i.first_reported_at+make_interval(mins=>c.reminder_minutes)
      AND (i.last_reminded_at IS NULL OR now()>=i.last_reminded_at+make_interval(mins=>c.reminder_minutes))) AS reminder_due
  FROM public.issues i CROSS JOIN cfg c
  WHERE i.status IN ('OPEN','CLAIMED','SEARCHING','REPLENISHING')
), auto_u AS (
  UPDATE public.issues i
  SET status='SKIP_ALLOWED',
      claimed_by=NULL,
      claimed_at=NULL,
      resolved_at=d.deadline_at,
      issue_version=i.issue_version+1,
      updated_at=now()
  FROM due d
  WHERE i.id=d.id AND d.auto_due
  RETURNING
    i.id,
    i.sku,
    i.status,
    i.issue_version,
    d.from_status,
    d.deadline_at,
    d.auto_skip_after_minutes,
    d.picker_ack_reminder_minutes,
    public.issue_json(i) AS issue_payload,
    ('Đã quá hạn Inventory xử lí lúc '||to_char(d.deadline_at AT TIME ZONE 'Asia/Bangkok','HH24:MI:SS')) AS note_text
), auto_audit AS (
  INSERT INTO public.issue_audit(issue_id,actor_id,action,from_status,to_status,detail)
  SELECT
    a.id,NULL,'AUTO_SKIP',a.from_status,'SKIP_ALLOWED',
    jsonb_build_object(
      'auto_skip_after_minutes',a.auto_skip_after_minutes,
      'deadline_at',a.deadline_at,
      'note',a.note_text,
      'actor_label','Đã quá hạn Inventory xử lí',
      'issue_version',a.issue_version
    )
  FROM auto_u a
  RETURNING issue_id
), auto_sheet AS (
  INSERT INTO public.sheet_export_queue(event_type,payload)
  SELECT
    'ISSUE_STATUS',
    a.issue_payload||jsonb_build_object(
      'actor_id',NULL,
      'actor_name','Đã quá hạn Inventory xử lí',
      'action','AUTO_SKIP',
      'auto_skip_after_minutes',a.auto_skip_after_minutes,
      'deadline_at',a.deadline_at,
      'note',a.note_text
    )
  FROM auto_u a
  RETURNING id
), auto_ack AS (
  UPDATE public.notification_events e
  SET acknowledged_at=coalesce(e.acknowledged_at,now())
  FROM auto_u a
  WHERE e.issue_id=a.id
    AND e.critical=true
    AND e.acknowledged_at IS NULL
    AND (e.issue_version<>a.issue_version OR e.status::text<>'SKIP_ALLOWED')
  RETURNING e.id
), auto_notify AS (
  INSERT INTO public.notification_events(
    issue_id,target_user_id,status,issue_version,title,message,critical,expires_at,reminder_interval_minutes
  )
  SELECT
    a.id,
    r.reporter_id,
    'SKIP_ALLOWED',
    a.issue_version,
    'ĐƯỢC PHÉP BỎ QUA • SKU '||a.sku,
    'SKU '||a.sku||' đã quá hạn Inventory xử lí. Bạn được phép bỏ qua SKU này và tiếp tục công việc.',
    true,
    now()+interval '24 hours',
    greatest(1,a.picker_ack_reminder_minutes)
  FROM auto_u a
  JOIN LATERAL (
    SELECT DISTINCT ir.reporter_id FROM public.issue_reports ir WHERE ir.issue_id=a.id
  ) r ON true
  ON CONFLICT(target_user_id,issue_id,issue_version,status)
    WHERE critical=true AND issue_id IS NOT NULL
  DO NOTHING
  RETURNING id
), reminder_u AS (
  UPDATE public.issues i
  SET last_reminded_at=now(),updated_at=now()
  FROM due d
  WHERE i.id=d.id AND d.reminder_due AND NOT d.auto_due
  RETURNING i.id,i.status
)
SELECT a.id,a.status,'AUTO_SKIP'::text FROM auto_u a
UNION ALL
SELECT r.id,r.status,'INVENTORY_REMINDER'::text FROM reminder_u r
$function$;

CREATE OR REPLACE FUNCTION public.worker_tick_rpc()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
WITH auth AS MATERIALIZED (
  SELECT public.worker_require_admin()
), cfg AS MATERIALIZED (
  SELECT * FROM public.app_config WHERE singleton=true
), events AS MATERIALIZED (
  SELECT s.* FROM auth CROSS JOIN LATERAL public.process_sla() s
), reminders AS MATERIALIZED (
  SELECT e.issue_id FROM events e WHERE e.event_kind='INVENTORY_REMINDER'
), old_ack AS (
  UPDATE public.notification_events n
  SET acknowledged_at=coalesce(n.acknowledged_at,now())
  WHERE n.critical=false
    AND n.acknowledged_at IS NULL
    AND n.issue_id IN (SELECT issue_id FROM reminders)
    AND n.target_user_id IN (
      SELECT p.id FROM public.profiles p
      WHERE p.active=true AND p.role IN ('ADMIN','ADMIN_INVENT','INVENT')
    )
  RETURNING n.id
), queued AS (
  INSERT INTO public.notification_events(
    issue_id,target_user_id,status,issue_version,title,message,critical,expires_at,reminder_interval_minutes
  )
  SELECT
    i.id,
    p.id,
    i.status,
    i.issue_version,
    'CẦN XỬ LÝ • SKU '||i.sku,
    'SKU '||i.sku||' chưa được xử lí sau '||c.reminder_minutes||' phút kể từ lúc báo thiếu.',
    false,
    now()+interval '24 hours',
    greatest(1,c.reminder_minutes)
  FROM reminders r
  JOIN public.issues i ON i.id=r.issue_id
  CROSS JOIN cfg c
  JOIN public.profiles p ON p.active=true AND p.role IN ('ADMIN','ADMIN_INVENT','INVENT')
  RETURNING id
)
SELECT jsonb_build_object(
  'inventory_notifications_queued',(SELECT count(*) FROM queued),
  'inventory_reminder_minutes',(SELECT reminder_minutes FROM cfg),
  'auto_skip_enabled',(SELECT auto_skip_enabled FROM cfg),
  'auto_skipped',(SELECT count(*) FROM events WHERE event_kind='AUTO_SKIP'),
  'checked_at',now()
)
$function$;

CREATE OR REPLACE FUNCTION public.worker_schedule_rpc(p_realtime_enabled boolean DEFAULT true)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
WITH auth AS MATERIALIZED (
  SELECT public.worker_require_admin()
), cfg AS MATERIALIZED (
  SELECT * FROM public.app_config WHERE singleton=true
), active_times AS (
  SELECT
    min(CASE
      WHEN i.last_reminded_at IS NULL THEN i.first_reported_at+make_interval(mins=>greatest(1,c.reminder_minutes))
      ELSE i.last_reminded_at+make_interval(mins=>greatest(1,c.reminder_minutes))
    END) AS next_inventory,
    min(CASE
      WHEN c.auto_skip_enabled THEN i.first_reported_at+make_interval(mins=>greatest(1,c.auto_skip_after_minutes))
      ELSE NULL
    END) AS next_auto_skip
  FROM public.issues i CROSS JOIN cfg c
  WHERE i.status IN ('OPEN','CLAIMED','SEARCHING','REPLENISHING')
), critical_time AS (
  SELECT min(
    coalesce(e.sent_at,e.created_at)+make_interval(
      mins=>greatest(1,coalesce(e.reminder_interval_minutes,c.picker_ack_reminder_minutes))
    )
  ) AS next_critical
  FROM public.notification_events e CROSS JOIN cfg c
  WHERE e.critical=true AND e.acknowledged_at IS NULL AND e.expires_at>now()
), pending AS (
  SELECT
    exists(SELECT 1 FROM public.sheet_export_queue WHERE exported_at IS NULL)
    OR (coalesce(p_realtime_enabled,false) AND exists(SELECT 1 FROM public.realtime_events WHERE published_at IS NULL))
    OR exists(SELECT 1 FROM public.push_outbox WHERE sent_at IS NULL AND created_at>now()-interval '24 hours')
    OR exists(SELECT 1 FROM public.notification_events WHERE acknowledged_at IS NULL AND expires_at>now() AND sent_at IS NULL)
    AS pending_now
), times AS (
  SELECT
    a.next_inventory,
    a.next_auto_skip,
    c.next_critical,
    p.pending_now,
    least(coalesce(a.next_inventory,'infinity'::timestamptz),coalesce(a.next_auto_skip,'infinity'::timestamptz)) AS next_sla
  FROM active_times a CROSS JOIN critical_time c CROSS JOIN pending p
), final AS (
  SELECT
    t.*,
    greatest(
      now()+interval '1 minute',
      least(
        now()+interval '30 minutes',
        CASE
          WHEN t.pending_now THEN now()+interval '1 minute'
          ELSE least(coalesce(t.next_sla,'infinity'::timestamptz),coalesce(t.next_critical,'infinity'::timestamptz))
        END
      )
    ) AS next_at
  FROM times t
)
SELECT jsonb_build_object(
  'pending_now',f.pending_now,
  'next_at',f.next_at,
  'next_sla_at',CASE WHEN f.next_sla='infinity'::timestamptz THEN NULL ELSE f.next_sla END,
  'next_inventory_at',f.next_inventory,
  'next_auto_skip_at',f.next_auto_skip,
  'next_critical_at',f.next_critical,
  'realtime_enabled',coalesce(p_realtime_enabled,false),
  'max_safety_minutes',30
)
FROM final f CROSS JOIN auth
$function$;
