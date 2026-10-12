-- Odometer-scale trip distances, stage 2 (BACKLOG.md "Odometer-scale trip distances"):
-- server write-time guard for bydmate_apply_client_trip.
--
-- Problem (prod, 2026-08-01 .. 2026-10-07): some client_trip rows carry distance_km equal to the
-- car's ODOMETER (tens of thousands of km in minutes) instead of the per-trip delta. Live example
-- 2026-10-07: distance_km 27,608.0 == odometer 27,608 while current_trip_distance_km (the trip
-- meter) read 11.6 km. bydmate_apply_client_trip copied the block's distance unchecked
-- (`distance_km = coalesce(block, existing)`), so the phantom was published for the whole drive and
-- at close bydmate_discard_trip_if_junk Rule C deleted the (real) drive. The producer of the bad
-- value is not identified (scroodge/VoltFlow#43); this guard does not depend on it.
--
-- Behaviour after this migration (distance only; every other field is written exactly as before):
--   * plausible distance            -> stored as before (coalesce(block, existing)).
--   * implausible, trip still open  -> NOT stored: keep the previous value if that was plausible,
--                                      else NULL (unknown). The phantom is never published.
--   * implausible, closing block    -> recomputed from the trip's own samples (odometer delta,
--                                      bydmate_trip_distance_from_samples), else NULL. The real
--                                      drive is kept instead of deleted by Rule C; parking blips
--                                      are still dropped by Rules A/B.
--
-- "Plausible" mirrors src/lib/voltflowmate/trip-distance-plausibility.ts (keep both in sync):
-- > 1,500 km, or an implied speed > 250 km/h (checked only above 1 km and with a known positive
-- duration), is implausible. Missing / non-positive distance is not judged.
--
-- Idempotent (create or replace). New public functions follow the AGENTS.md privilege rule:
-- revoke from public, anon, authenticated, then grant only to service_role.
--
-- Rollback: re-apply the previous definition of bydmate_apply_client_trip from
-- 20260917120000_bydmate_client_trip_junk_filter.sql (the two new helpers can stay).

-- 1. Pure plausibility check (SQL twin of isPlausibleTripDistance).
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
    when p_distance > 1500 then false
    when p_distance <= 1 or p_started_at is null or p_ended_at is null then true
    when extract(epoch from (p_ended_at - p_started_at)) <= 0 then true
    else (p_distance * 3600.0 / extract(epoch from (p_ended_at - p_started_at))) <= 250
  end;
$function$;

comment on function public.bydmate_trip_distance_plausible(numeric, timestamptz, timestamptz) is
  'True unless distance_km is > 1500 km or implies > 250 km/h. SQL twin of trip-distance-plausibility.ts.';

-- 2. True trip distance from the trip's own samples: odometer max - min over the trip window.
--    Fails safe to NULL: needs >= 2 positive odometer samples that cover BOTH ends of the window
--    (within 2 minutes of the start and of the end, so late-delivered samples cannot produce a
--    wrong-small distance), a non-negative delta, and a plausible result. Never raises.
create or replace function public.bydmate_trip_distance_from_samples(
  p_user_id uuid,
  p_vehicle_id text,
  p_from timestamptz,
  p_to timestamptz
)
returns numeric
language plpgsql
stable
set search_path = public
as $function$
declare
  v_n integer;
  v_min numeric;
  v_max numeric;
  v_first timestamptz;
  v_last timestamptz;
  v_delta numeric;
begin
  if p_user_id is null or p_vehicle_id is null or p_from is null or p_to is null or p_to <= p_from then
    return null;
  end if;

  select count(*), min(s.odo), max(s.odo), min(s.device_time), max(s.device_time)
  into v_n, v_min, v_max, v_first, v_last
  from (
    select
      device_time,
      case
        when telemetry->>'odometer_km' ~ '^[0-9]+(\.[0-9]+)?$'
          then (telemetry->>'odometer_km')::numeric
      end as odo
    from public.bydmate_telemetry_samples
    where user_id = p_user_id
      and vehicle_id = p_vehicle_id
      and device_time >= p_from
      and device_time <= p_to
  ) s
  where s.odo is not null and s.odo > 0;

  if v_n is null or v_n < 2 then
    return null;
  end if;

  if v_first > p_from + interval '2 minutes' or v_last < p_to - interval '2 minutes' then
    return null;
  end if;

  v_delta := round(v_max - v_min, 3);
  if v_delta < 0 or not public.bydmate_trip_distance_plausible(v_delta, p_from, p_to) then
    return null;
  end if;

  return v_delta;
exception
  when others then
    return null;
end;
$function$;

comment on function public.bydmate_trip_distance_from_samples(uuid, text, timestamptz, timestamptz) is
  'Odometer delta over a trip''s own samples, or NULL when coverage/plausibility is not proven. Also the stage-3 repair primitive.';

-- 3. bydmate_apply_client_trip: same body as 20260917120000 except the distance_km value.
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
  v_cur record;
  v_candidate numeric;
  v_started_at timestamptz;
  v_end timestamptz;
  v_closing boolean;
  v_distance numeric;
begin
  select started_at, ended_at, last_device_time, distance_km
  into v_cur
  from public.bydmate_trips
  where id = p_trip_id
    and user_id = p_user_id
    and vehicle_id = p_vehicle_id;

  if found then
    v_candidate := coalesce(nullif(p_block->>'distance_km', '')::numeric, v_cur.distance_km);
    v_started_at := coalesce(nullif(p_block->>'started_at', '')::timestamptz, v_cur.started_at);
    v_end := coalesce(
      v_block_ended_at,
      v_cur.ended_at,
      nullif(p_block->>'last_device_time', '')::timestamptz,
      v_cur.last_device_time
    );
    v_closing := v_block_ended_at is not null or v_cur.ended_at is not null;

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
    ended_at = coalesce(ended_at, v_block_ended_at),
    last_device_time = coalesce(
      nullif(p_block->>'last_device_time', '')::timestamptz,
      last_device_time
    ),
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

-- Privileges (AGENTS.md: Supabase default privileges grant EXECUTE to anon/authenticated).
revoke execute on function public.bydmate_trip_distance_plausible(numeric, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.bydmate_trip_distance_plausible(numeric, timestamptz, timestamptz)
  to service_role;

revoke execute on function public.bydmate_trip_distance_from_samples(uuid, text, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.bydmate_trip_distance_from_samples(uuid, text, timestamptz, timestamptz)
  to service_role;

revoke execute on function public.bydmate_apply_client_trip(uuid, text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.bydmate_apply_client_trip(uuid, text, uuid, jsonb)
  to service_role;
