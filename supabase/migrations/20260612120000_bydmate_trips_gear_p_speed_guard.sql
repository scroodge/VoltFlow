-- CommandDaemon (head-unit daemon) pushes a heartbeat every 60 s with diplus.gear=1 (P)
-- even while the car is moving (DiPars reduced-payload mode returns 1 instead of null).
-- This caused 1-minute trip fragments: gear-P heartbeat closes the trip, the next dense
-- TrackingService sample reopens it — repeat every minute throughout the drive.
--
-- Fix: ignore gear P when speed > 5 km/h.  A car cannot be in Park at highway speed;
-- the signal is a DiPars artifact, not the real state.

create or replace function public.bydmate_ingest_telemetry(
  p_user_id uuid,
  p_vehicle_id text,
  p_source text,
  p_schema_version integer,
  p_device_time timestamptz,
  p_received_at timestamptz,
  p_telemetry jsonb,
  p_location jsonb,
  p_raw_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip_gap interval := interval '5 minutes';
  v_trip public.bydmate_trips%rowtype;
  v_closed_trip_id uuid;
  v_lat double precision;
  v_lon double precision;
  v_soc numeric;
  v_speed numeric;
  v_power numeric;
  v_charge_power numeric;
  v_trip_distance numeric;
  v_consumption numeric;
  v_hour_start timestamptz;
  v_sample_id uuid;
  v_track_id uuid;
  v_battery_temp numeric;
  v_cabin_temp numeric;
  v_outside_temp numeric;
  v_diplus_charging_status text;
  v_diplus_charge_gun_state text;
  v_is_charging boolean;
  v_gear_raw text;
  v_is_gear_p boolean;
  v_is_drive_gear boolean;
  v_is_drive_sample boolean;
  v_live_telemetry jsonb := p_telemetry;
  v_incoming_soh numeric;
  v_prev_soh numeric;
begin
  v_incoming_soh := nullif(p_telemetry->>'soh_percent', '')::numeric;
  if v_incoming_soh is null or v_incoming_soh < 0 or v_incoming_soh > 100 then
    select nullif(telemetry->>'soh_percent', '')::numeric
    into v_prev_soh
    from public.bydmate_live_snapshots
    where user_id = p_user_id
      and vehicle_id = p_vehicle_id;

    if v_prev_soh is not null and v_prev_soh >= 0 and v_prev_soh <= 100 then
      v_live_telemetry := p_telemetry || jsonb_build_object('soh_percent', v_prev_soh);
    end if;
  end if;

  insert into public.bydmate_live_snapshots (
    vehicle_id,
    user_id,
    source,
    schema_version,
    device_time,
    received_at,
    telemetry,
    location,
    raw_payload
  )
  values (
    p_vehicle_id,
    p_user_id,
    p_source,
    p_schema_version,
    p_device_time,
    p_received_at,
    v_live_telemetry,
    p_location,
    p_raw_payload
  )
  on conflict (user_id, vehicle_id) do update
  set
    source = excluded.source,
    schema_version = excluded.schema_version,
    device_time = excluded.device_time,
    received_at = excluded.received_at,
    telemetry = excluded.telemetry,
    location = excluded.location,
    raw_payload = excluded.raw_payload;

  insert into public.bydmate_telemetry_samples (
    vehicle_id,
    user_id,
    device_time,
    received_at,
    telemetry
  )
  values (
    p_vehicle_id,
    p_user_id,
    p_device_time,
    p_received_at,
    p_telemetry
  )
  on conflict (user_id, vehicle_id, device_time) do nothing
  returning id into v_sample_id;

  if v_sample_id is null then
    return jsonb_build_object(
      'duplicate', true,
      'vehicle_id', p_vehicle_id,
      'last_device_time', p_device_time
    );
  end if;

  v_soc := nullif(p_telemetry->>'soc', '')::numeric;
  v_speed := nullif(p_telemetry->>'speed_kmh', '')::numeric;
  v_power := nullif(p_telemetry->>'power_kw', '')::numeric;
  v_charge_power := nullif(p_telemetry->>'charge_power_kw', '')::numeric;
  v_battery_temp := nullif(p_telemetry->>'battery_temp_c', '')::numeric;
  v_cabin_temp := nullif(p_telemetry->>'cabin_temp_c', '')::numeric;
  v_outside_temp := nullif(p_telemetry->>'outside_temp_c', '')::numeric;
  v_hour_start := date_trunc('hour', p_device_time at time zone 'utc');

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
    outside_temp_avg,
    power_sample_count,
    battery_temp_sample_count,
    cabin_temp_sample_count,
    outside_temp_sample_count
  )
  values (
    p_user_id,
    p_vehicle_id,
    v_hour_start,
    1,
    v_soc,
    v_soc,
    v_soc,
    v_speed,
    v_power,
    v_battery_temp,
    v_cabin_temp,
    v_outside_temp,
    case when v_power is null then 0 else 1 end,
    case when v_battery_temp is null then 0 else 1 end,
    case when v_cabin_temp is null then 0 else 1 end,
    case when v_outside_temp is null then 0 else 1 end
  )
  on conflict (user_id, vehicle_id, hour_start) do update
  set
    sample_count = public.bydmate_telemetry_hourly.sample_count + 1,
    soc_min = least(public.bydmate_telemetry_hourly.soc_min, excluded.soc_min),
    soc_max = greatest(public.bydmate_telemetry_hourly.soc_max, excluded.soc_max),
    soc_last = coalesce(excluded.soc_last, public.bydmate_telemetry_hourly.soc_last),
    speed_max = greatest(public.bydmate_telemetry_hourly.speed_max, excluded.speed_max),
    power_avg = case
      when excluded.power_sample_count = 0 then public.bydmate_telemetry_hourly.power_avg
      when public.bydmate_telemetry_hourly.power_sample_count = 0 then excluded.power_avg
      else (
        public.bydmate_telemetry_hourly.power_avg * public.bydmate_telemetry_hourly.power_sample_count
        + excluded.power_avg
      ) / (public.bydmate_telemetry_hourly.power_sample_count + excluded.power_sample_count)
    end,
    battery_temp_avg = case
      when excluded.battery_temp_sample_count = 0 then public.bydmate_telemetry_hourly.battery_temp_avg
      when public.bydmate_telemetry_hourly.battery_temp_sample_count = 0 then excluded.battery_temp_avg
      else (
        public.bydmate_telemetry_hourly.battery_temp_avg * public.bydmate_telemetry_hourly.battery_temp_sample_count
        + excluded.battery_temp_avg
      ) / (public.bydmate_telemetry_hourly.battery_temp_sample_count + excluded.battery_temp_sample_count)
    end,
    cabin_temp_avg = case
      when excluded.cabin_temp_sample_count = 0 then public.bydmate_telemetry_hourly.cabin_temp_avg
      when public.bydmate_telemetry_hourly.cabin_temp_sample_count = 0 then excluded.cabin_temp_avg
      else (
        public.bydmate_telemetry_hourly.cabin_temp_avg * public.bydmate_telemetry_hourly.cabin_temp_sample_count
        + excluded.cabin_temp_avg
      ) / (public.bydmate_telemetry_hourly.cabin_temp_sample_count + excluded.cabin_temp_sample_count)
    end,
    outside_temp_avg = case
      when excluded.outside_temp_sample_count = 0 then public.bydmate_telemetry_hourly.outside_temp_avg
      when public.bydmate_telemetry_hourly.outside_temp_sample_count = 0 then excluded.outside_temp_avg
      else (
        public.bydmate_telemetry_hourly.outside_temp_avg * public.bydmate_telemetry_hourly.outside_temp_sample_count
        + excluded.outside_temp_avg
      ) / (public.bydmate_telemetry_hourly.outside_temp_sample_count + excluded.outside_temp_sample_count)
    end,
    power_sample_count = public.bydmate_telemetry_hourly.power_sample_count + excluded.power_sample_count,
    battery_temp_sample_count = public.bydmate_telemetry_hourly.battery_temp_sample_count + excluded.battery_temp_sample_count,
    cabin_temp_sample_count = public.bydmate_telemetry_hourly.cabin_temp_sample_count + excluded.cabin_temp_sample_count,
    outside_temp_sample_count = public.bydmate_telemetry_hourly.outside_temp_sample_count + excluded.outside_temp_sample_count;

  perform public.bydmate_update_hourly_energy(p_user_id, p_vehicle_id, p_device_time, v_power);

  v_diplus_charging_status := lower(coalesce(p_raw_payload #>> '{diplus,charging_status}', ''));
  v_diplus_charge_gun_state := lower(coalesce(p_raw_payload #>> '{diplus,charge_gun_state}', ''));
  v_is_charging :=
    lower(coalesce(p_telemetry->>'is_charging', '')) in ('true', '1', 'yes', 'on') or
    coalesce(v_charge_power, 0) > 0.1 or
    v_diplus_charging_status in ('charging', 'charge', 'active');

  v_gear_raw := trim(coalesce(p_raw_payload #>> '{diplus,gear}', ''));
  v_is_gear_p :=
    (upper(v_gear_raw) = 'P' or
     v_gear_raw = '1' or
     (v_gear_raw ~ '^\d+$' and v_gear_raw::int = 1))
    -- Ignore gear-P signals when the car is clearly moving: DiPars may report
    -- gear=1 (reduced-payload fallback) even at highway speed.
    and coalesce(v_speed, 0) <= 5;

  v_is_drive_gear :=
    upper(v_gear_raw) in ('D', 'R', 'N') or
    v_gear_raw in ('2', '3', '4');

  v_is_drive_sample :=
    coalesce(v_speed, 0) > 5 or v_is_drive_gear;

  select *
  into v_trip
  from public.bydmate_trips
  where user_id = p_user_id
    and vehicle_id = p_vehicle_id
    and ended_at is null
  for update;

  if v_is_charging then
    if found then
      v_closed_trip_id := v_trip.id;
      update public.bydmate_trips
      set ended_at = v_trip.last_device_time
      where id = v_closed_trip_id;

      if public.bydmate_discard_trip_if_junk(v_closed_trip_id) then
        v_closed_trip_id := null;
      else
        perform public.bydmate_finalize_trip_energy(v_closed_trip_id);
      end if;
    end if;

    return jsonb_build_object(
      'charging', true,
      'trip_id', null,
      'closed_trip_id', v_closed_trip_id,
      'sample_count', 0,
      'track_point_count', 0
    );
  end if;

  if v_is_gear_p then
    if found then
      v_closed_trip_id := v_trip.id;
      update public.bydmate_trips
      set ended_at = v_trip.last_device_time
      where id = v_closed_trip_id;

      if public.bydmate_discard_trip_if_junk(v_closed_trip_id) then
        v_closed_trip_id := null;
      else
        perform public.bydmate_finalize_trip_energy(v_closed_trip_id);
      end if;
    end if;

    return jsonb_build_object(
      'parked', true,
      'trip_id', null,
      'closed_trip_id', v_closed_trip_id,
      'sample_count', 0,
      'track_point_count', 0
    );
  end if;

  if not found and not v_is_drive_sample then
    return jsonb_build_object(
      'trip_id', null,
      'sample_count', 0,
      'track_point_count', 0,
      'skipped_trip', true
    );
  end if;

  v_trip_distance := nullif(p_telemetry->>'current_trip_distance_km', '')::numeric;
  v_consumption := nullif(p_telemetry->>'current_trip_consumption_kwh_100km', '')::numeric;

  if found then
    if p_device_time - v_trip.last_device_time > v_trip_gap then
      v_closed_trip_id := v_trip.id;
      update public.bydmate_trips
      set ended_at = v_trip.last_device_time
      where id = v_closed_trip_id;

      if public.bydmate_discard_trip_if_junk(v_closed_trip_id) then
        v_closed_trip_id := null;
      else
        perform public.bydmate_finalize_trip_energy(v_closed_trip_id);
      end if;

      if v_is_drive_sample then
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
        values (
          p_user_id,
          p_vehicle_id,
          p_device_time,
          null,
          p_device_time,
          1,
          0,
          v_trip_distance,
          v_soc,
          v_soc,
          v_speed,
          v_speed,
          v_consumption
        )
        returning * into v_trip;
      else
        v_trip := null;
      end if;
    else
      update public.bydmate_trips
      set
        last_device_time = p_device_time,
        sample_count = sample_count + 1,
        soc_end = coalesce(v_soc, soc_end),
        max_speed_kmh = greatest(coalesce(max_speed_kmh, v_speed), coalesce(v_speed, max_speed_kmh)),
        avg_speed_kmh = case
          when v_speed is null then avg_speed_kmh
          when avg_speed_kmh is null then v_speed
          else (avg_speed_kmh * sample_count + v_speed) / (sample_count + 1)
        end,
        avg_consumption_kwh_100km = case
          when v_consumption is null then avg_consumption_kwh_100km
          when avg_consumption_kwh_100km is null then v_consumption
          else (avg_consumption_kwh_100km * sample_count + v_consumption) / (sample_count + 1)
        end,
        distance_km = coalesce(v_trip_distance, distance_km)
      where id = v_trip.id
      returning * into v_trip;
    end if;
  else
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
    values (
      p_user_id,
      p_vehicle_id,
      p_device_time,
      null,
      p_device_time,
      1,
      0,
      v_trip_distance,
      v_soc,
      v_soc,
      v_speed,
      v_speed,
      v_consumption
    )
    returning * into v_trip;
  end if;

  if v_trip.id is null then
    return jsonb_build_object(
      'trip_id', null,
      'closed_trip_id', v_closed_trip_id,
      'sample_count', 0,
      'track_point_count', 0,
      'skipped_trip', true
    );
  end if;

  v_lat := nullif(p_location->>'lat', '')::double precision;
  v_lon := nullif(p_location->>'lon', '')::double precision;

  if v_lat is not null and v_lon is not null then
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
    values (
      v_trip.id,
      p_user_id,
      p_device_time,
      v_lat,
      v_lon,
      nullif(p_location->>'accuracy_m', '')::numeric,
      nullif(p_location->>'bearing_deg', '')::numeric,
      v_speed,
      v_power,
      v_soc
    )
    on conflict (trip_id, device_time) do nothing
    returning id into v_track_id;

    if v_track_id is not null then
      update public.bydmate_trips
      set track_point_count = track_point_count + 1
      where id = v_trip.id
      returning * into v_trip;
    end if;
  end if;

  return jsonb_build_object(
    'trip_id', v_trip.id,
    'closed_trip_id', v_closed_trip_id,
    'sample_count', v_trip.sample_count,
    'track_point_count', v_trip.track_point_count
  );
end;
$$;

revoke all on function public.bydmate_ingest_telemetry(uuid, text, text, integer, timestamptz, timestamptz, jsonb, jsonb, jsonb)
  from public;
grant execute on function public.bydmate_ingest_telemetry(uuid, text, text, integer, timestamptz, timestamptz, jsonb, jsonb, jsonb)
  to service_role;
