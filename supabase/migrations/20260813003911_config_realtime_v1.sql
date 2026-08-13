-- Realtime configuration bridge for Báo hàng 1291.
-- app_config remains the canonical source; broadcasts are invalidation hints only.

create or replace function public.broadcast_config_delta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'updated_at', new.updated_at,
      'acknowledge_minutes', new.acknowledge_minutes,
      'reminder_minutes', new.reminder_minutes,
      'replenish_minutes', new.replenish_minutes,
      'picker_ack_reminder_minutes', new.picker_ack_reminder_minutes,
      'auto_skip_enabled', new.auto_skip_enabled,
      'auto_skip_after_minutes', new.auto_skip_after_minutes
    ),
    'config_changed',
    'site:1291:config',
    true
  );
  return null;
end
$$;

revoke all on function public.broadcast_config_delta() from public, anon, authenticated;
grant execute on function public.broadcast_config_delta() to service_role;

drop trigger if exists trg_broadcast_config_delta on public.app_config;
create trigger trg_broadcast_config_delta
after update on public.app_config
for each row execute function public.broadcast_config_delta();

drop policy if exists bao_hang_1291_receive_broadcast on realtime.messages;
create policy bao_hang_1291_receive_broadcast
on realtime.messages
for select
to authenticated
using (
  extension = 'broadcast'
  and realtime.topic() = any (array[
    'site:1291:issues'::text,
    'site:1291:catalog'::text,
    'site:1291:staff'::text,
    'site:1291:inventory'::text,
    'site:1291:config'::text
  ])
  and exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.active = true
  )
);
