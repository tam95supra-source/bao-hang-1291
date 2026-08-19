-- BÁO HÀNG 1291 — collapse profile changes into one staff invalidation per minute.
-- Applied live first on Neon production tiny-boat-19315489 and recorded here for reproducibility.
create or replace function public.queue_profile_realtime_event()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  bucket text := floor(extract(epoch from clock_timestamp()) / 60)::bigint::text;
begin
  insert into public.realtime_events(topic,event_type,entity_id,payload,dedupe_key)
  values(
    'staff',
    'staff_changed',
    'staff',
    jsonb_build_object('updated_at',new.updated_at),
    'staff:minute:' || bucket
  )
  on conflict(dedupe_key) do update set
    entity_id = 'staff',
    payload = excluded.payload,
    created_at = clock_timestamp(),
    published_at = null,
    attempts = 0,
    last_error = '';
  return new;
end
$function$;
