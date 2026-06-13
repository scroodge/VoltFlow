-- Fix bydmate_discard_trip_if_junk: remove the sample_count < 3 hard gate that
-- allowed 0km/low-speed trips with many samples (e.g. D→R→P charger maneuvers
-- with 11 samples, 0.0 km, max 2 km/h) to slip through uncaught.
-- New rule: discard iff distance_km ≤ 0.1 AND max_speed_kmh ≤ 3, regardless of
-- sample count.

create or replace function public.bydmate_discard_trip_if_junk(p_trip_id uuid)
returns boolean language plpgsql security definer set search_path = public
as $$
declare
  v_trip public.bydmate_trips%rowtype;
begin
  select * into v_trip from public.bydmate_trips where id = p_trip_id;
  if not found then return false; end if;

  if coalesce(v_trip.distance_km, 0) > 0.1 then return false; end if;
  if coalesce(v_trip.max_speed_kmh, 0) > 3 then return false; end if;

  delete from public.bydmate_trip_track_points where trip_id = p_trip_id;
  delete from public.bydmate_trips where id = p_trip_id;
  return true;
end; $$;
