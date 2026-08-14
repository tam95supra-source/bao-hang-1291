begin;

create table if not exists public.backup_accounts (
  id uuid primary key default gen_random_uuid(),
  username text not null unique check (username = lower(username) and username ~ '^[a-z0-9._-]{3,64}$'),
  display_name text not null check (length(trim(display_name)) between 2 and 120),
  role public.user_role not null,
  device_scope text not null default '*' check (length(device_scope) between 1 and 200),
  status text not null default 'ACTIVE' check (status in ('PROVISIONING','ACTIVE','LOCKED','REVOKED')),
  expires_at timestamptz,
  firebase_uid text not null unique,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists backup_accounts_status_expiry_idx on public.backup_accounts(status, expires_at);
alter table public.backup_accounts enable row level security;
revoke all on table public.backup_accounts from public,anon,authenticated;

create table if not exists public.backup_account_audit (
  id bigint generated always as identity primary key,
  account_id uuid references public.backup_accounts(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists backup_account_audit_account_created_idx on public.backup_account_audit(account_id,created_at desc);
create index if not exists backup_account_audit_created_idx on public.backup_account_audit(created_at desc);
alter table public.backup_account_audit enable row level security;
revoke all on table public.backup_account_audit from public,anon,authenticated;

commit;
