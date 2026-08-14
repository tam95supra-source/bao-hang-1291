begin;
-- Pre-create the target partial index so the following core migration's IF NOT EXISTS
-- cannot accidentally impose uniqueness on operational OPEN/CLAIMED reminders.
create unique index if not exists notification_current_unique
  on public.notification_events(target_user_id, issue_id, issue_version, status)
  where critical = true and issue_id is not null;
commit;
