begin;
create table if not exists public.fallback_token_audit (
  id bigint generated always as identity primary key,
  token_jti uuid not null unique,
  token_sha256 text not null unique,
  account_id uuid not null references public.profiles(id) on delete cascade,
  device_id text not null,
  role public.user_role not null,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.fallback_token_audit enable row level security;
create index if not exists fallback_token_account_device_idx on public.fallback_token_audit(account_id,device_id,expires_at desc);
create index if not exists fallback_token_expiry_idx on public.fallback_token_audit(expires_at) where revoked_at is null;
revoke all on table public.fallback_token_audit from public,anon,authenticated;
commit;
