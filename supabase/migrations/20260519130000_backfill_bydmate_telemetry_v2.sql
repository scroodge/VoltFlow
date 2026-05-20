-- One-time BYDMate telemetry v2 backfill.
-- Moves legacy bydmate_telemetry_points rows into lean samples, rebuilds hourly
-- rollups for those rows, and creates closed historical trips with GPS tracks.

create table if not exists public.bydmate_telemetry_backfills (
  name text primary key,
  ran_at timestamptz not null default now()
);

alter table public.bydmate_telemetry_backfills enable row level security;

create or replace function pg_temp.bydmate_jsonb_numeric(payload jsonb, key text)
returns numeric
language sql
immutable
as $$
  select case
    when nullif(payload->>key, '') ~ '^\s*[-+]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][-+]?\d+)?\s*$'
      then nullif(payload->>key, '')::numeric
    else null
  end;
$$;

create or replace function pg_temp.bydmate_jsonb_double(payload jsonb, key text)
returns double precision
language sql
immutable
as $$
  select case
    when nullif(payload->>key, '') ~ '^\s*[-+]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][-+]?\d+)?\s*$'
      then nullif(payload->>key, '')::double precision
    else null
  end;
$$;

insert into public.bydmate_telemetry_samples (
  vehicle_id,
  user_id,
  device_time,
  received_at,
  telemetry
)
select
  p.vehicle_id,
  p.user_id,
  p.device_time,
  p.received_at,
  p.telemetry
from public.bydmate_telemetry_points p
where not exists (
    select 1
    from public.bydmate_telemetry_backfills b
    where b.name = 'bydmate_telemetry_points_to_v2'
  )
  and not exists (
    select 1
    from public.bydmate_telemetry_samples s
    where s.user_id = p.user_id
      and s.vehicle_id = p.vehicle_id
      and s.device_time = p.device_time
      and s.received_at = p.received_at
  );

with legacy_hourly as (
  select
    p.user_id,
    p.vehicle_id,
    date_trunc('hour', p.device_time at time zone 'UTC') at time zone 'UTC' as hour_start,
    count(*)::integer as sample_count,
    min(pg_temp.bydmate_jsonb_numeric(p.telemetry, 'soc')) as soc_min,
    max(pg_temp.bydmate_jsonb_numeric(p.telemetry, 'soc')) as soc_max,
    (array_agg(pg_temp.bydmate_jsonb_numeric(p.telemetry, 'soc') order by p.device_time desc)
      filter (where pg_temp.bydmate_jsonb_numeric(p.telemetry, 'soc') is not null))[1] as soc_last,
    max(pg_temp.bydmate_jsonb_numeric(p.telemetry, 'speed_kmh')) as speed_max,
    avg(pg_temp.bydmate_jsonb_numeric(p.telemetry, 'power_kw')) as power_avg,
    avg(pg_temp.bydmate_jsonb_numeric(p.telemetry, 'battery_temp_c')) as battery_temp_avg,
    avg(pg_temp.bydmate_jsonb_numeric(p.telemetry, 'cabin_temp_c')) as cabin_temp_avg,
    avg(pg_temp.bydmate_jsonb_numeric(p.telemetry, 'outside_temp_c')) as outside_temp_avg
  from public.bydmate_telemetry_points p
  where not exists (
    select 1
    from public.bydmate_telemetry_backfills b
    where b.name = 'bydmate_telemetry_points_to_v2'
  )
  group by p.user_id, p.vehicle_id, date_trunc('hour', p.device_time at time zone 'UTC') at time zone 'UTC'
)
insert into public.bydmate_telemetry_hourly (
  user_id,
  vehicle_id,
  hour_start,
  sample_count,
  soc_min,
  soc_max,
  soc_last,
  speed_max,
  power_avg,
  battery_temp_avg,
  cabin_temp_avg,
  outside_temp_avg
)
select
  user_id,
  vehicle_id,
  hour_start,
  sample_count,
  soc_min,
  soc_max,
  soc_last,
  speed_max,
  power_avg,
  battery_temp_avg,
  cabin_temp_avg,
  outside_temp_avg
