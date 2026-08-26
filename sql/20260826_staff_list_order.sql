create or replace function public.api_list_users_rpc(p_test_role text default null::text)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  r public.user_role;
begin
  r := public.require_role_rpc(p_test_role, array['ADMIN','ADMIN_INVENT']::public.user_role[]);
  return jsonb_build_object(
    'users',
    coalesce((
      select jsonb_agg(
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
        order by
          case when p.source_kind = 'MANUAL' then 0 when p.active then 1 else 2 end,
          (case when p.source_kind = 'MANUAL' then '' else coalesce(p.contractor, '') end) collate "vi-VN-x-icu",
          case when p.employee_code ~ '^[0-9]+$' then 0 else 1 end,
          case when p.employee_code ~ '^[0-9]+$' then p.employee_code::numeric end,
          p.employee_code collate "vi-VN-x-icu",
          p.full_name collate "vi-VN-x-icu",
          p.id
      )
      from public.profiles p
      where r = 'ADMIN' or p.role in ('INVENT','PICKER')
    ), '[]'::jsonb)
  );
end
$function$;

-- Business order is intentionally centralized in the API so every client sees:
-- 1) MANUAL / "Tạo thêm" first, ordered by employee code.
-- 2) Active source staff next, ordered by contractor -> employee code -> full name.
-- 3) Inactive source staff last, with the same contractor -> employee code -> full name order.
