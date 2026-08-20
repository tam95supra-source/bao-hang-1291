-- BÁO HÀNG 1291 — personnel source/role invariants.
-- Business rules:
-- 1) DANH SÁCH NHÂN SỰ / GSHEET personnel are always PICKER.
-- 2) Elevated INVENT / ADMIN_INVENT accounts are MANUAL-only.
-- 3) Profiles are never physically deleted; disable/deactivate preserves history references.

CREATE OR REPLACE FUNCTION public.worker_profile_upsert_rpc(
  p_id uuid,
  p_employee_code text,
  p_full_name text,
  p_contractor text,
  p_role public.user_role,
  p_active boolean,
  p_source_kind text DEFAULT 'MANUAL'::text,
  p_source_position text DEFAULT ''::text,
  p_protected_account boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  actor uuid;
  x public.profiles%rowtype;
  existing public.profiles%rowtype;
  code text := trim(p_employee_code);
  protected boolean := coalesce(p_protected_account, false);
BEGIN
  actor := public.worker_require_admin();
  IF code = '' OR lower(code) !~ '^[a-z0-9._-]+$' THEN
    RAISE EXCEPTION 'INVALID_EMPLOYEE_CODE';
  END IF;
  IF p_source_kind NOT IN ('MANUAL', 'GSHEET') THEN
    RAISE EXCEPTION 'INVALID_SOURCE_KIND';
  END IF;

  SELECT * INTO existing FROM public.profiles WHERE id = p_id;
  IF FOUND AND existing.source_kind = 'GSHEET' AND p_source_kind = 'MANUAL' THEN
    RAISE EXCEPTION 'GSHEET_PROFILE_SOURCE_LOCKED';
  END IF;

  IF code = '6281280' THEN
    protected := true;
    p_role := 'ADMIN';
    p_active := true;
    p_source_kind := 'MANUAL';
  ELSIF protected OR p_role = 'ADMIN' THEN
    RAISE EXCEPTION 'PROTECTED_ADMIN_RESERVED';
  END IF;

  IF p_source_kind = 'GSHEET' THEN
    p_role := 'PICKER';
    protected := false;
  END IF;

  INSERT INTO public.profiles(
    id, employee_code, full_name, contractor, role, active,
    source_kind, source_position, source_last_seen_at,
    protected_account, account_kind, updated_at
  ) VALUES (
    p_id, code, trim(p_full_name), coalesce(p_contractor, ''), p_role, coalesce(p_active, true),
    p_source_kind, coalesce(p_source_position, ''), CASE WHEN p_source_kind = 'GSHEET' THEN now() ELSE NULL END,
    protected, 'PERSONNEL', now()
  )
  ON CONFLICT (id) DO UPDATE SET
    employee_code = excluded.employee_code,
    full_name = excluded.full_name,
    contractor = excluded.contractor,
    role = excluded.role,
    active = excluded.active,
    source_kind = excluded.source_kind,
    source_position = excluded.source_position,
    source_last_seen_at = CASE WHEN excluded.source_kind = 'GSHEET' THEN now() ELSE public.profiles.source_last_seen_at END,
    protected_account = excluded.protected_account,
    updated_at = now()
  RETURNING * INTO x;

  INSERT INTO public.security_audit(actor_id, action, target_kind, target_id, detail)
  VALUES (
    actor, 'PROFILE_UPSERT', 'PROFILE', x.id::text,
    jsonb_build_object('employee_code', x.employee_code, 'role', x.role, 'active', x.active, 'source_kind', x.source_kind)
  );

  INSERT INTO public.sheet_export_queue(event_type, payload, actor_account_id, actor_role, sku, issue_id, issue_version)
  VALUES (
    'USER_UPSERT',
    jsonb_build_object(
      'id', x.id, 'employee_code', x.employee_code, 'full_name', x.full_name,
      'contractor', x.contractor, 'role', x.role, 'active', x.active, 'updated_at', x.updated_at
    ),
    actor, 'ADMIN', NULL, NULL, NULL
  );

  RETURN to_jsonb(x);
END
$function$;

UPDATE public.profiles
SET role = 'PICKER'::public.user_role,
    updated_at = now()
WHERE source_kind = 'GSHEET'
  AND role <> 'PICKER'::public.user_role;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_gsheet_picker_only'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_gsheet_picker_only
      CHECK (source_kind <> 'GSHEET' OR role = 'PICKER'::public.user_role)
      NOT VALID;
  END IF;
END
$do$;

ALTER TABLE public.profiles
  VALIDATE CONSTRAINT profiles_gsheet_picker_only;

CREATE OR REPLACE FUNCTION public.prevent_profile_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  RAISE EXCEPTION 'PROFILE_DELETE_FORBIDDEN_USE_DEACTIVATE';
END
$function$;

DROP TRIGGER IF EXISTS profiles_no_physical_delete ON public.profiles;
CREATE TRIGGER profiles_no_physical_delete
BEFORE DELETE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.prevent_profile_delete();
