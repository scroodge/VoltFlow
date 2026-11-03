-- Distilled telemetry that outlives the raw-sample purge (BACKLOG "Prod DB retention & cleanup",
-- item 1b). Premium raw samples are to be kept for 90 days only; trip detail charts and
-- charge-session curves have no other source, so each finished trip / session gets one compact
-- series row, and each car-day gets one row of the slow-moving values nothing reads yet
-- (tyre pressure, lifetime energy / mileage counters). di+ `battery_capacity_kwh` is left out: on
-- prod it is 65535 / 0 / -1 for most cars and 1-4 for one, not a capacity.
--
-- Ownership: user-owned history, app-maintained, Postgres. Users can read their own rows; only
-- the SECURITY DEFINER distill functions write.
--
-- Series layout is columnar jsonb ({"t": [epoch ms...], "soc": [...], ...}) so TOAST compresses it.
-- Points are picked with the same index downsampling as downsampleByIndex
-- (src/lib/voltflowmate/telemetry-ranges.ts): idx_i = round(i * (n - 1) / (max - 1)), first and
-- last kept. Session series hold the whole sample window *unfiltered* with is_charging /
-- charge_power_kw / gun state per point: the read path applies the existing TS filter
-- isTelemetryHistoryCharging, so the charging rules are not copied into SQL.
--
-- This migration creates tables and functions only. The cron schedule ships separately after
-- the size check on a sample.
--
-- The foreign keys lock bydmate_trips / charging_sessions against writes until commit, which
-- stalls telemetry ingest. Keep this transaction to DDL only (no backfill), and give up rather than
-- queue behind a long transaction.
set local lock_timeout = '5s';

