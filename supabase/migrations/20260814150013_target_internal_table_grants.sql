begin;

revoke all on table public.authority_events from anon, authenticated;
revoke all on table public.cleanup_audit from anon, authenticated;
revoke all on table public.realtime_issue_coalesce from anon, authenticated;
revoke all on table public.security_audit from anon, authenticated;

grant all on table public.authority_events to service_role;
grant all on table public.cleanup_audit to service_role;
grant all on table public.realtime_issue_coalesce to service_role;
grant all on table public.security_audit to service_role;

commit;
