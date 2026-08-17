-- Harden helper execution and add FK indexes identified by post-migration advisors.

revoke all on function public.broadcast_issue_delta() from public, anon, authenticated;
grant execute on function public.broadcast_issue_delta() to service_role;

create index if not exists supra_connections_updated_by_idx
  on private.supra_connections(updated_by) where updated_by is not null;
create index if not exists inventory_import_errors_job_idx
  on public.inventory_import_errors(job_id);
create index if not exists inventory_snapshots_requested_by_idx
  on public.inventory_snapshots(requested_by) where requested_by is not null;
create index if not exists inventory_sync_audit_actor_idx
  on public.inventory_sync_audit(actor_id) where actor_id is not null;
create index if not exists inventory_sync_jobs_requested_by_idx
  on public.inventory_sync_jobs(requested_by) where requested_by is not null;
