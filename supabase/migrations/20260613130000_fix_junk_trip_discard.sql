-- Fix bydmate_discard_trip_if_junk with two rules:
--
-- Rule A (original, fixed): discard if distance_km ≤ 0.1 AND max_speed_kmh ≤ 3,
--   regardless of sample count. (Removes the old sample_count < 3 hard gate.)
--
-- Rule B (new): discard if duration < 60 s AND max_speed_kmh < 10.
--   Catches phantom trips caused by inherited current_trip_distance_km:
--   when the car shifts D→P at 4–6 km/h right after a real trip, the new trip
--   row opens before the vehicle resets its internal trip counter, so it
--   inherits the previous trip's distance (e.g. 24.3 km). duration + max_speed
--   are the only reliable signals that the trip is a maneuver artifact.

create or replace function public.bydmate_discard_trip_if_junk(p_trip_id uuid)
returns boolean language plpgsql security definer set search_path = public
as $$
declare
  v_trip public.bydmate_trips%rowtype;
  v_duration_s numeric;
begin
  select * into v_trip from public.bydmate_trips where id = p_trip_id;
  if not found then return false; end if;

  -- Rule A: zero-distance low-speed trips (original logic, sample_count gate removed)
  if coalesce(v_trip.distance_km, 0) <= 0.1
     and coalesce(v_trip.max_speed_kmh, 0) <= 3 then
    delete from public.bydmate_trip_track_points where trip_id = p_trip_id;
    delete from public.bydmate_trips where id = p_trip_id;
    return true;
  end if;

  -- Rule B: very short trip with low max speed → charger/parking maneuver artifact
  v_duration_s := extract(epoch from (v_trip.ended_at - v_trip.started_at));
  if coalesce(v_duration_s, 999) < 60
     and coalesce(v_trip.max_speed_kmh, 0) < 10 then
    delete from public.bydmate_trip_track_points where trip_id = p_trip_id;
    delete from public.bydmate_trips where id = p_trip_id;
    return true;
  end if;

  return false;
end; $$;
