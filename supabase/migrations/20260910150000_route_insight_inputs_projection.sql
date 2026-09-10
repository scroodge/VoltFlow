-- Route Insights must not rebuild GPS and temperature inputs for 80 trips at page load.
-- Keep a compact, owner-scoped per-trip projection instead. It contains only fields that
-- the authenticated Route Insights reader already returned from raw telemetry.

create table if not exists public.bydmate_trip_insight_inputs (
  trip_id uuid primary key references public.bydmate_trips (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  vehicle_id text not null,
  track jsonb not null default '[]'::jsonb,
  outside_temp_avg numeric,
  battery_temp_avg numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bydmate_trip_insight_inputs_user_vehicle_trip_idx
  on public.bydmate_trip_insight_inputs (user_id, vehicle_id, trip_id);

alter table public.bydmate_trip_insight_inputs enable row level security;

drop policy if exists "bydmate_trip_insight_inputs_select_own"
  on public.bydmate_trip_insight_inputs;
create policy "bydmate_trip_insight_inputs_select_own"
  on public.bydmate_trip_insight_inputs
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.bydmate_refresh_trip_insight_input(
  p_trip_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_trip public.bydmate_trips%rowtype;
  v_track jsonb;
  v_outside_temp_avg numeric;
  v_battery_temp_avg numeric;
begin
  select *
  into v_trip
  from public.bydmate_trips
  where id = p_trip_id;

  if not found or v_trip.ended_at is null or v_trip.track_point_count <= 1 then
    delete from public.bydmate_trip_insight_inputs
    where trip_id = p_trip_id;
    return false;
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'lat', point.lat,
      'lon', point.lon,
      'device_time', point.device_time,
      'power_kw', point.power_kw,
      'speed_kmh', point.speed_kmh,
      'soc', point.soc
    )
    order by point.device_time
  ), '[]'::jsonb)
  into v_track
  from (
    select lat, lon, device_time, power_kw, speed_kmh, soc
    from public.bydmate_trip_track_points
    where user_id = v_trip.user_id
      and trip_id = v_trip.id
    order by device_time
    limit 500
  ) as point;

  if jsonb_array_length(v_track) < 2 then
    delete from public.bydmate_trip_insight_inputs
    where trip_id = p_trip_id;
    return false;
  end if;

  select
    avg(public.bydmate_jsonb_numeric(sample.telemetry, 'outside_temp_c')),
    avg(public.bydmate_jsonb_numeric(sample.telemetry, 'battery_temp_c'))
  into v_outside_temp_avg, v_battery_temp_avg
  from (
    select telemetry
    from public.bydmate_telemetry_samples
    where user_id = v_trip.user_id
      and vehicle_id = v_trip.vehicle_id
      and device_time >= v_trip.started_at
      and device_time <= coalesce(v_trip.ended_at, v_trip.last_device_time)
    order by device_time
    limit 200
  ) as sample;

  insert into public.bydmate_trip_insight_inputs (
    trip_id,
    user_id,
    vehicle_id,
    track,
    outside_temp_avg,
    battery_temp_avg,
    updated_at
  )
  values (
    v_trip.id,
    v_trip.user_id,
    v_trip.vehicle_id,
    v_track,
    v_outside_temp_avg,
    v_battery_temp_avg,
    now()
  )
  on conflict (trip_id) do update
  set
    user_id = excluded.user_id,
    vehicle_id = excluded.vehicle_id,
    track = excluded.track,
    outside_temp_avg = excluded.outside_temp_avg,
    battery_temp_avg = excluded.battery_temp_avg,
    updated_at = excluded.updated_at;

  return true;
end;
$$;

create or replace function public.bydmate_refresh_trip_insight_input_on_close()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.ended_at is not distinct from new.ended_at then
    return null;
  end if;

  perform public.bydmate_refresh_trip_insight_input(new.id);
  return null;
end;
$$;

-- Deferral is intentional: the canonical ingest function first runs junk-trip deletion.
-- A deleted row is absent by commit, so no projection is written for it.
drop trigger if exists bydmate_refresh_trip_insight_input_on_close
  on public.bydmate_trips;
create constraint trigger bydmate_refresh_trip_insight_input_on_close
  after insert or update of ended_at
  on public.bydmate_trips
  deferrable initially deferred
  for each row
  when (new.ended_at is not null)
  execute function public.bydmate_refresh_trip_insight_input_on_close();

-- Operator-only, bounded historical backfill. Keep it unexposed to PostgREST clients;
-- callers resume by repeating it until it returns zero.
create or replace function public.bydmate_backfill_trip_insight_inputs(
  p_user_id uuid,
  p_vehicle_id text,
  p_limit integer default 80
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_trip_id uuid;
  v_count integer := 0;
begin
  for v_trip_id in
    select trip.id
    from public.bydmate_trips as trip
    where trip.user_id = p_user_id
      and trip.vehicle_id = p_vehicle_id
      and trip.ended_at is not null
      and trip.track_point_count > 1
      and not exists (
        select 1
        from public.bydmate_trip_insight_inputs as input
        where input.trip_id = trip.id
      )
    order by trip.started_at desc
    limit least(greatest(p_limit, 1), 80)
  loop
    if public.bydmate_refresh_trip_insight_input(v_trip_id) then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

-- Preserve the deployed RPC contract while making the page reader bounded to one compact
-- row per trip. `p_track_limit` remains for signature compatibility; projections retain
-- the current 500-point source cap and the only caller requests that cap.
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
  select
    input.trip_id,
    input.track,
    input.outside_temp_avg,
    input.battery_temp_avg
  from public.bydmate_trip_insight_inputs as input
  where input.user_id = p_user_id
    and input.vehicle_id = p_vehicle_id
    and input.trip_id = any(p_trip_ids);
$$;

revoke all on function public.bydmate_refresh_trip_insight_input(uuid) from public;
revoke all on function public.bydmate_refresh_trip_insight_input_on_close() from public;
revoke all on function public.bydmate_backfill_trip_insight_inputs(uuid, text, integer) from public;
grant execute on function public.bydmate_route_insight_inputs(uuid, text, uuid[], integer)
  to authenticated, service_role;
