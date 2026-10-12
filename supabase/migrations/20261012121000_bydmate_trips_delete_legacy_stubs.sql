-- One-off cleanup: delete the 1-2 sample, 0 km legacy (client_trip=false) trip stubs on
-- vehicles that record client trips.
--
-- These were opened by untagged samples racing the app's client-tagged batch (see
-- 20261012120000_bydmate_untagged_samples_skip_legacy_trip_open.sql) and shown as a duplicate
-- next to the real drive. Dry run on prod 2026-10-12: 165 rows, 10 vehicles, max 2 samples,
-- max distance 0 km, 2 track points in total. Track points, insight inputs and finalization
-- audits cascade. Only rows with a client trip of the same user+vehicle within 7 days are
-- touched, so vehicles that only have server-owned trips keep everything.
--
-- Idempotent: re-running deletes nothing once the stubs are gone. Not reversible; the rows
-- carried no distance, energy or GPS beyond the 2 points above.

delete from public.bydmate_trips s
where s.source = 'telemetry'
  and s.client_trip is not true
  and s.ended_at is not null
  and s.sample_count <= 2
  and coalesce(s.distance_km, 0) <= 0.1
  and exists (
    select 1
    from public.bydmate_trips c
    where c.user_id = s.user_id
      and c.vehicle_id = s.vehicle_id
      and c.client_trip
      and c.started_at <= s.started_at + interval '7 days'
      and coalesce(c.ended_at, c.last_device_time) >= s.started_at - interval '7 days'
  );
