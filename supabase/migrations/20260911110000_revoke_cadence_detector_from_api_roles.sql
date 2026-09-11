-- Close public API access to the cadence-collapse detector.
--
-- 20260908130000 ran `revoke all ... from public`, but Supabase's default privileges
-- grant EXECUTE on new public functions to anon and authenticated explicitly, and a
-- revoke from PUBLIC does not remove those. The detector is SECURITY DEFINER, so anyone
-- holding the public anon key could call it through the PostgREST RPC: a 3-30 s query per
-- call that opens/resolves alarms and enqueues deliveries. Only pg_cron (as postgres) and
-- service_role need it.
--
-- Idempotent: revoking a privilege that is not held is a no-op.

revoke execute on function public.bydmate_detect_telemetry_cadence_collapses() from anon, authenticated;
