begin;

-- Re-enable recovery only after the private CURRENT Sheet, Firebase Auth,
-- Firestore (default), production rules, and both no-op recovery paths have
-- passed live verification. Keep polling deliberately low for free-tier safety.
do $$
declare
  v_job record;
begin
  for v_job in
    select jobid from cron.job
    where jobname in (
      'bao-hang-1291-fallback-recovery',
      'bao-hang-1291-emergency-recovery',
      'bao-hang-1291-emergency-drain'
    )
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;
end $$;

select cron.schedule(
  'bao-hang-1291-fallback-recovery',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='bao_hang_1291_project_url' limit 1) || '/functions/v1/fallback-importer',
    headers := jsonb_build_object(
      'content-type','application/json',
      'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='bao_hang_1291_cron_secret' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cron$
);

select cron.schedule(
  'bao-hang-1291-emergency-drain',
  '2-59/5 * * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='bao_hang_1291_project_url' limit 1) || '/functions/v1/emergency-drain',
    headers := jsonb_build_object(
      'content-type','application/json',
      'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='bao_hang_1291_cron_secret' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cron$
);

commit;
