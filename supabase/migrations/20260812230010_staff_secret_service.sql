-- Server-only lookup for the default password of Google-Sheet-managed staff.
-- The secret value itself is never stored in the public repository.
create or replace function public.get_staff_default_password_service()
returns text language plpgsql security definer set search_path=vault,public as $$
declare v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets
  where name='bao_hang_1291_staff_default_password' order by created_at desc limit 1;
  if coalesce(v_secret,'')='' then raise exception 'STAFF_DEFAULT_PASSWORD_NOT_CONFIGURED'; end if;
  return v_secret;
end $$;
revoke all on function public.get_staff_default_password_service() from public,anon,authenticated;
grant execute on function public.get_staff_default_password_service() to service_role;
