-- Client-owned trip finalization (bydmate_apply_client_trip) writes distance_km straight
-- from the Mate Android app's self-reported cumulative trip block, with no delta-from-baseline
-- recomputation and no junk-trip filtering. The legacy/daemon telemetry Open->Extend->Close
-- path already runs every closed trip through bydmate_discard_trip_if_junk (docs/TRIPS.md
-- "Lifecycle" -> "Close"), but that call was never wired into the client-trip finalization path.
--
-- Confirmed in prod on 2026-09-17: two client_trip rows on one account carried odometer-scale
-- phantom distance_km (37624.6 km / 341s -> implied 396,986 km/h; 33141.1 km / 1652s -> implied
-- 72,218 km/h), both far past docs/TRIPS.md Rule C's physically-impossible-speed threshold, and
-- both silently inflated every day/period "Пробег" total that summed trip.distance_km.
--
-- Fix: run the existing bydmate_discard_trip_if_junk(p_trip_id) at the end of
-- bydmate_apply_client_trip whenever the block actually closes the trip (same condition already
-- used for the finalization-audit insert), reusing the same Rules A/B/C as the legacy path
-- instead of trusting the client's self-reported distance unconditionally.
create or replace function public.bydmate_apply_client_trip(
  p_user_id uuid,
  p_vehicle_id text,
  p_trip_id uuid,
  p_block jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_sample_count integer := coalesce(nullif(p_block->>'sample_count', '')::integer, 0);
  v_block_ended_at timestamptz := nullif(p_block->>'ended_at', '')::timestamptz;
  v_accepted_at timestamptz := clock_timestamp();
  v_updated_trip record;
begin
  update public.bydmate_trips
  set
    started_at = coalesce(nullif(p_block->>'started_at', '')::timestamptz, started_at),
    ended_at = coalesce(ended_at, v_block_ended_at),
    last_device_time = coalesce(
      nullif(p_block->>'last_device_time', '')::timestamptz,
      last_device_time
    ),
    sample_count = v_sample_count,
    distance_km = coalesce(nullif(p_block->>'distance_km', '')::numeric, distance_km),
    soc_start = coalesce(nullif(p_block->>'soc_start', '')::numeric, soc_start),
    soc_end = coalesce(nullif(p_block->>'soc_end', '')::numeric, soc_end),
    max_speed_kmh = coalesce(nullif(p_block->>'max_speed_kmh', '')::numeric, max_speed_kmh),
    avg_speed_kmh = coalesce(nullif(p_block->>'avg_speed_kmh', '')::numeric, avg_speed_kmh),
    avg_consumption_kwh_100km = coalesce(
      nullif(p_block->>'avg_consumption_kwh_100km', '')::numeric,
      avg_consumption_kwh_100km
    ),
    regen_energy_kwh = coalesce(
      nullif(p_block->>'regen_energy_kwh', '')::numeric,
      regen_energy_kwh
    ),
    traction_energy_kwh = coalesce(
      nullif(p_block->>'traction_energy_kwh', '')::numeric,
      traction_energy_kwh
    ),
    client_trip = true
  where id = p_trip_id
    -- A client-minted UUID must never reach another user's row.
    and user_id = p_user_id
    and vehicle_id = p_vehicle_id
    -- `<=` makes a same-count retry idempotent while stale/out-of-order blocks are no-ops.
    and sample_count <= v_sample_count
  returning user_id, vehicle_id into v_updated_trip;

  if found and v_block_ended_at is not null then
    insert into public.bydmate_trip_finalization_audits (
      trip_id,
      user_id,
      vehicle_id,
      ended_at,
      accepted_at,
      delivery_delay_seconds
    )
    values (
      p_trip_id,
      v_updated_trip.user_id,
      v_updated_trip.vehicle_id,
      v_block_ended_at,
      v_accepted_at,
      floor(extract(epoch from (v_accepted_at - v_block_ended_at)))::integer
    )
    on conflict (trip_id) do nothing;

    -- Same junk check the legacy telemetry Close step already runs (docs/TRIPS.md Rules
    -- A/B/C) -- a client-reported distance can be just as corrupted as an inherited car
    -- trip-meter reading, and this path previously had no sanity check at all.
    perform public.bydmate_discard_trip_if_junk(p_trip_id);
  end if;
end;
$function$;
