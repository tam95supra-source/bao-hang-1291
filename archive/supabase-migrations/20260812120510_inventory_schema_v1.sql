-- Inventory v1: private Supra connection and staging, immutable snapshots and current projection.

create table if not exists private.supra_connections (
  warehouse_site_id text primary key,
  warehouse_code text not null,
  client_code text not null,
  api_base_url text not null,
  encrypted_credential_bundle text,
  encryption_version integer not null default 1,
  credential_version bigint not null default 0,
  sign_prefix text not null default '910',
  enabled boolean not null default false,
  status text not null default 'DISABLED' check (status in ('DISABLED','CONNECTED','AUTH_EXPIRED','SOURCE_CONTRACT_UNVERIFIED','SOURCE_SCHEMA_CHANGED','ERROR')),
  source_contract jsonb not null default '{}'::jsonb,
  last_tested_at timestamptz,
  last_test_error text not null default '',
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
insert into private.supra_connections(warehouse_site_id,warehouse_code,client_code,api_base_url)
values('1291','HY1','WIN','https://api-supra.winmart.vn')
on conflict(warehouse_site_id) do nothing;
revoke all on private.supra_connections from public, anon, authenticated;
grant select,insert,update,delete on private.supra_connections to service_role;

create table if not exists public.inventory_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  client_request_id text not null unique,
  warehouse_site_id text not null,
  warehouse_code text not null,
  source text not null default 'SUPRA_BIN_STOCK_API',
  source_endpoint text not null default 'BIN_STOCKS_JSON',
  requested_by uuid references public.profiles(id),
  requested_source text not null default 'MANUAL' check (requested_source in ('MANUAL','CRON','RECOVERY')),
  credential_version bigint not null default 0,
  state text not null default 'QUEUED' check (state in ('QUEUED','CONNECTING','FETCHING','VALIDATING','PUBLISHING','SUCCEEDED','NO_CHANGE','AUTH_EXPIRED','NETWORK_ERROR','SOURCE_SCHEMA_CHANGED','VALIDATION_FAILED','TIMEOUT','CANCELLED')),
  checkpoint jsonb not null default '{}'::jsonb,
  lease_owner text,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  page_count integer not null default 0 check (page_count >= 0),
  raw_row_count integer not null default 0 check (raw_row_count >= 0),
  normalized_row_count integer not null default 0 check (normalized_row_count >= 0),
  source_captured_at timestamptz,
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  error_code text not null default '',
  error_message text not null default '',
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index if not exists inventory_one_active_job_idx
  on public.inventory_sync_jobs(warehouse_site_id,source)
  where state in ('QUEUED','CONNECTING','FETCHING','VALIDATING','PUBLISHING');
create index if not exists inventory_jobs_recent_idx on public.inventory_sync_jobs(requested_at desc);
alter table public.inventory_sync_jobs enable row level security;
revoke all on public.inventory_sync_jobs from anon, authenticated;
grant select,insert,update,delete on public.inventory_sync_jobs to service_role;

create table if not exists private.inventory_staging_items (
  job_id uuid not null references public.inventory_sync_jobs(id) on delete cascade,
  row_key text not null,
  sku text not null,
  bin_code text not null default '',
  storage_type text not null default '',
  is_pickable boolean not null,
  bin_qty numeric not null check (bin_qty >= 0),
  pending_out_qty numeric not null default 0 check (pending_out_qty >= 0),
  available_qty numeric generated always as (greatest(bin_qty-pending_out_qty,0)) stored,
  raw_row_hash text not null check (raw_row_hash ~ '^[0-9a-f]{64}$'),
  primary key(job_id,row_key)
);
create index if not exists inventory_staging_job_sku_idx on private.inventory_staging_items(job_id,sku);
revoke all on private.inventory_staging_items from public, anon, authenticated;
grant select,insert,update,delete on private.inventory_staging_items to service_role;

create table if not exists public.inventory_snapshots (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.inventory_sync_jobs(id),
  warehouse_code text not null,
  warehouse_site_id text not null,
  source text not null,
  source_endpoint text not null,
  source_captured_at timestamptz not null,
  requested_at timestamptz not null,
  requested_by uuid references public.profiles(id),
  credential_version bigint not null,
  page_count integer not null check (page_count >= 0),
  raw_row_count integer not null check (raw_row_count >= 0),
  normalized_row_count integer not null check (normalized_row_count >= 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  schema_version text not null default 'inventory.v1',
  published_at timestamptz not null default now(),
  unique(warehouse_site_id,source_captured_at,sha256)
);
create index if not exists inventory_snapshots_site_recent_idx on public.inventory_snapshots(warehouse_site_id,published_at desc);
alter table public.inventory_snapshots enable row level security;
revoke all on public.inventory_snapshots from anon, authenticated;
grant select,insert,update,delete on public.inventory_snapshots to service_role;

create table if not exists public.inventory_snapshot_items (
  snapshot_id uuid not null references public.inventory_snapshots(id) on delete cascade,
  sku text not null,
  pickable_bin_qty numeric not null default 0 check (pickable_bin_qty >= 0),
  pickable_pending_out_qty numeric not null default 0 check (pickable_pending_out_qty >= 0),
  pickable_available_qty numeric not null default 0 check (pickable_available_qty >= 0),
  other_stock_qty numeric not null default 0 check (other_stock_qty >= 0),
  primary key(snapshot_id,sku)
);
alter table public.inventory_snapshot_items enable row level security;
revoke all on public.inventory_snapshot_items from anon, authenticated;
grant select,insert,update,delete on public.inventory_snapshot_items to service_role;

create table if not exists public.inventory_current (
  warehouse_site_id text not null,
  sku text not null,
  snapshot_id uuid not null references public.inventory_snapshots(id),
  snapshot_captured_at timestamptz not null,
  pickable_bin_qty numeric not null default 0 check (pickable_bin_qty >= 0),
  pickable_pending_out_qty numeric not null default 0 check (pickable_pending_out_qty >= 0),
  pickable_available_qty numeric not null default 0 check (pickable_available_qty >= 0),
  other_stock_qty numeric not null default 0 check (other_stock_qty >= 0),
  updated_at timestamptz not null default now(),
  primary key(warehouse_site_id,sku)
);
create index if not exists inventory_current_snapshot_idx on public.inventory_current(snapshot_id);
alter table public.inventory_current enable row level security;
revoke all on public.inventory_current from anon, authenticated;
grant select,insert,update,delete on public.inventory_current to service_role;

create table if not exists public.inventory_import_errors (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.inventory_sync_jobs(id) on delete cascade,
  error_code text not null,
  row_ref text not null default '',
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.inventory_import_errors enable row level security;
revoke all on public.inventory_import_errors from anon, authenticated;
grant select,insert,delete on public.inventory_import_errors to service_role;

create table if not exists public.inventory_sync_audit (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.inventory_sync_jobs(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists inventory_sync_audit_job_idx on public.inventory_sync_audit(job_id,created_at);
alter table public.inventory_sync_audit enable row level security;
revoke all on public.inventory_sync_audit from anon, authenticated;
grant select,insert,delete on public.inventory_sync_audit to service_role;
