-- Odometer-scale trip distances: correction to stage 2 (20261007130000), BACKLOG.md
-- "Stage 3 plan ... PAUSED, PLAN CORRECTED".
--
-- bydmate_trip_distance_plausible also rejected a distance whose implied speed (distance / the
-- row's recorded duration) exceeded 250 km/h. That test is unsafe: some client_trip rows carry a
-- truncated duration (15-122 s) with a CORRECT distance, e.g. 8.6 km stored while net energy
-- (traction - regen) / stored consumption also gives 8.6 km. On 2,650 closed client trips
-- (2026-08-01 .. 09-17) the speed rule flagged 6 trips and every one was a false positive, while
-- the 7 genuine odometer-scale phantoms (all > 15,000 km) are all caught by the km cap alone.
-- With the speed rule, bydmate_apply_client_trip would replace such a correct distance by an
-- odometer delta over the truncated window (8.6 km -> 0.8 km) or NULL.
--
-- Fix: the hard rule is the per-trip cap only. Every one of the 18 vehicles has an odometer
-- >= 5,155 km (checked 2026-10-07), so an odometer-scale phantom is always above the cap; a car
-- below 1,500 km would need an additional test.
--
-- Same signature as before (callers unchanged); the timestamp arguments are accepted and ignored
-- so bydmate_apply_client_trip and bydmate_trip_distance_from_samples need no change.
-- Mirrors src/lib/voltflowmate/trip-distance-plausibility.ts (keep both in sync).
-- Idempotent (create or replace). Rollback: re-apply the function body from 20261007130000.
create or replace function public.bydmate_trip_distance_plausible(
  p_distance numeric,
  p_started_at timestamptz,
  p_ended_at timestamptz
)
returns boolean
language sql
immutable
parallel safe
set search_path = public
as $function$
  select case
    when p_distance is null or p_distance <= 0 then true
    else p_distance <= 1500
  end;
$function$;

comment on function public.bydmate_trip_distance_plausible(numeric, timestamptz, timestamptz) is
  'True unless distance_km is > 1500 km (cap only; timestamps are ignored because some client trips carry a truncated duration with a correct distance). SQL twin of trip-distance-plausibility.ts.';

revoke execute on function public.bydmate_trip_distance_plausible(numeric, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.bydmate_trip_distance_plausible(numeric, timestamptz, timestamptz)
  to service_role;
