-- BÁO HÀNG 1291 — E2E cleanup must preserve the complete active GSHEET staff set.
-- Replaces the stale hard-coded employee 10060 sentinel, which is no longer in the current source.
-- Preservation is checked by both count and deterministic id+employee_code hash before/after cleanup.

CREATE OR REPLACE FUNCTION public.e2e_final_guard_rpc()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  actor uuid;
  hdr jsonb := coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
  seed_mode boolean := coalesce(hdr->>'x-e2e-seed','')='final-1291';
  inventory_mode boolean := coalesce(hdr->>'x-e2e-inventory','')='final-1291';
  cleanup_mode boolean := coalesce(hdr->>'x-e2e-cleanup','')='final-1291';
  ids uuid[] := ARRAY[
    '12910000-0000-4000-8000-00000000e2e1'::uuid,
    '12910000-0000-4000-8000-00000000e2e2'::uuid,
    '12910000-0000-4000-8000-00000000e2e3'::uuid,
    '12910000-0000-4000-8000-00000000e2e4'::uuid
  ];
  skus text[] := ARRAY['99001291','99001292'];
  issue_ids uuid[] := ARRAY[]::uuid[];
  manifest jsonb;
  report_ids uuid[] := ARRAY[]::uuid[];
  audit_ids bigint[] := ARRAY[]::bigint[];
  authority_ids uuid[] := ARRAY[]::uuid[];
  notification_ids uuid[] := ARRAY[]::uuid[];
  push_ids uuid[] := ARRAY[]::uuid[];
  realtime_ids bigint[] := ARRAY[]::bigint[];
  sheet_ids bigint[] := ARRAY[]::bigint[];
  mutation_ids uuid[] := ARRAY[]::uuid[];
  security_ids bigint[] := ARRAY[]::bigint[];
  conflict_ids uuid[] := ARRAY[]::uuid[];
  n_authority int:=0; n_conflict int:=0; n_sheet int:=0; n_mut int:=0; n_sec int:=0; n_rt int:=0; n_notif int:=0; n_push int:=0; n_audit int:=0; n_report int:=0; n_coalesce int:=0; n_issue int:=0; n_sku int:=0; n_profile int:=0;
  r_sku bigint; r_profile bigint; r_report bigint; r_owner bigint; r_event bigint; r_notification bigint; r_realtime bigint; real_ok boolean; real_active_before bigint; real_active_after bigint; real_active_hash_before text; real_active_hash_after text;
