-- BÁO HÀNG 1291 — production-applied 2026-08-19
-- Allows ADMIN / ADMIN_INVENT to create a MANUAL profile after Firebase Auth
-- account creation. ADMIN_INVENT may create INVENT / PICKER only.

CREATE OR REPLACE FUNCTION public.api_admin_create_profile_rpc(
  p_user_id uuid,
  p_employee_code text,
  p_full_name text,
  p_role public.user_role,
  p_contractor text DEFAULT ''::text,
  p_source_position text DEFAULT ''::text,
  p_test_role text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  actor uuid := public.app_uid();
  caller public.user_role;
  x public.profiles%rowtype;
  code text := trim(coalesce(p_employee_code,''));
BEGIN
  caller := public.require_role_rpc(p_test_role, array['ADMIN','ADMIN_INVENT']::public.user_role[]);
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'USER_ID_REQUIRED'; END IF;
  IF code='' OR lower(code)!~'^[a-z0-9._-]+$' THEN RAISE EXCEPTION 'INVALID_EMPLOYEE_CODE'; END IF;
  IF trim(coalesce(p_full_name,''))='' THEN RAISE EXCEPTION 'FULL_NAME_REQUIRED'; END IF;
  IF code='6281280' OR p_role='ADMIN' THEN RAISE EXCEPTION 'PROTECTED_ADMIN_RESERVED'; END IF;
  IF caller='ADMIN_INVENT' AND p_role NOT IN ('INVENT','PICKER') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF caller='ADMIN' AND p_role NOT IN ('ADMIN_INVENT','INVENT','PICKER') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF EXISTS(SELECT 1 FROM public.profiles p WHERE lower(p.employee_code)=lower(code)) THEN RAISE EXCEPTION 'EMPLOYEE_CODE_EXISTS'; END IF;

  INSERT INTO public.profiles(
    id,employee_code,full_name,contractor,role,active,source_kind,
    source_position,source_last_seen_at,protected_account,account_kind,updated_at
  ) VALUES(
    p_user_id,code,trim(p_full_name),coalesce(p_contractor,''),p_role,true,'MANUAL',
    coalesce(p_source_position,''),NULL,false,'PERSONNEL',now()
  ) RETURNING * INTO x;

  INSERT INTO public.security_audit(actor_id,action,target_kind,target_id,detail)
  VALUES(actor,'PROFILE_CREATE_MANUAL','PROFILE',x.id::text,
    jsonb_build_object('employee_code',x.employee_code,'role',x.role,'source_kind',x.source_kind));

  INSERT INTO public.sheet_export_queue(event_type,payload,actor_account_id,actor_role,sku,issue_id,issue_version)
  VALUES('USER_UPSERT',jsonb_build_object(
    'id',x.id,'employee_code',x.employee_code,'full_name',x.full_name,
    'contractor',x.contractor,'role',x.role,'active',x.active,'updated_at',x.updated_at
  ),actor,caller,NULL,NULL,NULL);

  RETURN to_jsonb(x);
END
$function$;

REVOKE ALL ON FUNCTION public.api_admin_create_profile_rpc(uuid,text,text,public.user_role,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.api_admin_create_profile_rpc(uuid,text,text,public.user_role,text,text,text) TO authenticated;
