-- Client trips: ended_at frozen at the first stop while the trip keeps going (BACKLOG.md
-- "Client trips: `ended_at` frozen at the first stop", #43 follow-up, option A).
--
-- Problem (prod, 2026-07 .. 2026-10-27): bydmate_apply_client_trip set
-- `ended_at = coalesce(ended_at, block.ended_at)`, so the first ended_at the Mate APK sent (a
-- short stop) was kept forever while the same trip id kept sending blocks with a growing
-- sample_count / distance_km / last_device_time. Client trips then appeared to have a short
-- duration despite correct distance.
--
-- Fix: a closed trip advances only when the incoming cumulative block has both a strictly higher
-- sample_count and a later last_device_time than the stored row and stored end. Equal-count
-- blocks are valid retries, but are not evidence that the trip continued and cannot move either
-- time. last_device_time itself is monotonic. No historical rows are changed here: raw telemetry
-- samples have no trip_id, so a vehicle/time-window repair cannot prove the movement belonged to
-- this particular trip.
--
-- Body otherwise identical to the live definition from 20261007130000 except for the guarded
-- end-time advancement. Idempotent (create or replace). Rollback: re-apply the function body from
-- 20261007130000.
--
-- Earlier investigation: 40 client trips (8 vehicles) "ended" 5-160 min
-- before their last sample, e.g. 46cbcea3: 168.4 km stored in a 14 min row, the drive went on to
-- 07:56. The distance was correct in all traced cases (equal to the odometer delta from started_at
-- to last_device_time); only the duration was truncated.
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
  v_block_last_device_time timestamptz := nullif(p_block->>'last_device_time', '')::timestamptz;
  v_accepted_at timestamptz := clock_timestamp();
  v_updated_trip record;
  v_cur record;
  v_candidate numeric;
  v_started_at timestamptz;
  v_ended_at timestamptz;
  v_end timestamptz;
  v_can_extend_closed_trip boolean;
  v_closing boolean;
  v_distance numeric;
begin
  select started_at, ended_at, last_device_time, sample_count, distance_km
  into v_cur
  from public.bydmate_trips
  where id = p_trip_id
    and user_id = p_user_id
    and vehicle_id = p_vehicle_id;

  if found then
    v_candidate := coalesce(nullif(p_block->>'distance_km', '')::numeric, v_cur.distance_km);

    -- An equal-count retry may be resent with a different aggregate, but it cannot prove that
    -- a closed trip continued. Only a strict cumulative advance with a later sample can do that.
    v_can_extend_closed_trip :=
      v_cur.ended_at is not null
      and v_sample_count > v_cur.sample_count
      and v_block_last_device_time > v_cur.last_device_time
      and v_block_last_device_time > v_cur.ended_at;

    -- greatest() ignores nulls. Open rows retain their existing close behaviour.
    if v_cur.ended_at is null then
      v_ended_at := v_block_ended_at;
    elsif v_can_extend_closed_trip then
      v_ended_at := greatest(v_cur.ended_at, v_block_ended_at, v_block_last_device_time);
    else
      v_ended_at := v_cur.ended_at;
    end if;

    v_started_at := coalesce(nullif(p_block->>'started_at', '')::timestamptz, v_cur.started_at);
    v_end := coalesce(
      v_ended_at,
      v_block_last_device_time,
      v_cur.last_device_time
    );
    v_closing := v_ended_at is not null;

    if public.bydmate_trip_distance_plausible(v_candidate, v_started_at, v_end) then
      v_distance := v_candidate;
    elsif v_closing then
      -- Odometer-scale value on a finished trip: recompute from the trip's own samples, or
      -- leave the distance unknown. Never store the phantom.
      v_distance := public.bydmate_trip_distance_from_samples(
        p_user_id, p_vehicle_id, v_started_at, v_end
      );
    elsif public.bydmate_trip_distance_plausible(v_cur.distance_km, v_started_at, v_end) then
      v_distance := v_cur.distance_km;
    else
      v_distance := null;
    end if;
  end if;

  update public.bydmate_trips
  set
    started_at = coalesce(nullif(p_block->>'started_at', '')::timestamptz, started_at),
    ended_at = coalesce(v_ended_at, ended_at),
    last_device_time = case
      when v_sample_count > sample_count
        then greatest(last_device_time, v_block_last_device_time)
      else last_device_time
    end,
    sample_count = v_sample_count,
    distance_km = v_distance,
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
    -- A/B/C). With the distance guard above, a real drive whose client distance was
    -- odometer-scale now arrives here with a repaired (or NULL) distance, so Rule C no longer
    -- deletes it; parking blips are still dropped by Rules A/B.
    perform public.bydmate_discard_trip_if_junk(p_trip_id);
  end if;
end;
$function$;

revoke execute on function public.bydmate_apply_client_trip(uuid, text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.bydmate_apply_client_trip(uuid, text, uuid, jsonb)
  to service_role;
