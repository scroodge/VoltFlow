-- Round float-noise fields in bydmate_telemetry_samples.telemetry to reclaim space.
--
-- Several numeric telemetry fields were stored as raw IEEE doubles, serializing to
-- 13-20 characters per value (e.g. cell_delta_v "0.019999999999999"). Across ~245k
-- rows this bloated the telemetry jsonb (the table's largest column, ~119 MB).
-- Rounding preserves all real precision: cell delta to 0.1 mV, trip distance to 1 m.
--
-- Forward path: src/lib/bydmate/telemetry-sanitizer.ts rounds these on ingest.
-- This migration rounds the existing rows. Run VACUUM FULL afterwards (outside a
-- transaction) to actually shrink the table.
--
-- jsonb_set is strict (NULL arg => NULL result), and ?| only guarantees that *some*
-- of the keys are present, so each value is wrapped in coalesce(..., 'null'::jsonb)
-- to stay non-null. With create_missing => false, absent paths are left untouched;
-- the jsonb_typeof guard leaves non-numeric values untouched.

update public.bydmate_telemetry_samples
set telemetry =
  jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            telemetry,
            '{cell_delta_v}',
            coalesce(case when jsonb_typeof(telemetry->'cell_delta_v') = 'number'
              then to_jsonb(round((telemetry->>'cell_delta_v')::numeric, 4))
              else telemetry->'cell_delta_v' end, 'null'::jsonb),
            false),
          '{range_est_km}',
          coalesce(case when jsonb_typeof(telemetry->'range_est_km') = 'number'
            then to_jsonb(round((telemetry->>'range_est_km')::numeric, 1))
            else telemetry->'range_est_km' end, 'null'::jsonb),
          false),
        '{current_trip_distance_km}',
        coalesce(case when jsonb_typeof(telemetry->'current_trip_distance_km') = 'number'
          then to_jsonb(round((telemetry->>'current_trip_distance_km')::numeric, 3))
          else telemetry->'current_trip_distance_km' end, 'null'::jsonb),
        false),
      '{current_trip_consumption_kwh_100km}',
      coalesce(case when jsonb_typeof(telemetry->'current_trip_consumption_kwh_100km') = 'number'
        then to_jsonb(round((telemetry->>'current_trip_consumption_kwh_100km')::numeric, 2))
        else telemetry->'current_trip_consumption_kwh_100km' end, 'null'::jsonb),
      false),
    '{kwh_charged}',
    coalesce(case when jsonb_typeof(telemetry->'kwh_charged') = 'number'
      then to_jsonb(round((telemetry->>'kwh_charged')::numeric, 3))
      else telemetry->'kwh_charged' end, 'null'::jsonb),
    false)
where telemetry ?| array[
  'cell_delta_v','range_est_km','current_trip_distance_km',
  'current_trip_consumption_kwh_100km','kwh_charged'
];