create table if not exists public.bydmate_trip_series (
  trip_id uuid primary key references public.bydmate_trips (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  vehicle_id text not null,
  source_sample_count integer not null,
  point_count integer not null,
  series jsonb not null,
  distilled_at timestamptz not null default now()
);

create index if not exists bydmate_trip_series_user_idx
  on public.bydmate_trip_series (user_id);

create table if not exists public.bydmate_charging_session_series (
  session_id uuid primary key references public.charging_sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  vehicle_id text,
  window_from timestamptz not null,
  window_to timestamptz not null,
  source_sample_count integer not null,
  point_count integer not null,
  series jsonb not null,
  distilled_at timestamptz not null default now()
);

create index if not exists bydmate_charging_session_series_user_idx
  on public.bydmate_charging_session_series (user_id);

create table if not exists public.bydmate_vehicle_daily_stats (
  user_id uuid not null references auth.users (id) on delete cascade,
  vehicle_id text not null,
  day date not null,
  sample_count integer not null,
  tire_press_fl_min_kpa numeric,
  tire_press_fl_max_kpa numeric,
  tire_press_fr_min_kpa numeric,
  tire_press_fr_max_kpa numeric,
  tire_press_rl_min_kpa numeric,
  tire_press_rl_max_kpa numeric,
  tire_press_rr_min_kpa numeric,
  tire_press_rr_max_kpa numeric,
  total_elec_consumption_kwh numeric,
  lifetime_kwh numeric,
  lifetime_mileage_km numeric,
  updated_at timestamptz not null default now(),
  primary key (user_id, vehicle_id, day)
);

alter table public.bydmate_trip_series enable row level security;
alter table public.bydmate_charging_session_series enable row level security;
alter table public.bydmate_vehicle_daily_stats enable row level security;

drop policy if exists "bydmate_trip_series_select_own" on public.bydmate_trip_series;
create policy "bydmate_trip_series_select_own"
  on public.bydmate_trip_series
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "bydmate_charging_session_series_select_own"
  on public.bydmate_charging_session_series;
create policy "bydmate_charging_session_series_select_own"
  on public.bydmate_charging_session_series
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "bydmate_vehicle_daily_stats_select_own"
  on public.bydmate_vehicle_daily_stats;
create policy "bydmate_vehicle_daily_stats_select_own"
  on public.bydmate_vehicle_daily_stats
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.bydmate_trip_series from anon;
revoke all on public.bydmate_charging_session_series from anon;
revoke all on public.bydmate_vehicle_daily_stats from anon;
revoke insert, update, delete, truncate on public.bydmate_trip_series from authenticated;
revoke insert, update, delete, truncate on public.bydmate_charging_session_series from authenticated;
revoke insert, update, delete, truncate on public.bydmate_vehicle_daily_stats from authenticated;
grant select on public.bydmate_trip_series to authenticated;
grant select on public.bydmate_charging_session_series to authenticated;
grant select on public.bydmate_vehicle_daily_stats to authenticated;
grant all on public.bydmate_trip_series to service_role;
grant all on public.bydmate_charging_session_series to service_role;
grant all on public.bydmate_vehicle_daily_stats to service_role;

-- One downsampled, columnar series for a user/vehicle/time window.
create or replace function public.bydmate_build_telemetry_series(
  p_user_id uuid,
  p_vehicle_id text,
  p_from timestamptz,
  p_to timestamptz,
  p_max_points integer
)
returns table (series jsonb, point_count integer, source_sample_count integer)
language sql
stable
security invoker
set search_path = public
as $$
  with s as (
    select
      x.device_time,
      x.telemetry,
      x.diplus_charge_gun_state,
      x.diplus_min_cell_voltage_v,
      x.diplus_max_cell_voltage_v,
      x.diplus_cell_delta_v,
      row_number() over (order by x.device_time) - 1 as idx,
      count(*) over () as n
    from public.bydmate_telemetry_samples x
    where x.user_id = p_user_id
      and x.vehicle_id = p_vehicle_id
      and x.device_time >= p_from
      and x.device_time <= p_to
  ),
  picks as (
    select distinct floor(i * (m.n - 1)::numeric / (greatest(p_max_points, 2) - 1) + 0.5)::bigint as idx
    from (select max(n) as n from s) m
    cross join generate_series(0, greatest(p_max_points, 2) - 1) i
    where m.n > greatest(p_max_points, 2)
  ),
  k as (
    select s.*
    from s
    where s.n <= greatest(p_max_points, 2)
       or s.idx in (select idx from picks)
  )
  select
    case when count(*) = 0 then '{}'::jsonb else jsonb_build_object(
      't', jsonb_agg((extract(epoch from k.device_time) * 1000)::bigint order by k.device_time),
      'soc', jsonb_agg(k.telemetry -> 'soc' order by k.device_time),
      'power_kw', jsonb_agg(k.telemetry -> 'power_kw' order by k.device_time),
      'charge_power_kw', jsonb_agg(k.telemetry -> 'charge_power_kw' order by k.device_time),
      'is_charging', jsonb_agg(k.telemetry -> 'is_charging' order by k.device_time),
      'speed_kmh', jsonb_agg(k.telemetry -> 'speed_kmh' order by k.device_time),
      'odometer_km', jsonb_agg(k.telemetry -> 'odometer_km' order by k.device_time),
      'current_trip_distance_km', jsonb_agg(k.telemetry -> 'current_trip_distance_km' order by k.device_time),
      'battery_temp_c', jsonb_agg(k.telemetry -> 'battery_temp_c' order by k.device_time),
      'outside_temp_c', jsonb_agg(k.telemetry -> 'outside_temp_c' order by k.device_time),
      'cabin_temp_c', jsonb_agg(k.telemetry -> 'cabin_temp_c' order by k.device_time),
      'charge_current_a', jsonb_agg(k.telemetry -> 'charge_current_a' order by k.device_time),
      'battery_voltage_v', jsonb_agg(k.telemetry -> 'battery_voltage_v' order by k.device_time),
      'charge_type', jsonb_agg(k.telemetry -> 'charge_type' order by k.device_time),
      'diplus_charge_gun_state', jsonb_agg(to_jsonb(k.diplus_charge_gun_state) order by k.device_time),
      'diplus_min_cell_voltage_v', jsonb_agg(to_jsonb(k.diplus_min_cell_voltage_v) order by k.device_time),
      'diplus_max_cell_voltage_v', jsonb_agg(to_jsonb(k.diplus_max_cell_voltage_v) order by k.device_time),
      'diplus_cell_delta_v', jsonb_agg(to_jsonb(k.diplus_cell_delta_v) order by k.device_time)
    ) end,
    count(*)::integer,
    coalesce(max(k.n), 0)::integer
  from k;
$$;

-- A finished trip's series. Never overwrites a stored series with an empty one: after the raw
-- purge a re-distill finds no samples, and the stored series is then the only copy.
create or replace function public.bydmate_distill_trip_series(p_trip_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip public.bydmate_trips%rowtype;
  v_series record;
begin
  select * into v_trip from public.bydmate_trips where id = p_trip_id;
  if not found or v_trip.ended_at is null then
    return null;
  end if;

  select * into v_series
  from public.bydmate_build_telemetry_series(
    v_trip.user_id, v_trip.vehicle_id, v_trip.started_at, v_trip.ended_at, 1200
  );

  insert into public.bydmate_trip_series (
    trip_id, user_id, vehicle_id, source_sample_count, point_count, series, distilled_at
  )
  values (
    v_trip.id, v_trip.user_id, v_trip.vehicle_id,
    v_series.source_sample_count, v_series.point_count, v_series.series, now()
  )
  on conflict (trip_id) do update
  set source_sample_count = excluded.source_sample_count,
      point_count = excluded.point_count,
      series = excluded.series,
      distilled_at = excluded.distilled_at
  where excluded.source_sample_count > 0;

  return v_series.point_count;
end;
$$;

-- A finished charging session's sample window, matching resolveChargingSessionSampleWindow
-- (src/lib/voltflowmate/telemetry-session-window.ts) and the vehicle resolution of
-- resolveChargingSessionVehicleId (car alias first, else the user's latest live snapshot).
create or replace function public.bydmate_distill_charging_session_series(p_session_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.charging_sessions%rowtype;
  v_vehicle_id text;
  v_to timestamptz;
  v_series record;
begin
  select * into v_session from public.charging_sessions where id = p_session_id;
  if not found or v_session.started_at is null or v_session.status = 'charging' then
    return null;
  end if;

  v_to := coalesce(v_session.stopped_at, v_session.updated_at);
  if v_to is null then
    return null;
  end if;
  if v_session.status = 'completed'
     and v_session.current_percent is not null
     and v_session.target_percent is not null
     and v_session.current_percent >= v_session.target_percent
  then
    v_to := v_to + interval '10 minutes';
  end if;

  select nullif(trim(c.vehicle_alias), '') into v_vehicle_id
  from public.cars c
  where c.id = v_session.car_id and c.user_id = v_session.user_id;

  if v_vehicle_id is null then
    select l.vehicle_id into v_vehicle_id
    from public.bydmate_live_snapshots l
    where l.user_id = v_session.user_id
    order by l.received_at desc
    limit 1;
  end if;

  if v_vehicle_id is null then
    select '{}'::jsonb as series, 0 as point_count, 0 as source_sample_count into v_series;
  else
    select * into v_series
    from public.bydmate_build_telemetry_series(
      v_session.user_id, v_vehicle_id, v_session.started_at, v_to, 1200
    );
  end if;

  insert into public.bydmate_charging_session_series (
    session_id, user_id, vehicle_id, window_from, window_to,
    source_sample_count, point_count, series, distilled_at
  )
  values (
    v_session.id, v_session.user_id, v_vehicle_id, v_session.started_at, v_to,
    v_series.source_sample_count, v_series.point_count, v_series.series, now()
  )
  on conflict (session_id) do update
  set vehicle_id = excluded.vehicle_id,
      window_from = excluded.window_from,
      window_to = excluded.window_to,
      source_sample_count = excluded.source_sample_count,
      point_count = excluded.point_count,
      series = excluded.series,
      distilled_at = excluded.distilled_at
  where excluded.source_sample_count > 0;

  return v_series.point_count;
end;
$$;

-- One UTC day of slow-moving per-car values. Cars come from the small hourly rollup and each one
-- is read through the (user_id, vehicle_id, device_time) index: the device_time BRIN index is
-- useless here (rows are not stored in time order), and a plain day filter read the whole table
-- (~40 s per day on prod). Every hourly car-day gets a row, sample_count 0 when the raw rows are
-- gone, so the backfill can tell a processed day from a missing one; a recount never replaces
-- real values with an empty day.
create or replace function public.bydmate_distill_vehicle_day(p_day date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  insert into public.bydmate_vehicle_daily_stats (
    user_id, vehicle_id, day, sample_count,
    tire_press_fl_min_kpa, tire_press_fl_max_kpa,
    tire_press_fr_min_kpa, tire_press_fr_max_kpa,
    tire_press_rl_min_kpa, tire_press_rl_max_kpa,
    tire_press_rr_min_kpa, tire_press_rr_max_kpa,
    total_elec_consumption_kwh,
    lifetime_kwh, lifetime_mileage_km, updated_at
  )
  select
    p.user_id,
    p.vehicle_id,
    p_day,
    a.sample_count,
    a.tire_press_fl_min_kpa, a.tire_press_fl_max_kpa,
    a.tire_press_fr_min_kpa, a.tire_press_fr_max_kpa,
    a.tire_press_rl_min_kpa, a.tire_press_rl_max_kpa,
    a.tire_press_rr_min_kpa, a.tire_press_rr_max_kpa,
    a.total_elec_consumption_kwh,
    a.lifetime_kwh, a.lifetime_mileage_km,
    now()
  from (
    select distinct h.user_id, h.vehicle_id
    from public.bydmate_telemetry_hourly h
    where h.hour_start >= (p_day::timestamp at time zone 'UTC')
      and h.hour_start < ((p_day + 1)::timestamp at time zone 'UTC')
  ) p
  cross join lateral (
  select
    count(*)::integer as sample_count,
    min(s.diplus_tire_press_fl_kpa) filter (where s.diplus_tire_press_fl_kpa > 0) as tire_press_fl_min_kpa,
    max(s.diplus_tire_press_fl_kpa) filter (where s.diplus_tire_press_fl_kpa > 0) as tire_press_fl_max_kpa,
    min(s.diplus_tire_press_fr_kpa) filter (where s.diplus_tire_press_fr_kpa > 0) as tire_press_fr_min_kpa,
    max(s.diplus_tire_press_fr_kpa) filter (where s.diplus_tire_press_fr_kpa > 0) as tire_press_fr_max_kpa,
    min(s.diplus_tire_press_rl_kpa) filter (where s.diplus_tire_press_rl_kpa > 0) as tire_press_rl_min_kpa,
    max(s.diplus_tire_press_rl_kpa) filter (where s.diplus_tire_press_rl_kpa > 0) as tire_press_rl_max_kpa,
    min(s.diplus_tire_press_rr_kpa) filter (where s.diplus_tire_press_rr_kpa > 0) as tire_press_rr_min_kpa,
    max(s.diplus_tire_press_rr_kpa) filter (where s.diplus_tire_press_rr_kpa > 0) as tire_press_rr_max_kpa,
    (array_agg(s.diplus_total_elec_consumption_kwh order by s.device_time desc)
      filter (where s.diplus_total_elec_consumption_kwh > 0))[1] as total_elec_consumption_kwh,
    (array_agg(s.autoservice_lifetime_kwh order by s.device_time desc)
      filter (where s.autoservice_lifetime_kwh > 0))[1] as lifetime_kwh,
    (array_agg(s.autoservice_lifetime_mileage_km order by s.device_time desc)
      filter (where s.autoservice_lifetime_mileage_km > 0))[1] as lifetime_mileage_km
  from public.bydmate_telemetry_samples s
  where s.user_id = p.user_id
    and s.vehicle_id = p.vehicle_id
    and s.device_time >= (p_day::timestamp at time zone 'UTC')
    and s.device_time < ((p_day + 1)::timestamp at time zone 'UTC')
  ) a
  on conflict (user_id, vehicle_id, day) do update
  set sample_count = excluded.sample_count,
      tire_press_fl_min_kpa = excluded.tire_press_fl_min_kpa,
      tire_press_fl_max_kpa = excluded.tire_press_fl_max_kpa,
      tire_press_fr_min_kpa = excluded.tire_press_fr_min_kpa,
      tire_press_fr_max_kpa = excluded.tire_press_fr_max_kpa,
      tire_press_rl_min_kpa = excluded.tire_press_rl_min_kpa,
      tire_press_rl_max_kpa = excluded.tire_press_rl_max_kpa,
      tire_press_rr_min_kpa = excluded.tire_press_rr_min_kpa,
      tire_press_rr_max_kpa = excluded.tire_press_rr_max_kpa,
      total_elec_consumption_kwh = excluded.total_elec_consumption_kwh,
      lifetime_kwh = excluded.lifetime_kwh,
      lifetime_mileage_km = excluded.lifetime_mileage_km,
      updated_at = excluded.updated_at
  where excluded.sample_count > 0;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

-- Daily job: recount yesterday (late batches from the car's offline buffer land after midnight),
-- then fill up to p_backfill_days older days that have hourly rows but no daily rows, oldest first.
create or replace function public.bydmate_distill_vehicle_days(p_backfill_days integer default 10)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_yesterday date := (now() at time zone 'UTC')::date - 1;
  v_day date;
  v_days integer := 0;
begin
  perform public.bydmate_distill_vehicle_day(v_yesterday);
  v_days := 1;

  for v_day in
    select d.day
    from (
      select distinct (h.hour_start at time zone 'UTC')::date as day
      from public.bydmate_telemetry_hourly h
      where h.hour_start < (v_yesterday::timestamp at time zone 'UTC')
    ) d
    where not exists (select 1 from public.bydmate_vehicle_daily_stats s where s.day = d.day)
    order by d.day
    limit greatest(p_backfill_days, 0)
  loop
    perform public.bydmate_distill_vehicle_day(v_day);
    v_days := v_days + 1;
  end loop;

  return v_days;
end;
$$;

-- Batch job: newest finished trips / sessions without a series first (raw is still there), then
-- sessions edited after their last distill (reconcile / recovery / corrections can move the
-- window). Free-tier series follow the free raw window (30 days), like the samples they came from.
create or replace function public.bydmate_distill_telemetry_series(p_batch integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_trips integer := 0;
  v_sessions integer := 0;
  v_free_deleted integer;
begin
  for v_id in
    select t.id
    from public.bydmate_trips t
    left join public.bydmate_trip_series s on s.trip_id = t.id
    where t.source = 'telemetry'
      and t.ended_at is not null
      and t.ended_at < now() - interval '6 hours'
      and s.trip_id is null
    order by t.ended_at desc
    limit greatest(p_batch, 0)
  loop
    perform public.bydmate_distill_trip_series(v_id);
    v_trips := v_trips + 1;
  end loop;

  for v_id in
    select c.id
    from public.charging_sessions c
    left join public.bydmate_charging_session_series s on s.session_id = c.id
    where c.status <> 'charging'
      and c.started_at is not null
      and coalesce(c.stopped_at, c.updated_at) < now() - interval '6 hours'
      and (
        s.session_id is null
        or (c.updated_at > s.distilled_at and c.updated_at > now() - interval '90 days')
      )
    order by coalesce(c.stopped_at, c.updated_at) desc
    limit greatest(p_batch, 0)
  loop
    perform public.bydmate_distill_charging_session_series(v_id);
    v_sessions := v_sessions + 1;
  end loop;

  -- is_user_premium per distinct user, never per row (a per-row call timed out on the samples table).
  with free_users as (
    select u.user_id
    from (
      select distinct user_id from public.bydmate_trip_series
      union
      select distinct user_id from public.bydmate_charging_session_series
    ) u
    where not public.is_user_premium(u.user_id)
  ),
  del_trips as (
    delete from public.bydmate_trip_series s
    using public.bydmate_trips t
    where t.id = s.trip_id
      and s.user_id in (select user_id from free_users)
      and t.started_at < now() - interval '30 days'
    returning 1
  ),
  del_sessions as (
    delete from public.bydmate_charging_session_series s
    where s.user_id in (select user_id from free_users)
      and s.window_from < now() - interval '30 days'
    returning 1
  )
  select (select count(*) from del_trips) + (select count(*) from del_sessions)
  into v_free_deleted;

  return jsonb_build_object(
    'trips', v_trips,
    'sessions', v_sessions,
    'free_deleted', coalesce(v_free_deleted, 0)
  );
end;
$$;

revoke execute on function public.bydmate_build_telemetry_series(uuid, text, timestamptz, timestamptz, integer)
  from public, anon, authenticated;
revoke execute on function public.bydmate_distill_trip_series(uuid) from public, anon, authenticated;
revoke execute on function public.bydmate_distill_charging_session_series(uuid) from public, anon, authenticated;
revoke execute on function public.bydmate_distill_vehicle_day(date) from public, anon, authenticated;
revoke execute on function public.bydmate_distill_vehicle_days(integer) from public, anon, authenticated;
revoke execute on function public.bydmate_distill_telemetry_series(integer) from public, anon, authenticated;
grant execute on function public.bydmate_build_telemetry_series(uuid, text, timestamptz, timestamptz, integer)
  to service_role;
grant execute on function public.bydmate_distill_trip_series(uuid) to service_role;
grant execute on function public.bydmate_distill_charging_session_series(uuid) to service_role;
grant execute on function public.bydmate_distill_vehicle_day(date) to service_role;
grant execute on function public.bydmate_distill_vehicle_days(integer) to service_role;
grant execute on function public.bydmate_distill_telemetry_series(integer) to service_role;
