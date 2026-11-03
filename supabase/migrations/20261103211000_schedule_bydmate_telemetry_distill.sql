-- Schedule the telemetry distillation from 20261103210000 (BACKLOG "Prod DB retention & cleanup",
-- item 1b) after the size check: 100 trips → ~10 KB stored per trip, 50 sessions → ~5.5 KB each.
--
-- * distill-bydmate-telemetry-series: hourly, 200 trips + 200 sessions per run, newest first.
--   It also works through the existing history (~7.3 k trips, ~1.6 k sessions) in about 40 h,
--   well before any raw purge.
-- * distill-bydmate-vehicle-days: hourly, yesterday plus 3 missing older days per run. One day (all
--   cars) costs ~20 s of scattered heap reads on prod (measured), so ~1 min per run; the history since
--   May fills in about 2.5 days.
-- No backfill runs inside this migration: a whole-history loop in one transaction ran for
-- 10+ minutes in a dry run.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname in ('distill-bydmate-telemetry-series', 'distill-bydmate-vehicle-days');

    perform cron.schedule(
      'distill-bydmate-telemetry-series',
      '50 * * * *',
      $cron$select public.bydmate_distill_telemetry_series(200)$cron$
    );

    perform cron.schedule(
      'distill-bydmate-vehicle-days',
      '40 * * * *',
      $cron$select public.bydmate_distill_vehicle_days(3)$cron$
    );
  end if;
exception
  when undefined_table or undefined_function or invalid_schema_name then
    null;
end;
$$;
