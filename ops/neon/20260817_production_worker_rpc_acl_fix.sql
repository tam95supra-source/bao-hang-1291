-- BÁO HÀNG 1291 — Neon production worker RPC ACL fix.
-- The Data API connects Firebase-authenticated callers as role `authenticated`.
-- Worker RPCs are SECURITY DEFINER and each enforces worker_require_admin(); therefore
-- authenticated requires EXECUTE on the public RPC entrypoints while PUBLIC must remain revoked.

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname LIKE 'worker\_%_rpc' ESCAPE '\'
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated', r.proname, r.args);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC', r.proname, r.args);
  END LOOP;
END $$;

-- Internal authorization helper is intentionally not a public Data API entrypoint.
REVOKE EXECUTE ON FUNCTION public.worker_require_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.worker_require_admin() FROM authenticated;
