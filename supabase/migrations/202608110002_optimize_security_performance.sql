-- Post-deploy hardening and low-cost performance fixes.

create index if not exists issues_claimed_by_idx on public.issues(claimed_by);
create index if not exists issue_audit_actor_idx on public.issue_audit(actor_id);
create index if not exists notification_events_issue_idx on public.notification_events(issue_id);

drop policy if exists profile_read_self on public.profiles;
create policy profile_read_self on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create or replace function public.process_sla()
returns table(issue_id uuid, event_status public.issue_status, event_kind text)
language plpgsql security definer set search_path = public
as $$
declare
  cfg public.app_config%rowtype;
  item public.issues%rowtype;
  v_from public.issue_status;
begin
  select * into cfg from public.app_config where singleton=true;
  for item in select * from public.issues
    where status in ('OPEN','CLAIMED','SEARCHING','REPLENISHING') for update skip locked
  loop
    if now() >= item.first_reported_at + make_interval(mins => cfg.skip_minutes) then
      v_from := item.status;
      update public.issues set status='SKIP_ALLOWED', resolved_at=now(), updated_at=now()
        where id=item.id returning * into item;
      insert into public.issue_audit(issue_id, action, from_status, to_status)
        values(item.id, 'SLA_SKIP_ALLOWED', v_from, item.status);
      insert into public.sheet_export_queue(event_type,payload)
        values('SLA_SKIP_ALLOWED', public.issue_json(item));
      issue_id := item.id; event_status := 'SKIP_ALLOWED'; event_kind := 'SKIP_ALLOWED'; return next;
    elsif item.status='OPEN' and now() >= item.first_reported_at + make_interval(mins => cfg.acknowledge_minutes)
      and (item.last_reminded_at is null or now() >= item.last_reminded_at + make_interval(mins => cfg.reminder_minutes)) then
      update public.issues set last_reminded_at=now(), updated_at=now() where id=item.id;
      issue_id := item.id; event_status := 'OPEN'; event_kind := 'ACK_OVERDUE'; return next;
    elsif item.status in ('CLAIMED','SEARCHING','REPLENISHING')
      and now() >= coalesce(item.claimed_at,item.first_reported_at) + make_interval(mins => cfg.replenish_minutes)
      and (item.last_reminded_at is null or now() >= item.last_reminded_at + make_interval(mins => cfg.reminder_minutes)) then
      update public.issues set last_reminded_at=now(), updated_at=now() where id=item.id;
      issue_id := item.id; event_status := item.status; event_kind := 'PROCESS_OVERDUE'; return next;
    end if;
  end loop;
end $$;

revoke all on function public.process_sla() from public, anon, authenticated;
grant execute on function public.process_sla() to service_role;
