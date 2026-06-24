-- Enable pg_cron and register the daily tiered telemetry purge.
--
-- Why this is needed: the retention functions and the scheduling code already
-- exist (migrations 20260530120000 / 20260617133000 / 20260617135500), but each
-- guarded `cron.schedule(...)` behind `if exists (pg_extension where extname =
-- 'pg_cron')` and swallowed errors. pg_cron was never enabled in this project, so
-- the `purge-bydmate-telemetry` job was NEVER actually registered — i.e. there has
-- been NO automated telemetry retention. This migration enables the extension and
-- registers the job so retention finally runs.
--
-- Effect once applied: a daily 03:00 UTC job runs
-- public.purge_old_bydmate_telemetry_by_tier(), which deletes
--   * bydmate_telemetry_samples + bydmate_trip_track_points older than
--     365 days (premium users) / 30 days (non-premium), and
--   * bydmate_telemetry_hourly older than 3 years.
--
-- If `create extension pg_cron` fails on permissions (some Supabase projects
-- require enabling pg_cron via Dashboard > Database > Extensions first), enable it
-- there, then re-run this migration — the schedule block is idempotent.

create extension if not exists pg_cron;

-- Idempotent: drop any prior job with this name before re-registering.
do $$
begin
  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'purge-bydmate-telemetry';
exception
  when undefined_table or undefined_function or invalid_schema_name then
    null;
end;
$$;

select cron.schedule(
  'purge-bydmate-telemetry',
  '0 3 * * *',
  $cron$select public.purge_old_bydmate_telemetry_by_tier()$cron$
);
