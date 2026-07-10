-- Analytics read-model repairs: keep high-volume aggregation in Postgres instead of
-- truncating PostgREST responses or issuing one request per trip/calendar day.
-- All functions are SECURITY INVOKER. Normal calls remain subject to RLS; the explicit
-- user id also keeps the local service-role development path working.

create index if not exists bydmate_telemetry_samples_soh_analytics_idx
  on public.bydmate_telemetry_samples (user_id, vehicle_id, device_time desc)
  where telemetry ? 'soh_percent';

create or replace function public.bydmate_phantom_drain_daily(
  p_user_id uuid,
  p_vehicle_id text,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  date date,
  soc_start numeric,
  soc_end numeric,
  drain_percent numeric,
  idle_hours numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with samples as (
    select
      device_time,
      (device_time at time zone 'UTC')::date as sample_date,
      public.bydmate_jsonb_numeric(telemetry, 'soc') as soc,
      coalesce(public.bydmate_jsonb_numeric(telemetry, 'speed_kmh'), 0) as speed_kmh,
      coalesce(public.bydmate_jsonb_numeric(telemetry, 'power_kw'), 0) as power_kw,
      case
        when coalesce(public.bydmate_jsonb_numeric(telemetry, 'charge_power_kw'), 0) > 0 then true
        -- Di+ explicitly reports 1 when the gun is unplugged. Do not let a stale
        -- normalized is_charging Boolean suppress legitimate parked idle time.
        when diplus_charge_gun_state = '1' then false
        else lower(coalesce(telemetry->>'is_charging', '')) in ('true', '1', 'yes', 'on')
      end as is_charging,
      lag(device_time) over (order by device_time) as previous_device_time
    from public.bydmate_telemetry_samples
    where user_id = p_user_id
      and vehicle_id = p_vehicle_id
      and device_time >= p_from
      and device_time <= p_to
  ),
  daily as (
    select
      sample_date,
      array_agg(soc order by device_time) filter (where soc is not null) as soc_values,
      sum(
        case
          when soc is not null
            and speed_kmh <= 0.5
            and abs(power_kw) <= 0.1
            and not is_charging
            and previous_device_time is not null
            and device_time > previous_device_time
            and device_time - previous_device_time < interval '6 hours'
          then extract(epoch from device_time - previous_device_time) * 1000
          else 0
        end
      ) as idle_ms
    from samples
    group by sample_date
  )
  select
    sample_date,
    soc_values[1],
    soc_values[array_length(soc_values, 1)],
    soc_values[1] - soc_values[array_length(soc_values, 1)],
    idle_ms / 3600000
  from daily
  where array_length(soc_values, 1) > 0
    and idle_ms / 3600000 >= 4
    and soc_values[1] > soc_values[array_length(soc_values, 1)]
  order by sample_date;
$$;

create or replace function public.bydmate_soh_daily(
  p_user_id uuid,
  p_vehicle_id text,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  device_time timestamptz,
  soh_percent numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select sampled.device_time, sampled.soh_percent
  from (
    select distinct on ((device_time at time zone 'UTC')::date)
      device_time,
      public.bydmate_jsonb_numeric(telemetry, 'soh_percent') as soh_percent
    from public.bydmate_telemetry_samples
    where user_id = p_user_id
      and (p_vehicle_id is null or vehicle_id = p_vehicle_id)
      and device_time >= p_from
      and device_time <= p_to
      and telemetry ? 'soh_percent'
      and public.bydmate_jsonb_numeric(telemetry, 'soh_percent') between 0 and 100
    order by (device_time at time zone 'UTC')::date, device_time desc
  ) as sampled
  order by sampled.device_time;
$$;

create or replace function public.bydmate_route_insight_inputs(
  p_user_id uuid,
  p_vehicle_id text,
  p_trip_ids uuid[],
  p_track_limit integer default 500
)
returns table (
  trip_id uuid,
  track jsonb,
  outside_temp_avg numeric,
  battery_temp_avg numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with owned_trips as (
    select id, started_at, coalesce(ended_at, last_device_time) as ended_at
    from public.bydmate_trips
    where user_id = p_user_id
      and vehicle_id = p_vehicle_id
      and id = any(p_trip_ids)
  )
  select
    trip.id as trip_id,
    coalesce(track.track, '[]'::jsonb) as track,
    temperatures.outside_temp_avg,
    temperatures.battery_temp_avg
  from owned_trips as trip
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'lat', point.lat,
        'lon', point.lon,
        'device_time', point.device_time,
        'power_kw', point.power_kw,
        'speed_kmh', point.speed_kmh,
        'soc', point.soc
      ) order by point.device_time
    ) as track
    from (
      select lat, lon, device_time, power_kw, speed_kmh, soc
      from public.bydmate_trip_track_points
      where user_id = p_user_id
        and trip_id = trip.id
      order by device_time
      limit least(greatest(p_track_limit, 2), 500)
    ) as point
  ) as track on true
  left join lateral (
    select
      avg(public.bydmate_jsonb_numeric(sample.telemetry, 'outside_temp_c')) as outside_temp_avg,
      avg(public.bydmate_jsonb_numeric(sample.telemetry, 'battery_temp_c')) as battery_temp_avg
    from (
      select telemetry
      from public.bydmate_telemetry_samples
      where user_id = p_user_id
        and vehicle_id = p_vehicle_id
        and device_time >= trip.started_at
        and device_time <= trip.ended_at
      order by device_time
      limit 200
    ) as sample
  ) as temperatures on true;
$$;

revoke all on function public.bydmate_phantom_drain_daily(uuid, text, timestamptz, timestamptz) from public;
revoke all on function public.bydmate_soh_daily(uuid, text, timestamptz, timestamptz) from public;
revoke all on function public.bydmate_route_insight_inputs(uuid, text, uuid[], integer) from public;

grant execute on function public.bydmate_phantom_drain_daily(uuid, text, timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.bydmate_soh_daily(uuid, text, timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.bydmate_route_insight_inputs(uuid, text, uuid[], integer) to authenticated, service_role;
