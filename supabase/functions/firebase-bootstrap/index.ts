/**
 * RETIRED ONE-SHOT.
 *
 * Initial Firebase provisioning is completed/owner-gated. Keeping this
 * endpoint fail-closed prevents a future backend deploy from replaying
 * stale Firestore rules or attempting database creation.
 */
Deno.serve(() => new Response(
  JSON.stringify({ ok: false, error: "RETIRED_ONE_SHOT" }),
  {
    status: 410,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  },
));