from legacy_hourly
on conflict (user_id, vehicle_id, hour_start) do update
set
  sample_count = public.bydmate_telemetry_hourly.sample_count + excluded.sample_count,
  soc_min = least(public.bydmate_telemetry_hourly.soc_min, excluded.soc_min),
  soc_max = greatest(public.bydmate_telemetry_hourly.soc_max, excluded.soc_max),
  soc_last = coalesce(excluded.soc_last, public.bydmate_telemetry_hourly.soc_last),
  speed_max = greatest(public.bydmate_telemetry_hourly.speed_max, excluded.speed_max),
  power_avg = (
    coalesce(public.bydmate_telemetry_hourly.power_avg, 0) * public.bydmate_telemetry_hourly.sample_count
    + coalesce(excluded.power_avg, 0) * excluded.sample_count
  ) / nullif(public.bydmate_telemetry_hourly.sample_count + excluded.sample_count, 0),
  battery_temp_avg = (
    coalesce(public.bydmate_telemetry_hourly.battery_temp_avg, 0) * public.bydmate_telemetry_hourly.sample_count
    + coalesce(excluded.battery_temp_avg, 0) * excluded.sample_count
  ) / nullif(public.bydmate_telemetry_hourly.sample_count + excluded.sample_count, 0),
  cabin_temp_avg = (
    coalesce(public.bydmate_telemetry_hourly.cabin_temp_avg, 0) * public.bydmate_telemetry_hourly.sample_count
    + coalesce(excluded.cabin_temp_avg, 0) * excluded.sample_count
  ) / nullif(public.bydmate_telemetry_hourly.sample_count + excluded.sample_count, 0),
  outside_temp_avg = (
    coalesce(public.bydmate_telemetry_hourly.outside_temp_avg, 0) * public.bydmate_telemetry_hourly.sample_count
    + coalesce(excluded.outside_temp_avg, 0) * excluded.sample_count
  ) / nullif(public.bydmate_telemetry_hourly.sample_count + excluded.sample_count, 0);

drop table if exists pg_temp.bydmate_legacy_trip_segments;

create temp table bydmate_legacy_trip_segments on commit drop as
with ordered_points as (
  select
    p.*,
    lag(p.device_time) over (
      partition by p.user_id, p.vehicle_id
      order by p.device_time, p.id
    ) as previous_device_time
  from public.bydmate_telemetry_points p
  where not exists (
    select 1
    from public.bydmate_telemetry_backfills b
    where b.name = 'bydmate_telemetry_points_to_v2'
  )
),
segmented_points as (
  select
    *,
    sum(
      case
        when previous_device_time is null
          or device_time - previous_device_time > interval '5 minutes'
          then 1
        else 0
      end
    ) over (
      partition by user_id, vehicle_id
      order by device_time, id
      rows between unbounded preceding and current row
    ) as trip_number
  from ordered_points
),
point_metrics as (
  select
    *,
    pg_temp.bydmate_jsonb_numeric(telemetry, 'soc') as soc,
    pg_temp.bydmate_jsonb_numeric(telemetry, 'speed_kmh') as speed_kmh,
    pg_temp.bydmate_jsonb_numeric(telemetry, 'current_trip_distance_km') as current_trip_distance_km,
    pg_temp.bydmate_jsonb_numeric(telemetry, 'current_trip_consumption_kwh_100km') as consumption_kwh_100km
  from segmented_points
)
select
  user_id,
  vehicle_id,
  trip_number,
  min(device_time) as started_at,
  max(device_time) as ended_at,
  max(device_time) as last_device_time,
  count(*)::integer as sample_count,
  count(*) filter (
    where pg_temp.bydmate_jsonb_double(location, 'lat') is not null
      and pg_temp.bydmate_jsonb_double(location, 'lon') is not null
  )::integer as track_point_count,
  (array_agg(current_trip_distance_km order by device_time desc)
    filter (where current_trip_distance_km is not null))[1] as distance_km,
  (array_agg(soc order by device_time asc)
    filter (where soc is not null))[1] as soc_start,
  (array_agg(soc order by device_time desc)
    filter (where soc is not null))[1] as soc_end,
  max(speed_kmh) as max_speed_kmh,
  avg(speed_kmh) as avg_speed_kmh,
  avg(consumption_kwh_100km) as avg_consumption_kwh_100km
from point_metrics
group by user_id, vehicle_id, trip_number;

