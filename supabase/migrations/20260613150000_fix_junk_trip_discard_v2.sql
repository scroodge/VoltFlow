-- bydmate_discard_trip_if_junk v2.
--
-- NOTE: migration 20260613130000 was edited after it was already applied, so its
-- Rule B never reached the database. This migration re-deploys the full logic.
--
-- Root cause of phantom trips (vehicle "way", 2026-06-13): bydmate_ingest_telemetry
-- sets distance_km = current_trip_distance_km (the car's own cumulative trip meter),
-- copied as-is — not a per-trip delta. When the car shifts D→P (real trip closes)
-- and then through R/D at 1–3 km/h during a parking maneuver, ingest opens a NEW
-- trip whose distance inherits the just-finished meter value (e.g. 2.4 km) before
-- the car resets it. A few seconds later gear=P closes it: a 10 s / 2.4 km / 3 km/h
-- artifact.
--
-- Rules:
--   A. distance_km ≤ 0.1 AND max_speed_kmh ≤ 3       (pure parking jitter)
--   B. duration < 60 s  AND max_speed_kmh < 10       (slow short maneuver)
--   C. implied speed (distance / duration) > max_speed_kmh * 1.5 AND > 80 km/h.
--      A genuine trip's average speed can never exceed its max instantaneous speed,
--      so an implied speed far above max means the distance is an inherited
--      trip-meter artifact. Catches the 1012 km/h / 864 km/h phantoms that B misses.

create or replace function public.bydmate_discard_trip_if_junk(p_trip_id uuid)
returns boolean language plpgsql security definer set search_path = public
as $$
declare
  v_trip public.bydmate_trips%rowtype;
  v_duration_s numeric;
  v_implied_kmh numeric;
begin
  select * into v_trip from public.bydmate_trips where id = p_trip_id;
  if not found then return false; end if;

  -- Rule A: zero-distance low-speed trips
  if coalesce(v_trip.distance_km, 0) <= 0.1
     and coalesce(v_trip.max_speed_kmh, 0) <= 3 then
    delete from public.bydmate_trip_track_points where trip_id = p_trip_id;
    delete from public.bydmate_trips where id = p_trip_id;
    return true;
  end if;

  v_duration_s := extract(epoch from (v_trip.ended_at - v_trip.started_at));

  -- Rule B: very short trip with low max speed → maneuver artifact
  if coalesce(v_duration_s, 999) < 60
     and coalesce(v_trip.max_speed_kmh, 0) < 10 then
    delete from public.bydmate_trip_track_points where trip_id = p_trip_id;
    delete from public.bydmate_trips where id = p_trip_id;
    return true;
  end if;

  -- Rule C: physically impossible implied speed → inherited trip-meter distance
  if coalesce(v_duration_s, 0) > 0 and coalesce(v_trip.distance_km, 0) > 0.3 then
    v_implied_kmh := v_trip.distance_km * 3600.0 / v_duration_s;
    if v_implied_kmh > greatest(coalesce(v_trip.max_speed_kmh, 0) * 1.5, 80) then
      delete from public.bydmate_trip_track_points where trip_id = p_trip_id;
      delete from public.bydmate_trips where id = p_trip_id;
      return true;
    end if;
  end if;

  return false;
end; $$;
