-- Add fuel_kwh column to bydmate_trips for PHEV fuel consumption data.
-- Source: BYD energydata EC_database.db "fuel" column (liters equivalent).
-- NULL for pure EVs; > 0 for PHEV (DM-i) models.
-- Idempotent: safe to re-run.

alter table public.bydmate_trips
  add column if not exists fuel_kwh numeric;

comment on column public.bydmate_trips.fuel_kwh is
  'Fuel consumption from BYD energydata (liters equivalent). NULL for pure EVs, > 0 for PHEV models.';

-- Update bydmate_ingest_trip_summaries to accept fuel_kwh
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
      nullif(elem->>'duration_seconds', '')::numeric as duration_seconds,
      nullif(elem->>'fuel_kwh', '')::numeric as fuel_kwh
    from jsonb_array_elements(p_trips) as elem
    where elem->>'start_timestamp' is not null
      and elem->>'end_timestamp' is not null
  ),
  upserted as (
    insert into public.bydmate_trips (
      user_id, vehicle_id, started_at, ended_at, last_device_time,
      sample_count, track_point_count, distance_km,
      avg_speed_kmh, avg_consumption_kwh_100km, source, fuel_kwh
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
      'byd_energydata',
      fuel_kwh
    from input
    on conflict (user_id, vehicle_id, started_at) where source = 'byd_energydata'
    do update set
      ended_at = excluded.ended_at,
      last_device_time = excluded.last_device_time,
      distance_km = excluded.distance_km,
      avg_speed_kmh = excluded.avg_speed_kmh,
      avg_consumption_kwh_100km = excluded.avg_consumption_kwh_100km,
      fuel_kwh = excluded.fuel_kwh
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