insert into public.bydmate_trips (
  user_id,
  vehicle_id,
  started_at,
  ended_at,
  last_device_time,
  sample_count,
  track_point_count,
  distance_km,
  soc_start,
  soc_end,
  max_speed_kmh,
  avg_speed_kmh,
  avg_consumption_kwh_100km
)
select
  s.user_id,
  s.vehicle_id,
  s.started_at,
  s.ended_at,
  s.last_device_time,
  s.sample_count,
  s.track_point_count,
  s.distance_km,
  s.soc_start,
  s.soc_end,
  s.max_speed_kmh,
  s.avg_speed_kmh,
  s.avg_consumption_kwh_100km
from bydmate_legacy_trip_segments s
where not exists (
  select 1
  from public.bydmate_trips t
  where t.user_id = s.user_id
    and t.vehicle_id = s.vehicle_id
    and t.started_at = s.started_at
    and t.last_device_time = s.last_device_time
);

update public.bydmate_trips t
set
  ended_at = s.ended_at,
  sample_count = s.sample_count,
  track_point_count = s.track_point_count,
  distance_km = s.distance_km,
  soc_start = s.soc_start,
  soc_end = s.soc_end,
  max_speed_kmh = s.max_speed_kmh,
  avg_speed_kmh = s.avg_speed_kmh,
  avg_consumption_kwh_100km = s.avg_consumption_kwh_100km
from bydmate_legacy_trip_segments s
where t.user_id = s.user_id
  and t.vehicle_id = s.vehicle_id
  and t.started_at = s.started_at
  and t.last_device_time = s.last_device_time;

with ordered_points as (
  select
    p.*,
    lag(p.device_time) over (
      partition by p.user_id, p.vehicle_id
      order by p.device_time, p.id
    ) as previous_device_time
  from public.bydmate_telemetry_points p
  where not exists (
    select 1
    from public.bydmate_telemetry_backfills b
    where b.name = 'bydmate_telemetry_points_to_v2'
  )
),
segmented_points as (
  select
    *,
    sum(
      case
        when previous_device_time is null
          or device_time - previous_device_time > interval '5 minutes'
          then 1
        else 0
      end
    ) over (
      partition by user_id, vehicle_id
      order by device_time, id
      rows between unbounded preceding and current row
    ) as trip_number
  from ordered_points
),
track_points as (
  select
    p.*,
    pg_temp.bydmate_jsonb_double(p.location, 'lat') as lat,
    pg_temp.bydmate_jsonb_double(p.location, 'lon') as lon,
    pg_temp.bydmate_jsonb_numeric(p.location, 'accuracy_m') as accuracy_m,
    pg_temp.bydmate_jsonb_numeric(p.location, 'bearing_deg') as bearing_deg,
    pg_temp.bydmate_jsonb_numeric(p.telemetry, 'speed_kmh') as speed_kmh,
    pg_temp.bydmate_jsonb_numeric(p.telemetry, 'power_kw') as power_kw,
    pg_temp.bydmate_jsonb_numeric(p.telemetry, 'soc') as soc
  from segmented_points p
)
insert into public.bydmate_trip_track_points (
  trip_id,
  user_id,
  device_time,
  lat,
  lon,
  accuracy_m,
  bearing_deg,
  speed_kmh,
  power_kw,
  soc
)
select
  t.id,
  p.user_id,
  p.device_time,
  p.lat,
  p.lon,
  p.accuracy_m,
  p.bearing_deg,
  p.speed_kmh,
  p.power_kw,
  p.soc
from track_points p
join bydmate_legacy_trip_segments s
  on s.user_id = p.user_id
  and s.vehicle_id = p.vehicle_id
  and s.trip_number = p.trip_number
join public.bydmate_trips t
  on t.user_id = s.user_id
  and t.vehicle_id = s.vehicle_id
  and t.started_at = s.started_at
  and t.last_device_time = s.last_device_time
where p.lat is not null
  and p.lon is not null
  and not exists (
    select 1
    from public.bydmate_trip_track_points existing
    where existing.trip_id = t.id
      and existing.device_time = p.device_time
      and existing.lat = p.lat
      and existing.lon = p.lon
  );

insert into public.bydmate_telemetry_backfills (name)
select 'bydmate_telemetry_points_to_v2'
where not exists (
    select 1
    from public.bydmate_telemetry_backfills b
    where b.name = 'bydmate_telemetry_points_to_v2'
  );
