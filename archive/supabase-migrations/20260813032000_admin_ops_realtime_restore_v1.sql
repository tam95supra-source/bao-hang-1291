-- Báo hàng 1291: realtime staff invalidation and explicit correction of a previous SKIP decision.

create or replace function public.broadcast_profile_change()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if tg_op = 'INSERT' or row(
    old.employee_code,
    old.full_name,
    old.contractor,
    old.role,
    old.active,
    old.source_kind,
    old.source_position
  ) is distinct from row(
    new.employee_code,
    new.full_name,
    new.contractor,
    new.role,
    new.active,
    new.source_kind,
    new.source_position
  ) then
    perform realtime.send(
      jsonb_build_object(
        'user_id', new.id,
        'employee_code', new.employee_code,
        'role', new.role,
        'active', new.active,
        'source_kind', coalesce(new.source_kind, ''),
        'updated_at', new.updated_at
      ),
      'staff_changed',
      'site:1291:staff',
      true
    );
  end if;
  return null;
end
$$;

drop trigger if exists profiles_realtime_broadcast on public.profiles;
create trigger profiles_realtime_broadcast
after insert or update on public.profiles
for each row execute function public.broadcast_profile_change();

create or replace function public.restore_skipped_issue_available(
  p_issue_id uuid,
  p_actor uuid,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_issue public.issues%rowtype;
  v_role public.user_role;
  v_skip_action text;
  v_reason text := left(trim(coalesce(p_reason, '')), 500);
begin
  select role into v_role
  from public.profiles
  where id = p_actor and active = true;

  if v_role not in (
    'ADMIN'::public.user_role,
    'ADMIN_INVENT'::public.user_role,
    'INVENT'::public.user_role
  ) then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_issue
  from public.issues
  where id = p_issue_id
  for update;

  if not found then
    raise exception 'ISSUE_NOT_FOUND';
  end if;
  if v_issue.status <> 'SKIP_ALLOWED'::public.issue_status then
    raise exception 'ISSUE_NOT_SKIPPED';
  end if;
  if v_role = 'INVENT'::public.user_role and v_issue.claimed_by is distinct from p_actor then
    raise exception 'ISSUE_NOT_OWNED';
  end if;

  select action into v_skip_action
  from public.issue_audit
  where issue_id = p_issue_id
    and action in ('AUTO_SKIP', 'NOT_FOUND')
  order by created_at desc
  limit 1;

  update public.issues
  set status = 'AVAILABLE'::public.issue_status,
      resolved_at = now(),
      issue_version = issue_version + 1,
      updated_at = now()
  where id = p_issue_id
  returning * into v_issue;

  insert into public.issue_audit(
    issue_id, actor_id, action, from_status, to_status, detail
  ) values (
    v_issue.id,
    p_actor,
    'RESTORE_AVAILABLE',
    'SKIP_ALLOWED'::public.issue_status,
    'AVAILABLE'::public.issue_status,
    jsonb_build_object(
      'reason', v_reason,
      'reversed_skip_action', coalesce(v_skip_action, 'UNKNOWN'),
      'issue_version', v_issue.issue_version,
      'reopen_count', v_issue.reopen_count
    )
  );

  insert into public.sheet_export_queue(event_type, payload)
  values (
    'ISSUE_STATUS',
    public.issue_json(v_issue) || jsonb_build_object(
      'actor_id', p_actor,
      'action', 'RESTORE_AVAILABLE',
      'reason', v_reason,
      'reversed_skip_action', coalesce(v_skip_action, 'UNKNOWN')
    )
  );

  return public.issue_json(v_issue) || jsonb_build_object(
    'restored_from_skip', true,
    'restore_reason', v_reason,
    'reversed_skip_action', coalesce(v_skip_action, 'UNKNOWN')
  );
end
$$;

revoke all on function public.restore_skipped_issue_available(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.restore_skipped_issue_available(uuid, uuid, text) to service_role;
