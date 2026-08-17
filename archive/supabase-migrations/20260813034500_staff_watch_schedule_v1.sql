-- Near-realtime staff source watcher. The existing SLA cron stays independent.
-- The watcher reads only filtered Site 1291 / HY1 rows and does no DB write when source hash is unchanged.

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname='bao-hang-1291-staff-watch';
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  if not exists(select 1 from vault.decrypted_secrets where name='bao_hang_1291_project_url') then
    raise exception 'PROJECT_URL_SECRET_MISSING';
  end if;
  if not exists(select 1 from vault.decrypted_secrets where name='bao_hang_1291_cron_secret') then
    raise exception 'CRON_SECRET_MISSING';
  end if;

  perform cron.schedule('bao-hang-1291-staff-watch','* * * * *',$job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name='bao_hang_1291_project_url') || '/functions/v1/staff-watch/run',
      headers := jsonb_build_object(
        'content-type','application/json',
        'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='bao_hang_1291_cron_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $job$);
end
$$;
