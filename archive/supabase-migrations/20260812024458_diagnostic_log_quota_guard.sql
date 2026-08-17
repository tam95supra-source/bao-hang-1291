create or replace function public.enforce_diagnostic_log_quota()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_total bigint;
  v_user_24h bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('bao_hang_1291_diagnostic_log_quota',1291));
  select coalesce(sum(compressed_bytes),0) into v_total from public.diagnostic_logs;
  if v_total + new.compressed_bytes > 419430400 then
    raise exception 'DIAGNOSTIC_LOG_GLOBAL_QUOTA_GUARD';
  end if;
  select coalesce(sum(compressed_bytes),0) into v_user_24h
    from public.diagnostic_logs
    where user_id=new.user_id and created_at >= now()-interval '24 hours';
  if v_user_24h + new.compressed_bytes > 20971520 then
    raise exception 'DIAGNOSTIC_LOG_USER_DAILY_QUOTA_GUARD';
  end if;
  return new;
end $$;

drop trigger if exists diagnostic_log_quota_guard_trigger on public.diagnostic_logs;
create trigger diagnostic_log_quota_guard_trigger
before insert on public.diagnostic_logs
for each row execute function public.enforce_diagnostic_log_quota();
