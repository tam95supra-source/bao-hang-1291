# BÁO HÀNG 1291 — Neon worker cutover gate

This file records a deliberate production safety gate during the Supabase -> Neon cutover.

## Pre-cutover state

Supabase remains the runtime authority until the final delta has been verified. The Apps Script Neon worker has already been bootstrapped, so its scheduled trigger may execute before cutover.

To prevent the Neon copy from draining notification, push, Sheet, realtime, cleanup, log or staff-sync work before it becomes authoritative, `authenticated` EXECUTE is temporarily revoked on the external `public.worker_*` RPCs in Neon production. Internal `public.worker_require_admin()` is not part of the client grant set.

This is intentional. Do not treat the temporary worker-RPC revoke as a regression during pre-cutover validation.

## Enable gate

Enable the worker only after all of these are true:

1. the old Supabase worker/cron paths that can mutate or deliver the same queues are stopped;
2. the final Supabase -> Neon delta has completed;
3. critical row counts/checksums have been verified;
4. pending notification state has been reconciled so already-delivered work cannot be replayed;
5. Firebase/Auth/Firestore/FCM target scope is still `bao-hang-1291` and Neon target scope is still `tiny-boat-19315489` / `br-broad-resonance-aznwrpea`.

At that point restore `authenticated` EXECUTE only for the intended worker RPC surface, verify the ACL, invoke one controlled worker tick, and verify queue/realtime/Sheet/FCM evidence before switching public traffic.

## Intended external worker RPC surface

- `worker_cleanup_rpc`
- `worker_delete_log_metadata_rpc`
- `worker_notification_batch_rpc`
- `worker_notification_result_rpc`
- `worker_old_logs_rpc`
- `worker_profile_deactivate_rpc`
- `worker_profile_upsert_rpc`
- `worker_profiles_snapshot_rpc`
- `worker_push_batch_rpc`
- `worker_push_result_rpc`
- `worker_realtime_batch_rpc`
- `worker_realtime_result_rpc`
- `worker_schedule_rpc`
- `worker_sheet_ack_rpc`
- `worker_sheet_batch_rpc`
- `worker_staff_run_finish_rpc`
- `worker_staff_run_start_rpc`
- `worker_tick_rpc`

The enable operation must remain fail-closed: no broad table DML grants, no `PUBLIC` execute grant, and no PICK PACK 1291 target identifiers.
