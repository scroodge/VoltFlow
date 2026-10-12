-- All-user follow-up to 20261012121000 (prod-wide overlap scan, 2026-10-12). Idempotent.

-- 1. Legacy 0 km trips (4-9 samples) overlapping a client trip (cars `cl`, `yuan up`; 8 rows).
delete from public.bydmate_trips s
where s.source = 'telemetry'
  and s.client_trip is not true
  and s.ended_at is not null
  and coalesce(s.distance_km, 0) <= 0.1
  and exists (
    select 1 from public.bydmate_trips c
    where c.user_id = s.user_id and c.vehicle_id = s.vehicle_id and c.client_trip
      and c.started_at < s.ended_at
      and coalesce(c.ended_at, c.last_device_time) > s.started_at
  );

-- 2. `BYD Yuan Up 25` 2026-10-08: stale 13:58 start + whole-day 49.5 km. GPS track, samples
--    and avg speed belong to the 19:09:36-19:22:35 drive: 6.1 km (odometer delta), SOC 36.7.
update public.bydmate_trips
set started_at = '2026-10-08 19:09:36.557+00', distance_km = 6.1, soc_start = 36.7
where id = 'a2ca6574-b29e-488f-aab0-f25b4e9a5d98'
  and started_at = '2026-10-08 13:58:16.79+00';

-- 3. `Bulbazavr`: started_at 2000-01-01 (unsynced car clock). Telemetry pruned, so the start
--    is estimated at 1 Hz driving cadence (end - sample_count seconds). Distance kept.
update public.bydmate_trips
set started_at = coalesce(ended_at, last_device_time) - make_interval(secs => sample_count)
where id = '60af56a5-bdc1-4494-8ca7-8ecd0fddeddf'
  and started_at < '2020-01-01';
