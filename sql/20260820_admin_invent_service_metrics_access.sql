-- BÁO HÀNG 1291
-- ADMIN_INVENT must be able to load the shared operational/service metrics used by
-- both "Tổng quan hôm nay" and "Nhân sự & tài khoản".
-- This function is read-only (STABLE) and exposes only the existing free-tier
-- operational metrics already rendered in the Web Admin UI.

create or replace function public.api_service_metrics_rpc(p_test_role text default null::text)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare u jsonb;
begin
  perform public.require_role_rpc(
    p_test_role,
    array['ADMIN','ADMIN_INVENT']::public.user_role[]
  );

  u := public.service_usage_snapshot();

  return jsonb_build_object(
    'provider','NEON_FREE',
    'region','aws-ap-southeast-1',
    'billing_enabled',false,
    'usage',u,
    'free_limits',jsonb_build_object(
      'database_bytes',536870912,
      'compute_hours_month',100,
      'projects',100
    ),
    'firebase',jsonb_build_object(
      'project','bao-hang-1291',
      'billing_enabled',false
    ),
    'captured_at',now()
  );
end
$function$;
