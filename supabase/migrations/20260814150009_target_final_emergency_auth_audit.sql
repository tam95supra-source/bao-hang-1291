begin;
create table if not exists public.emergency_auth_audit(
  account_id uuid not null references public.profiles(id) on delete cascade,
  device_id text not null,
  role public.user_role not null,
  provisioned_at timestamptz not null default now(),
  last_token_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key(account_id,device_id)
);
alter table public.emergency_auth_audit enable row level security;
revoke all on table public.emergency_auth_audit from public,anon,authenticated;
commit;
