-- Rule C of bydmate_discard_trip_if_junk must not apply to client_trip rows (BACKLOG.md "Rule C on
-- the client path").
--
-- Rule C deletes a trip whose implied speed (distance / recorded duration) exceeds
-- max(max_speed * 1.5, 80 km/h): designed (June 2026) for LEGACY telemetry trips whose distance came
-- from the car's trip meter and could be inherited from a previous drive. Client trips take their
-- distance from odometer baselines, and some carry a TRUNCATED recorded duration (15-122 s) with a
-- CORRECT distance (net energy / stored consumption agrees within ~10 %; e.g. 8.6 km stored, 8.6 km
-- from energy). Rule C read those as impossible and DELETED real trips at close since
-- 20260917120000 wired it into bydmate_apply_client_trip (~0.23 % of client trips; the 2026-10-07
-- rehearsal reproduced it: an 8.6 km / 122 s trip and a 14.3 km / 84 s trip were deleted).
-- Odometer-scale phantoms on the client path are now stopped before storage by the 1,500 km cap in
-- bydmate_apply_client_trip (20261007130000 / 20261007150000), so Rule C is not needed there.
--
-- Change: Rule C is skipped when client_trip is true. Rules A and B (parking jitter, short low-speed
-- maneuvers) and the legacy telemetry path are unchanged.
--
-- Same signature, SECURITY DEFINER, search_path and grants as the deployed function; idempotent
-- (create or replace). Rollback: re-apply the previous body (Rule C without the client_trip condition),
-- which is the function body documented in docs/TRIPS.md "Junk filter".
create or replace function public.bydmate_discard_trip_if_junk(p_trip_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  -- Rule C: physically impossible implied speed → inherited trip-meter distance.
  -- Legacy (non-client) trips only: a client trip's recorded duration can be truncated while its
  -- distance is correct, and its odometer phantoms are rejected by the 1,500 km cap at write time.
  if not coalesce(v_trip.client_trip, false)
     and coalesce(v_duration_s, 0) > 0
     and coalesce(v_trip.distance_km, 0) > 0.3 then
    v_implied_kmh := v_trip.distance_km * 3600.0 / v_duration_s;
    if v_implied_kmh > greatest(coalesce(v_trip.max_speed_kmh, 0) * 1.5, 80) then
      delete from public.bydmate_trip_track_points where trip_id = p_trip_id;
      delete from public.bydmate_trips where id = p_trip_id;
      return true;
    end if;
  end if;

  return false;
end; $function$;

-- Privileges: unchanged from the deployed function (postgres + service_role only); re-asserted.
revoke execute on function public.bydmate_discard_trip_if_junk(uuid) from public, anon, authenticated;
grant execute on function public.bydmate_discard_trip_if_junk(uuid) to service_role;
