-- Odometer-scale trip distances, stage 3 (BACKLOG.md "Stage 3 plan ... PLAN CORRECTED"):
-- one-time repair of the 7 stored client_trip rows whose distance_km is the car's odometer
-- (> 15,000 km in minutes). Updates only; NO deletes; no other row is touched.
--
--   * 2 rows with enough samples: distance recomputed from the trip's own odometer delta
--     (bydmate_trip_distance_from_samples, stage 2). a62052e8 -> 2.4 km, ca8ba735 -> 6.2 km (GPS path
--     length agrees within 3-7 %).
--   * 5 real drives (5-20 min) with no usable samples/GPS: distance_km set to NULL (unknown), the
--     drive and its energy data are kept (user decision 2026-10-07; readers treat NULL as unknown).
--
-- Deliberately NOT touched: the 6 speed-only client_trip rows and the 8 byd_energydata rows. Their
-- distances are right (energy agrees within ~10 %); only their recorded durations are wrong.
--
-- Safety: explicit id lists, and every statement also requires distance_km > 1500, so a healthy row
-- can never be changed and a re-run is a no-op. Backup before applying (local, outside the repo):
-- ~/voltflow-backups/stage3-bydmate_trips-before-20261007.csv. Rollback: restore distance_km for
-- these ids from that file.

update public.bydmate_trips t
set distance_km = r.km
from (
  select
    id,
    public.bydmate_trip_distance_from_samples(
      user_id, vehicle_id, started_at, coalesce(ended_at, last_device_time)
    ) as km
  from public.bydmate_trips
  where id in (
    'a62052e8-4f29-4c9c-b0d7-89d6bbe4398d',
    'ca8ba735-43cb-4020-b925-eb04025574a9'
  )
    and distance_km > 1500
) r
where t.id = r.id
  and r.km is not null;

update public.bydmate_trips
set distance_km = null
where id in (
  '3c5adf11-1f52-4d88-bce8-ded53e3aa04e',
  'b9135a90-1197-40da-a75c-a08b00496983',
  '05796b26-8a3a-4a6e-b1a7-b588b414c974',
  'a0fa14a1-4cfc-4b2c-80b0-050a68f29bcd',
  '368c70ec-b17c-4117-91e1-de233542ba12'
)
  and distance_km > 1500;
