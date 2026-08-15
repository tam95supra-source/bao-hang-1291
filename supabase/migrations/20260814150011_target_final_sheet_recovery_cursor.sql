begin;
create table if not exists public.sheet_recovery_cursor (
  singleton boolean primary key default true check(singleton),
  imported_sequence bigint not null default 0,
  acknowledged_sequence bigint not null default 0,
  state text not null default 'IDLE' check(state in ('IDLE','IMPORTING','BLOCKED','CAUGHT_UP')),
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error_code text,
  last_error_detail text,
  updated_at timestamptz not null default now()
);
alter table public.sheet_recovery_cursor enable row level security;
revoke all on table public.sheet_recovery_cursor from public,anon,authenticated;
insert into public.sheet_recovery_cursor(singleton) values(true) on conflict(singleton) do nothing;
commit;
