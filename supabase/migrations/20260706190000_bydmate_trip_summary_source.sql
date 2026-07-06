-- Distinguish telemetry-derived trips from BYD-side trip-history imports.
--
-- Some BYD models (confirmed: a Yuan UP 2025 / DiLink 5) write their own trip
-- log to /storage/emulated/0/energydata/EC_database.db, readable by VoltFlow
-- Mate WITHOUT ADB (see supabase/TELEMETRY.md). The Android app already
-- imports these locally (EnergyDataReader + HistoryImporter); this migration
-- lets it also push them to VoltFlow as a distinct trip source, so users
-- without ADB still get trip/consumption history in the cloud.
--
-- These are per-trip AGGREGATES only (no telemetry samples, no GPS track) --
-- bypassing bydmate_ingest_telemetry and its junk-trip rules entirely.
--
-- Idempotent: self-hosted instances have no supabase_migrations tracking, so
-- this file must be safe to re-run.

alter table public.bydmate_trips
  add column if not exists source text not null default 'telemetry';

comment on column public.bydmate_trips.source is
  'telemetry (default, derived from bydmate_telemetry_samples) or byd_energydata (imported from the car''s own trip log, no ADB required, no SOC/track data).';

-- Dedupe key for energydata imports: the source file has no stable external id
-- exposed to the cloud API, so (user, vehicle, started_at) is the natural key
-- for idempotent re-sync. Only applies to byd_energydata rows -- telemetry
-- trips are keyed by the existing open-trip-per-vehicle uniqueness instead.
create unique index if not exists bydmate_trips_energydata_dedupe_idx
  on public.bydmate_trips (user_id, vehicle_id, started_at)
  where source = 'byd_energydata';

create index if not exists bydmate_trips_source_idx
  on public.bydmate_trips (user_id, vehicle_id, source);

-- Batch upsert for BYD-side trip-log imports (energydata). Each element of
-- p_trips is { start_timestamp, end_timestamp (epoch seconds), distance_km,
-- energy_kwh, duration_seconds }. avg_speed_kmh / avg_consumption_kwh_100km
-- are derived server-side so the existing history UI (which already renders
-- those fields) needs no changes. No SOC, no telemetry samples, no GPS track
-- -- those UI sections fall back to their existing empty states.
create or replace function public.bydmate_ingest_trip_summaries(
  p_user_id uuid,
  p_vehicle_id text,
  p_trips jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
  v_updated integer := 0;
begin
  if jsonb_typeof(p_trips) <> 'array' then
    raise exception 'p_trips must be a JSON array';
  end if;

  with input as (
    select
      to_timestamp((elem->>'start_timestamp')::bigint) as started_at,
      to_timestamp((elem->>'end_timestamp')::bigint) as ended_at,
      nullif(elem->>'distance_km', '')::numeric as distance_km,
      nullif(elem->>'energy_kwh', '')::numeric as energy_kwh,
      nullif(elem->>'duration_seconds', '')::numeric as duration_seconds
    from jsonb_array_elements(p_trips) as elem
    where elem->>'start_timestamp' is not null
      and elem->>'end_timestamp' is not null
  ),
  upserted as (
    insert into public.bydmate_trips (
      user_id, vehicle_id, started_at, ended_at, last_device_time,
      sample_count, track_point_count, distance_km,
      avg_speed_kmh, avg_consumption_kwh_100km, source
    )
    select
      p_user_id,
      p_vehicle_id,
      started_at,
      ended_at,
      ended_at,
      0,
      0,
      distance_km,
      case
        when duration_seconds > 0 and distance_km is not null
          then distance_km / (duration_seconds / 3600.0)
        else null
      end,
      case
        when distance_km > 0 and energy_kwh is not null
          then (energy_kwh / distance_km) * 100
        else null
      end,
      'byd_energydata'
    from input
    on conflict (user_id, vehicle_id, started_at) where source = 'byd_energydata'
    do update set
      ended_at = excluded.ended_at,
      last_device_time = excluded.last_device_time,
      distance_km = excluded.distance_km,
      avg_speed_kmh = excluded.avg_speed_kmh,
      avg_consumption_kwh_100km = excluded.avg_consumption_kwh_100km
    returning (xmax = 0) as is_insert
  )
  select
    count(*) filter (where is_insert),
    count(*) filter (where not is_insert)
  into v_inserted, v_updated
  from upserted;

  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated);
end;
$$;

revoke all on function public.bydmate_ingest_trip_summaries(uuid, text, jsonb)
  from public;
grant execute on function public.bydmate_ingest_trip_summaries(uuid, text, jsonb)
  to service_role;
