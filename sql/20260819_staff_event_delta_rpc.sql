-- BÁO HÀNG 1291 — event-driven staff synchronization helper.
-- Public repo safe: contains schema/function logic only; no credentials.
-- Applied live on Neon project tiny-boat-19315489 before this migration record was committed.

create or replace function public.worker_profiles_by_codes_rpc(p_codes text[])
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  perform public.worker_require_admin();
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', id,
        'employee_code', employee_code,
        'full_name', full_name,
        'contractor', contractor,
        'role', role,
        'active', active,
        'source_kind', source_kind,
        'source_position', source_position,
        'protected_account', protected_account,
        'source_last_seen_at', source_last_seen_at
      ) order by employee_code
    )
    from public.profiles
    where employee_code = any(coalesce(p_codes, array[]::text[]))
  ), '[]'::jsonb);
end
$$;

revoke all on function public.worker_profiles_by_codes_rpc(text[]) from public;
grant execute on function public.worker_profiles_by_codes_rpc(text[]) to authenticated;
