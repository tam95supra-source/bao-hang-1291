revoke all on function public.withdraw_shortage_atomic(uuid,uuid) from public;
revoke all on function public.withdraw_shortage_atomic(uuid,uuid) from anon;
revoke all on function public.withdraw_shortage_atomic(uuid,uuid) from authenticated;
grant execute on function public.withdraw_shortage_atomic(uuid,uuid) to service_role;
