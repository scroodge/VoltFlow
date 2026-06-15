-- Recompute distance_km for closed trips from telemetry trip-meter open/close delta.
-- Uses the same baseline logic as bydmate_trip_distance_from_meter (no mid-trip scan).

do $$
declare
  v_trip record;
  v_meter_open numeric;
  v_meter_close numeric;
  v_corrected_distance numeric;
  v_corrected_baseline numeric;
  v_updated integer := 0;
  v_baseline_only integer := 0;
begin
  for v_trip in
    select
      id,
      user_id,
      vehicle_id,
      started_at,
      ended_at,
      last_device_time,
      distance_km,
      trip_meter_baseline_km
    from public.bydmate_trips
    where ended_at is not null
    order by started_at
  loop
    select nullif(s.telemetry->>'current_trip_distance_km', '')::numeric
    into v_meter_open
    from public.bydmate_telemetry_samples s
    where s.user_id = v_trip.user_id
      and s.vehicle_id = v_trip.vehicle_id
      and s.device_time >= v_trip.started_at
    order by s.device_time asc
    limit 1;

    select nullif(s.telemetry->>'current_trip_distance_km', '')::numeric
    into v_meter_close
    from public.bydmate_telemetry_samples s
    where s.user_id = v_trip.user_id
      and s.vehicle_id = v_trip.vehicle_id
      and s.device_time <= coalesce(v_trip.ended_at, v_trip.last_device_time)
    order by s.device_time desc
    limit 1;

    if v_meter_open is null or v_meter_close is null then
      continue;
    end if;

    select d.distance_km, d.trip_meter_baseline_km
    into v_corrected_distance, v_corrected_baseline
    from public.bydmate_trip_distance_from_meter(
      v_meter_open,
      v_meter_close,
      null
    ) as d;

    if abs(coalesce(v_trip.distance_km, 0) - coalesce(v_corrected_distance, 0)) > 0.05 then
      update public.bydmate_trips
      set
        distance_km = v_corrected_distance,
        trip_meter_baseline_km = v_corrected_baseline
      where id = v_trip.id;

      v_updated := v_updated + 1;
    elsif v_trip.trip_meter_baseline_km is null then
      update public.bydmate_trips
      set trip_meter_baseline_km = v_corrected_baseline
      where id = v_trip.id;

      v_baseline_only := v_baseline_only + 1;
    end if;
  end loop;

  raise notice 'bydmate trip distance backfill: corrected %, baseline-only %',
    v_updated, v_baseline_only;
end;
$$;
