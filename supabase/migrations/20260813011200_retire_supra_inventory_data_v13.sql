-- Báo hàng 1291 v1.3: permanently retire the old detailed-inventory source integration.
-- Public inventory tables remain empty only for Stable 1.1.x compatibility responses.

-- No runtime code in v1.3 calls these service RPCs anymore.
drop function if exists public.get_supra_connection_service(text);
drop function if exists public.set_supra_connection_service(text,text,uuid,boolean,text,jsonb);
drop function if exists public.stage_inventory_items_service(uuid,jsonb);
drop function if exists public.inventory_staging_count_service(uuid);
drop function if exists public.inventory_staging_digest_input_service(uuid);
drop function if exists public.finalize_inventory_snapshot(uuid);

-- Remove retained quantity/snapshot history from the retired feature.
delete from public.inventory_current;
delete from public.inventory_snapshot_items;
delete from public.inventory_snapshots;
-- inventory_sync_jobs cascades its staging/error/audit children where applicable.
delete from public.inventory_sync_jobs;
delete from public.inventory_import_errors;
delete from public.inventory_sync_audit;

-- Remove private staging and credential-storage mechanisms entirely.
drop table if exists private.inventory_staging_items;
drop table if exists private.supra_connections;
