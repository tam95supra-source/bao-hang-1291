-- Cover v1.3 audit foreign keys; tiny indexes, useful for profile lifecycle and cleanup joins.
create index if not exists catalog_imports_imported_by_idx on public.catalog_imports(imported_by) where imported_by is not null;
create index if not exists staff_sync_runs_requested_by_idx on public.staff_sync_runs(requested_by) where requested_by is not null;
