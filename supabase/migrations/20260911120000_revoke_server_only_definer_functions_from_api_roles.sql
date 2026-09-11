-- Close public API access to server-only SECURITY DEFINER functions.
--
-- Supabase's default privileges grant EXECUTE on every new public function to anon and
-- authenticated explicitly; our migrations only ran `revoke ... from public`, which does
-- not remove those grants. PostgREST exposes every executable function as
-- /rest/v1/rpc/<name>, and the anon key ships in the PWA bundle, so these ran as their
-- owner, bypassing RLS, for anyone. None checks its caller. Worst cases:
-- bydmate_prune_telemetry_samples(0) deletes rolled-up raw telemetry for all users;
-- bydmate_apply_diplus_columns concatenates a caller-supplied WHERE into dynamic SQL;
-- the ingest/apply functions take p_user_id and write into any account.
--
-- Legitimate callers are the service-role Next routes (src/app/api/bydmate/telemetry,
-- .../trip-summaries) and pg_cron jobs running as postgres. No invoker function, trigger
-- or RLS policy calls any of these (checked against pg_proc, pg_policies, cron.job on
-- 2026-09-11), so no anon/authenticated caller exists to break.
--
-- Deliberately NOT revoked: is_admin (RLS on KB/CMS tables), is_user_premium (RLS on
-- bydmate_phantom_drain_daily_rollups and invoker analytics functions), and
-- increment_knowledge_article_view (intentionally public).
--
-- By name, so every overload is covered (bydmate_ingest_telemetry has two). Idempotent:
-- revoking a privilege that is not held is a no-op, and a missing function is skipped.

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
    execute format('revoke execute on function %s from anon, authenticated', v_function);
  end loop;
end;
$$;