BEGIN
  actor:=public.worker_require_admin();
  IF actor<>'44fae0a2-09eb-4226-8412-0f1a1f5d7ef8'::uuid THEN RAISE EXCEPTION 'FINAL_GATE_ADMIN_MISMATCH'; END IF;

  SELECT count(*),
         md5(coalesce(string_agg(p.id::text || ':' || p.employee_code, ',' ORDER BY p.id), ''))
    INTO real_active_before, real_active_hash_before
  FROM public.profiles p
  WHERE p.active=true
    AND p.source_kind='GSHEET'
    AND p.id<>ALL(ids);
  IF real_active_before < 1 THEN RAISE EXCEPTION 'REAL_ACTIVE_GSHEET_GUARD_FAILED'; END IF;
  real_ok := true;

  IF EXISTS(SELECT 1 FROM public.profiles p WHERE (p.id=ANY(ids) OR lower(p.employee_code)=ANY(ARRAY['e2eweb1291','e2epicker2','e2einvent','e2eadmininvent'])) AND NOT(
      (p.id='12910000-0000-4000-8000-00000000e2e1'::uuid AND lower(p.employee_code)='e2eweb1291' AND p.full_name='__E2E_PICKER_1__' AND p.role='PICKER' AND p.protected_account=false AND p.source_kind='MANUAL' AND p.source_position='E2E') OR
      (p.id='12910000-0000-4000-8000-00000000e2e2'::uuid AND lower(p.employee_code)='e2epicker2' AND p.full_name='__E2E_PICKER_2__' AND p.role='PICKER' AND p.protected_account=false AND p.source_kind='MANUAL' AND p.source_position='E2E') OR
      (p.id='12910000-0000-4000-8000-00000000e2e3'::uuid AND lower(p.employee_code)='e2einvent' AND p.full_name='__E2E_INVENT__' AND p.role='INVENT' AND p.protected_account=false AND p.source_kind='MANUAL' AND p.source_position='E2E') OR
      (p.id='12910000-0000-4000-8000-00000000e2e4'::uuid AND lower(p.employee_code)='e2eadmininvent' AND p.full_name='__E2E_ADMIN_INVENT__' AND p.role='ADMIN_INVENT' AND p.protected_account=false AND p.source_kind='MANUAL' AND p.source_position='E2E')
  )) THEN RAISE EXCEPTION 'E2E_PROFILE_MARKER_MISMATCH'; END IF;

  IF EXISTS(SELECT 1 FROM public.sku_catalog s WHERE s.sku=ANY(skus) AND NOT((s.sku='99001291' AND s.product_name='__E2E_WEB_REALTIME_AVAILABLE_20260825__') OR (s.sku='99001292' AND s.product_name='__E2E_WEB_REALTIME_SKIP_20260825__'))) THEN RAISE EXCEPTION 'E2E_SKU_MARKER_MISMATCH'; END IF;
  IF EXISTS(SELECT 1 FROM public.issues i WHERE i.sku=ANY(skus) AND NOT((i.sku='99001291' AND i.product_name_snapshot='__E2E_WEB_REALTIME_AVAILABLE_20260825__') OR (i.sku='99001292' AND i.product_name_snapshot='__E2E_WEB_REALTIME_SKIP_20260825__'))) THEN RAISE EXCEPTION 'E2E_ISSUE_MARKER_MISMATCH'; END IF;
  IF EXISTS(SELECT 1 FROM public.issue_reports r JOIN public.issues i ON i.id=r.issue_id WHERE i.sku=ANY(skus) AND r.reporter_id<>ALL(ids)) THEN RAISE EXCEPTION 'E2E_NONTEST_REPORTER'; END IF;
  IF EXISTS(SELECT 1 FROM public.app_config WHERE updated_by=ANY(ids)) OR EXISTS(SELECT 1 FROM public.catalog_imports WHERE imported_by=ANY(ids)) OR EXISTS(SELECT 1 FROM public.inventory_snapshots WHERE requested_by=ANY(ids)) OR EXISTS(SELECT 1 FROM public.inventory_sync_audit WHERE actor_id=ANY(ids)) OR EXISTS(SELECT 1 FROM public.inventory_sync_jobs WHERE requested_by=ANY(ids)) OR EXISTS(SELECT 1 FROM public.reconciliation_conflicts WHERE resolved_by=ANY(ids)) OR EXISTS(SELECT 1 FROM public.staff_sync_runs WHERE requested_by=ANY(ids)) OR EXISTS(SELECT 1 FROM public.backup_accounts WHERE created_by=ANY(ids)) OR EXISTS(SELECT 1 FROM public.backup_account_audit WHERE actor_id=ANY(ids)) THEN RAISE EXCEPTION 'E2E_PROFILE_HAS_NONTEST_REFERENCE'; END IF;

  IF seed_mode THEN
    INSERT INTO public.profiles(id,employee_code,full_name,contractor,role,active,source_kind,source_position,source_last_seen_at,protected_account,account_kind,updated_at) VALUES
      ('12910000-0000-4000-8000-00000000e2e1'::uuid,'e2eweb1291','__E2E_PICKER_1__','E2E','PICKER',true,'MANUAL','E2E',NULL,false,'PERSONNEL',now()),
      ('12910000-0000-4000-8000-00000000e2e2'::uuid,'e2epicker2','__E2E_PICKER_2__','E2E','PICKER',true,'MANUAL','E2E',NULL,false,'PERSONNEL',now()),
      ('12910000-0000-4000-8000-00000000e2e3'::uuid,'e2einvent','__E2E_INVENT__','E2E','INVENT',true,'MANUAL','E2E',NULL,false,'PERSONNEL',now()),
      ('12910000-0000-4000-8000-00000000e2e4'::uuid,'e2eadmininvent','__E2E_ADMIN_INVENT__','E2E','ADMIN_INVENT',true,'MANUAL','E2E',NULL,false,'PERSONNEL',now())
    ON CONFLICT(id) DO UPDATE SET employee_code=excluded.employee_code,full_name=excluded.full_name,contractor=excluded.contractor,role=excluded.role,active=true,source_kind='MANUAL',source_position='E2E',source_last_seen_at=NULL,protected_account=false,account_kind='PERSONNEL',updated_at=now();
    INSERT INTO public.sku_catalog(sku,product_name,active,last_imported_at,updated_at) VALUES
      ('99001291','__E2E_WEB_REALTIME_AVAILABLE_20260825__',true,now(),now()),
      ('99001292','__E2E_WEB_REALTIME_SKIP_20260825__',true,now(),now())
    ON CONFLICT(sku) DO UPDATE SET product_name=excluded.product_name,active=true,last_imported_at=now(),updated_at=now();
    RETURN jsonb_build_object('ok',true,'mode','seed','profiles_seeded',4,'skus_seeded',2,'real_active_gsheet_preserved',true,'real_active_gsheet_count',real_active_before);
  END IF;

  SELECT coalesce(array_agg(i.id ORDER BY i.id),ARRAY[]::uuid[]) INTO issue_ids FROM public.issues i WHERE (i.sku='99001291' AND i.product_name_snapshot='__E2E_WEB_REALTIME_AVAILABLE_20260825__') OR (i.sku='99001292' AND i.product_name_snapshot='__E2E_WEB_REALTIME_SKIP_20260825__');

  IF inventory_mode THEN
    RETURN jsonb_build_object(
      'ok',true,'mode','inventory','profile_ids',to_jsonb(ids),'firebase_uids',to_jsonb(ids),'skus',to_jsonb(skus),'issue_ids',to_jsonb(issue_ids),
      'report_ids',(SELECT coalesce(jsonb_agg(r.id ORDER BY r.id),'[]'::jsonb) FROM public.issue_reports r WHERE r.issue_id=ANY(issue_ids) OR r.reporter_id=ANY(ids)),
      'audit_ids',(SELECT coalesce(jsonb_agg(a.id ORDER BY a.id),'[]'::jsonb) FROM public.issue_audit a WHERE a.issue_id=ANY(issue_ids) OR a.actor_id=ANY(ids)),
      'authority_event_ids',(SELECT coalesce(jsonb_agg(a.event_id ORDER BY a.event_id),'[]'::jsonb) FROM public.authority_events a WHERE a.issue_id=ANY(issue_ids) OR a.sku=ANY(skus) OR a.actor_account_id=ANY(ids)),
      'notification_ids',(SELECT coalesce(jsonb_agg(n.id ORDER BY n.id),'[]'::jsonb) FROM public.notification_events n WHERE n.issue_id=ANY(issue_ids) OR n.target_user_id=ANY(ids)),
      'push_outbox_ids',(SELECT coalesce(jsonb_agg(p.id ORDER BY p.id),'[]'::jsonb) FROM public.push_outbox p WHERE p.issue_id=ANY(issue_ids) OR p.target_user_id=ANY(ids)),
      'realtime_event_ids',(SELECT coalesce(jsonb_agg(r.id ORDER BY r.id),'[]'::jsonb) FROM public.realtime_events r WHERE r.entity_id=ANY(ARRAY(SELECT x::text FROM unnest(issue_ids) x)) OR r.entity_id=ANY(ARRAY(SELECT x::text FROM unnest(ids) x)) OR r.payload->>'sku'=ANY(skus) OR r.payload->>'employee_code'=ANY(ARRAY['e2eweb1291','e2epicker2','e2einvent','e2eadmininvent'])),
      'sheet_queue_ids',(SELECT coalesce(jsonb_agg(q.id ORDER BY q.id),'[]'::jsonb) FROM public.sheet_export_queue q WHERE q.issue_id=ANY(issue_ids) OR q.sku=ANY(skus) OR q.actor_account_id=ANY(ids) OR q.payload->>'reporter_id'=ANY(ARRAY(SELECT x::text FROM unnest(ids) x))),
      'mutation_request_ids',(SELECT coalesce(jsonb_agg(m.client_request_id ORDER BY m.client_request_id),'[]'::jsonb) FROM public.mutation_requests m WHERE m.issue_id=ANY(issue_ids) OR m.actor_id=ANY(ids)),
      'security_audit_ids',(SELECT coalesce(jsonb_agg(s.id ORDER BY s.id),'[]'::jsonb) FROM public.security_audit s WHERE s.actor_id=ANY(ids) OR s.target_id=ANY(ARRAY(SELECT x::text FROM unnest(ids) x))),
      'conflict_event_ids',(SELECT coalesce(jsonb_agg(c.event_id ORDER BY c.event_id),'[]'::jsonb) FROM public.reconciliation_conflicts c WHERE c.issue_id=ANY(issue_ids) OR c.sku=ANY(skus) OR c.actor_account_id=ANY(ids)),
      'real_active_gsheet_preserved',true,'real_active_gsheet_count',real_active_before
    );
  END IF;

  IF cleanup_mode THEN
    manifest := nullif(hdr->>'x-e2e-manifest','')::jsonb;
    IF manifest IS NULL OR jsonb_typeof(manifest)<>'object' THEN RAISE EXCEPTION 'E2E_MANIFEST_REQUIRED'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(manifest->'profile_ids','[]'::jsonb)) x WHERE x::uuid<>ALL(ids)) THEN RAISE EXCEPTION 'E2E_MANIFEST_PROFILE_SCOPE'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(manifest->'skus','[]'::jsonb)) x WHERE x<>ALL(skus)) THEN RAISE EXCEPTION 'E2E_MANIFEST_SKU_SCOPE'; END IF;
    issue_ids := ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(coalesce(manifest->'issue_ids','[]'::jsonb)));
    report_ids := ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(coalesce(manifest->'report_ids','[]'::jsonb)));
    audit_ids := ARRAY(SELECT value::bigint FROM jsonb_array_elements_text(coalesce(manifest->'audit_ids','[]'::jsonb)));
    authority_ids := ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(coalesce(manifest->'authority_event_ids','[]'::jsonb)));
    notification_ids := ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(coalesce(manifest->'notification_ids','[]'::jsonb)));
    push_ids := ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(coalesce(manifest->'push_outbox_ids','[]'::jsonb)));
    realtime_ids := ARRAY(SELECT value::bigint FROM jsonb_array_elements_text(coalesce(manifest->'realtime_event_ids','[]'::jsonb)));
    sheet_ids := ARRAY(SELECT value::bigint FROM jsonb_array_elements_text(coalesce(manifest->'sheet_queue_ids','[]'::jsonb)));
    mutation_ids := ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(coalesce(manifest->'mutation_request_ids','[]'::jsonb)));
    security_ids := ARRAY(SELECT value::bigint FROM jsonb_array_elements_text(coalesce(manifest->'security_audit_ids','[]'::jsonb)));
    conflict_ids := ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(coalesce(manifest->'conflict_event_ids','[]'::jsonb)));

    IF EXISTS(SELECT 1 FROM public.issues i WHERE ((i.sku='99001291' AND i.product_name_snapshot='__E2E_WEB_REALTIME_AVAILABLE_20260825__') OR (i.sku='99001292' AND i.product_name_snapshot='__E2E_WEB_REALTIME_SKIP_20260825__')) AND NOT(i.id=ANY(issue_ids))) THEN RAISE EXCEPTION 'E2E_MANIFEST_MISSING_LIVE_ISSUE'; END IF;
    IF EXISTS(SELECT 1 FROM public.issues i WHERE i.id=ANY(issue_ids) AND NOT((i.sku='99001291' AND i.product_name_snapshot='__E2E_WEB_REALTIME_AVAILABLE_20260825__') OR (i.sku='99001292' AND i.product_name_snapshot='__E2E_WEB_REALTIME_SKIP_20260825__'))) THEN RAISE EXCEPTION 'E2E_MANIFEST_ISSUE_MARKER_MISMATCH'; END IF;
    IF EXISTS(SELECT 1 FROM public.issue_reports r WHERE r.issue_id=ANY(issue_ids) AND r.reporter_id<>ALL(ids)) THEN RAISE EXCEPTION 'E2E_MANIFEST_NONTEST_REPORTER'; END IF;

    DELETE FROM public.authority_events WHERE event_id=ANY(authority_ids); GET DIAGNOSTICS n_authority=ROW_COUNT;
    DELETE FROM public.reconciliation_conflicts WHERE event_id=ANY(conflict_ids); GET DIAGNOSTICS n_conflict=ROW_COUNT;
    DELETE FROM public.sheet_export_queue WHERE id=ANY(sheet_ids); GET DIAGNOSTICS n_sheet=ROW_COUNT;
    DELETE FROM public.mutation_requests WHERE client_request_id=ANY(mutation_ids); GET DIAGNOSTICS n_mut=ROW_COUNT;
    DELETE FROM public.security_audit WHERE id=ANY(security_ids); GET DIAGNOSTICS n_sec=ROW_COUNT;
    DELETE FROM public.realtime_events WHERE id=ANY(realtime_ids); GET DIAGNOSTICS n_rt=ROW_COUNT;
    DELETE FROM public.notification_events WHERE id=ANY(notification_ids); GET DIAGNOSTICS n_notif=ROW_COUNT;
    DELETE FROM public.push_outbox WHERE id=ANY(push_ids); GET DIAGNOSTICS n_push=ROW_COUNT;
    DELETE FROM public.realtime_issue_coalesce WHERE issue_id=ANY(issue_ids); GET DIAGNOSTICS n_coalesce=ROW_COUNT;
    DELETE FROM public.issue_audit WHERE id=ANY(audit_ids); GET DIAGNOSTICS n_audit=ROW_COUNT;
    DELETE FROM public.issue_reports WHERE id=ANY(report_ids); GET DIAGNOSTICS n_report=ROW_COUNT;
    DELETE FROM public.issues WHERE id=ANY(issue_ids); GET DIAGNOSTICS n_issue=ROW_COUNT;
    DELETE FROM public.sku_catalog WHERE (sku='99001291' AND product_name='__E2E_WEB_REALTIME_AVAILABLE_20260825__') OR (sku='99001292' AND product_name='__E2E_WEB_REALTIME_SKIP_20260825__'); GET DIAGNOSTICS n_sku=ROW_COUNT;
    PERFORM set_config('bao_hang.allow_profile_purge','1',true);
    DELETE FROM public.profiles WHERE id=ANY(ids) AND protected_account=false AND source_kind='MANUAL' AND source_position='E2E' AND contractor='E2E'; GET DIAGNOSTICS n_profile=ROW_COUNT;

    SELECT count(*) INTO r_sku FROM public.sku_catalog WHERE sku=ANY(skus);
    SELECT count(*) INTO r_profile FROM public.profiles WHERE id=ANY(ids);
    SELECT count(*) INTO r_report FROM public.issue_reports r WHERE r.reporter_id=ANY(ids) OR r.id=ANY(report_ids);
    SELECT count(*) INTO r_owner FROM public.issues WHERE claimed_by=ANY(ids) OR id=ANY(issue_ids) OR sku=ANY(skus);
    SELECT (SELECT count(*) FROM public.issue_audit a WHERE a.actor_id=ANY(ids) OR a.id=ANY(audit_ids))+(SELECT count(*) FROM public.authority_events a WHERE a.actor_account_id=ANY(ids) OR a.event_id=ANY(authority_ids) OR a.sku=ANY(skus))+(SELECT count(*) FROM public.mutation_requests m WHERE m.actor_id=ANY(ids) OR m.client_request_id=ANY(mutation_ids))+(SELECT count(*) FROM public.sheet_export_queue q WHERE q.actor_account_id=ANY(ids) OR q.id=ANY(sheet_ids) OR q.sku=ANY(skus))+(SELECT count(*) FROM public.reconciliation_conflicts c WHERE c.actor_account_id=ANY(ids) OR c.event_id=ANY(conflict_ids) OR c.sku=ANY(skus))+(SELECT count(*) FROM public.security_audit s WHERE s.actor_id=ANY(ids) OR s.id=ANY(security_ids) OR s.target_id=ANY(ARRAY(SELECT x::text FROM unnest(ids) x))) INTO r_event;
    SELECT (SELECT count(*) FROM public.notification_events n WHERE n.target_user_id=ANY(ids) OR n.id=ANY(notification_ids))+(SELECT count(*) FROM public.push_outbox p WHERE p.target_user_id=ANY(ids) OR p.id=ANY(push_ids)) INTO r_notification;
    SELECT (SELECT count(*) FROM public.realtime_events r WHERE r.id=ANY(realtime_ids) OR r.entity_id=ANY(ARRAY(SELECT x::text FROM unnest(ids) x)) OR r.payload->>'sku'=ANY(skus) OR r.payload->>'employee_code'=ANY(ARRAY['e2eweb1291','e2epicker2','e2einvent','e2eadmininvent']))+(SELECT count(*) FROM public.realtime_issue_coalesce z WHERE z.issue_id=ANY(issue_ids)) INTO r_realtime;
    SELECT count(*),
           md5(coalesce(string_agg(p.id::text || ':' || p.employee_code, ',' ORDER BY p.id), ''))
      INTO real_active_after, real_active_hash_after
    FROM public.profiles p
    WHERE p.active=true
      AND p.source_kind='GSHEET'
      AND p.id<>ALL(ids);
    real_ok := real_active_after = real_active_before
      AND real_active_hash_after = real_active_hash_before;

    RETURN jsonb_build_object('ok',(r_sku+r_profile+r_report+r_owner+r_event+r_notification+r_realtime)=0 AND real_ok,'mode','cleanup','deleted',jsonb_build_object('authority_events',n_authority,'conflicts',n_conflict,'sheet_queue',n_sheet,'mutation_requests',n_mut,'security_audit',n_sec,'realtime_events',n_rt,'notifications',n_notif,'push_outbox',n_push,'realtime_coalesce',n_coalesce,'issue_audit',n_audit,'issue_reports',n_report,'issues',n_issue,'skus',n_sku,'profiles',n_profile),'remaining',jsonb_build_object('test_sku_remaining',r_sku,'test_profile_remaining',r_profile,'test_report_remaining',r_report,'test_ownership_remaining',r_owner,'test_event_remaining',r_event,'test_notification_remaining',r_notification,'test_realtime_signal_remaining',r_realtime),'real_active_gsheet_preserved',real_ok,'real_active_gsheet_count',real_active_after);
  END IF;

  RETURN jsonb_build_object('ok',true,'mode','guard','real_active_gsheet_preserved',true,'real_active_gsheet_count',real_active_before);
END
$function$
;
