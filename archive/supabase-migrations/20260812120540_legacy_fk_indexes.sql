create index if not exists app_config_updated_by_idx
  on public.app_config(updated_by) where updated_by is not null;
create index if not exists diagnostic_logs_last_downloaded_by_idx
  on public.diagnostic_logs(last_downloaded_by) where last_downloaded_by is not null;
