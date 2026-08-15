alter table public.staff_sync_runs
  add column if not exists source_response_bytes integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'staff_sync_runs_source_response_bytes_check'
      and conrelid = 'public.staff_sync_runs'::regclass
  ) then
    alter table public.staff_sync_runs
      add constraint staff_sync_runs_source_response_bytes_check
      check (source_response_bytes >= 0);
  end if;
end $$;
