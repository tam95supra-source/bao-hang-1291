-- BÁO HÀNG 1291 — current staff list + safe physical purge of history-free GSHEET profiles.
-- Approved behavior:
-- 1) Management list only returns active/current personnel.
-- 2) Missing source personnel are deactivated first.
-- 3) Physical delete is permitted only for inactive GSHEET profiles with zero FK references.
-- 4) Historical references remain untouched; referenced profiles stay archived/hidden.

CREATE OR REPLACE FUNCTION public.api_list_users_rpc(p_test_role text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  r public.user_role;
BEGIN
  r := public.require_role_rpc(p_test_role, ARRAY['ADMIN','ADMIN_INVENT']::public.user_role[]);
  RETURN jsonb_build_object(
    'users',
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'employee_code', p.employee_code,
          'full_name', p.full_name,
          'contractor', p.contractor,
          'role', p.role,
          'active', p.active,
          'source_kind', p.source_kind,
          'source_position', p.source_position,
          'source_last_seen_at', p.source_last_seen_at,
          'protected_account', p.protected_account,
          'account_kind', p.account_kind
        )
        ORDER BY
          CASE WHEN p.source_kind = 'MANUAL' THEN 0 ELSE 1 END,
          (CASE WHEN p.source_kind = 'MANUAL' THEN '' ELSE COALESCE(p.contractor, '') END) COLLATE "vi-VN-x-icu",
          CASE WHEN p.employee_code ~ '^[0-9]+$' THEN 0 ELSE 1 END,
          CASE WHEN p.employee_code ~ '^[0-9]+$' THEN p.employee_code::numeric END,
          p.employee_code COLLATE "vi-VN-x-icu",
          p.full_name COLLATE "vi-VN-x-icu",
          p.id
      )
      FROM public.profiles p
      WHERE p.active = true
        AND (r = 'ADMIN' OR p.role IN ('INVENT','PICKER'))
    ), '[]'::jsonb)
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.prevent_profile_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF current_setting('bao_hang.allow_profile_purge', true) = '1' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'PROFILE_DELETE_FORBIDDEN_USE_DEACTIVATE';
END
$function$;

CREATE OR REPLACE FUNCTION public.worker_profile_purge_if_orphan_rpc(
  p_id uuid,
  p_execute boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  actor uuid;
  x public.profiles%rowtype;
  ref record;
  has_ref boolean;
BEGIN
  actor := public.worker_require_admin();

  SELECT * INTO x
  FROM public.profiles
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('eligible', false, 'purged', false, 'reason', 'NOT_FOUND');
  END IF;

  IF x.active THEN
    RETURN jsonb_build_object('eligible', false, 'purged', false, 'reason', 'ACTIVE');
  END IF;
  IF x.source_kind <> 'GSHEET' THEN
    RETURN jsonb_build_object('eligible', false, 'purged', false, 'reason', 'NOT_GSHEET');
  END IF;
  IF x.protected_account OR x.role = 'ADMIN' THEN
    RETURN jsonb_build_object('eligible', false, 'purged', false, 'reason', 'PROTECTED');
  END IF;

  FOR ref IN
    SELECT c.conrelid::regclass::text AS table_name, a.attname AS column_name
    FROM pg_constraint c
    JOIN LATERAL unnest(c.conkey) WITH ORDINALITY ck(attnum, ord) ON true
    JOIN LATERAL unnest(c.confkey) WITH ORDINALITY fk(attnum, ord) ON fk.ord = ck.ord
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ck.attnum
    JOIN pg_attribute ra ON ra.attrelid = c.confrelid AND ra.attnum = fk.attnum
    WHERE c.contype = 'f'
      AND c.confrelid = 'public.profiles'::regclass
      AND ra.attname = 'id'
    ORDER BY c.conrelid::regclass::text, a.attname
  LOOP
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM %s WHERE %I = $1)',
      ref.table_name,
      ref.column_name
    ) INTO has_ref USING p_id;

    IF has_ref THEN
      RETURN jsonb_build_object(
        'eligible', false,
        'purged', false,
        'reason', 'REFERENCED',
        'reference_table', ref.table_name,
        'reference_column', ref.column_name
      );
    END IF;
  END LOOP;

  IF NOT p_execute THEN
    RETURN jsonb_build_object(
      'eligible', true,
      'purged', false,
      'reason', 'ORPHAN',
      'employee_code', x.employee_code
    );
  END IF;

  PERFORM set_config('bao_hang.allow_profile_purge', '1', true);
  DELETE FROM public.profiles WHERE id = p_id;

  INSERT INTO public.security_audit(actor_id, action, target_kind, target_id, detail)
  VALUES (
    actor,
    'PROFILE_PURGE_ORPHAN',
    'PROFILE',
    p_id::text,
    jsonb_build_object(
      'employee_code', x.employee_code,
      'full_name', x.full_name,
      'source_kind', x.source_kind,
      'reason', 'INACTIVE_GSHEET_NO_REFERENCES'
    )
  );

  RETURN jsonb_build_object(
    'eligible', true,
    'purged', true,
    'reason', 'PURGED',
    'employee_code', x.employee_code
  );
END
$function$;
