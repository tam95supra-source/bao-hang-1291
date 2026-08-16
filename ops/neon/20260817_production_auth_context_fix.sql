-- BÁO HÀNG 1291 — Neon production runtime auth fix
-- Approved target: Neon project tiny-boat-19315489 / branch br-broad-resonance-aznwrpea.
-- Do not apply to PICK-PACK-1291 resources.
--
-- Neon Data API injects the verified JWT into the database session. This helper
-- must execute as the caller so auth.user_id()/auth.jwt() remain visible when
-- it is nested inside SECURITY DEFINER API RPCs.

DO $do$
BEGIN
  IF to_regprocedure('public.effective_role_rpc(text)') IS NULL THEN
    RAISE EXCEPTION 'EXPECTED_FUNCTION_MISSING: public.effective_role_rpc(text)';
  END IF;

  ALTER FUNCTION public.effective_role_rpc(text) SECURITY INVOKER;
END
$do$;
