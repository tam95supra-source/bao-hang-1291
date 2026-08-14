begin;
do $$
declare r record;
begin
  for r in select jobid from cron.job where jobname in ('bao-hang-1291-sheet-sync-day','bao-hang-1291-sheet-sync-midnight') loop
    perform cron.unschedule(r.jobid);
  end loop;
end $$;

-- pg_cron is GMT. Bangkok 05:00-23:30 => UTC 22:00-23:30 + 00:00-16:30.
select cron.schedule(
  'bao-hang-1291-sheet-sync-day',
  '0,30 0-16,22-23 * * *',
  $$select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name='bao_hang_1291_project_url') || '/functions/v1/api/sla-tick',
      headers := jsonb_build_object('content-type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='bao_hang_1291_cron_secret')),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );$$
);
-- Bangkok 00:00 final flush => UTC 17:00.
select cron.schedule(
  'bao-hang-1291-sheet-sync-midnight',
  '0 17 * * *',
  $$select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name='bao_hang_1291_project_url') || '/functions/v1/api/sla-tick',
      headers := jsonb_build_object('content-type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='bao_hang_1291_cron_secret')),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );$$
);
commit;
