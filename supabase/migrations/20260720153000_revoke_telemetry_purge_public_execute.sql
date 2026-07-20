-- Self-hosted deployments carried explicit grants from an older version of the
-- retention RPC. REVOKE FROM PUBLIC does not remove those per-role grants.
revoke all on function public.purge_old_bydmate_telemetry_by_tier() from anon, authenticated;
grant execute on function public.purge_old_bydmate_telemetry_by_tier() to service_role;
