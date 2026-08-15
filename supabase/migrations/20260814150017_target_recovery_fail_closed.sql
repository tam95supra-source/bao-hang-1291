begin;

-- Recovery polling must stay OFF until the private monthly Sheet deployment and
-- Firebase emergency authority have both passed live cutover verification.
-- This migration intentionally only removes stale jobs; activation is an
-- explicit post-cutover operation, not a schema side effect.
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

commit;
