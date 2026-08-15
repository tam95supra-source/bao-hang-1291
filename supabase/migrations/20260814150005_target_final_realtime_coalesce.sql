begin;

create table if not exists public.realtime_issue_coalesce (
  issue_id uuid primary key references public.issues(id) on delete cascade,
  last_sent_at timestamptz not null default '-infinity'::timestamptz
);
alter table public.realtime_issue_coalesce enable row level security;

create or replace function public.broadcast_issue_delta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_send boolean:=false;
begin
  if tg_op='INSERT' or (tg_op='UPDATE' and new.status is distinct from old.status) then
    insert into public.realtime_issue_coalesce(issue_id,last_sent_at)
    values(new.id,clock_timestamp())
    on conflict(issue_id) do update set last_sent_at=excluded.last_sent_at;
    v_send:=true;
  else
    insert into public.realtime_issue_coalesce(issue_id,last_sent_at)
    values(new.id,clock_timestamp())
    on conflict(issue_id) do update
      set last_sent_at=excluded.last_sent_at
      where public.realtime_issue_coalesce.last_sent_at <= clock_timestamp()-interval '1 second'
    returning true into v_send;
    v_send:=coalesce(v_send,false);
  end if;

  if v_send then
    perform realtime.send(
      jsonb_build_object(
        'issue_id',new.id,
        'issue_version',new.issue_version,
        'status',new.status,
        'sku',new.sku,
        'report_count',new.report_count,
        'updated_at',new.updated_at
      ),
      'issue_changed',
      'site:1291:issues',
      true
    );
  end if;
  return null;
end;
$$;

revoke execute on function public.broadcast_issue_delta() from public,anon,authenticated;
commit;
