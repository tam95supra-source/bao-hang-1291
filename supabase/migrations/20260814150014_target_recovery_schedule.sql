begin;

do $$
declare v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname='bao-hang-1291-fallback-recovery' limit 1;
  if v_jobid is not null then perform cron.unschedule(v_jobid); end if;
end$$;

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

commit;
