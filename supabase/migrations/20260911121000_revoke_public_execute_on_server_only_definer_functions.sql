-- Follow-up to 20260911120000: also revoke the PUBLIC grant.
--
-- bydmate_apply_diplus_columns and bydmate_prune_telemetry_samples still carried
-- Postgres's built-in EXECUTE-to-PUBLIC (`=X/postgres`), which every role inherits, so
-- revoking from anon/authenticated alone left them callable through the RPC. The other
-- 17 had PUBLIC revoked already; revoking it on all 19 keeps one list and is a no-op
-- where it is not held. Owner (postgres, used by pg_cron) and service_role keep their
-- explicit grants.

do $$
declare
  v_function regprocedure;
begin
  for v_function in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'bydmate_apply_client_hourly',
        'bydmate_apply_client_trip',
        'bydmate_apply_diplus_columns',
        'bydmate_apply_hourly_rollup_sample',
        'bydmate_discard_trip_if_junk',
        'bydmate_enqueue_aux_voltage_backfill',
        'bydmate_enqueue_aux_voltage_day',
        'bydmate_finalize_trip_energy',
        'bydmate_ingest_telemetry',
        'bydmate_ingest_telemetry_batch',
        'bydmate_ingest_trip_summaries',
        'bydmate_materialize_aux_voltage_day',
        'bydmate_process_aux_voltage_rollup_queue',
        'bydmate_prune_telemetry_samples',
        'bydmate_update_hourly_energy',
        'purge_old_bydmate_aux_voltage_rollups',
        'purge_old_bydmate_telemetry',
        'rdp_simplify_trip_track',
        'simplify_aged_bydmate_trip_tracks'
      ])
  loop
    execute format('revoke execute on function %s from public', v_function);
  end loop;
end;
$$;
