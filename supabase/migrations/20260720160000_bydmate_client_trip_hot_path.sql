-- Phase 4 follow-up: take the stray-trip check and the stub insert off the hot path.
--
-- As shipped in 20260720140000, every client_trip sample ran BOTH an extra SELECT over the
-- vehicle's open trips (the stray-close loop) AND an `insert ... on conflict (id) do nothing`
-- PK probe -- on top of the `select ... for update` that already happened above. That made the
-- per-sample saving much smaller than intended: one trip UPDATE was effectively traded for one
-- SELECT plus one no-op INSERT. The large win (skipping bydmate_finalize_trip_energy's
-- full-window scan of the 954 MB samples table) is per trip and was never affected.
--
-- Both are provably unnecessary in the steady state. bydmate_trips_open_unique permits at most
-- one open trip per (user_id, vehicle_id), so when the FOR UPDATE select above already found
-- the client's own trip, there cannot be a stray, and the row obviously already exists. Guarding
-- on that collapses the steady-state path to: FOR UPDATE select + track point insert + count
-- update.
--
-- The guard tests `v_trip.id` rather than plpgsql's FOUND. FOUND is mutated by every subsequent
-- INSERT/UPDATE/SELECT INTO, and there are ~50 lines between the FOR UPDATE select and this
-- branch; v_trip.id is stable and says exactly what we mean.
--
-- Only the first sample of a trip (and a sample arriving after the trip was closed) takes the
-- full path now. Idempotent: safe to re-run.
-- Redefinition of the 9-arg bydmate_ingest_telemetry from 20260717120100. Diff against that
-- file before touching this again: the only intended changes are (a) the v_client_trip,
-- v_client_trip_id and v_stray_trip declares, (b) the client-owned-trip branch after the
-- gear-P early return, and (c) the three `not v_trip.client_trip` guards around
-- bydmate_finalize_trip_energy.
-- Everything else -- live snapshot, samples insert, hourly guard, gear/charging detection,
-- server-side trip open/extend/close, track points -- is copied mechanically.
--
-- Note this is the 9-arg overload. The 10-arg one (p_diplus, 20260716100000) is the actual
-- entrypoint for both route.ts and bydmate_ingest_telemetry_batch; it handles the live_only
-- fast path and otherwise delegates here with `raw_payload || {diplus}`, so client_trip and
-- trip_id arrive intact.
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
  v_sample_id uuid;
  v_track_id uuid;
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
  v_trip_meter_baseline numeric;
  v_client_hourly boolean := coalesce(nullif(p_raw_payload->>'client_hourly', '')::boolean, false);
  v_client_trip boolean := coalesce(nullif(p_raw_payload->>'client_trip', '')::boolean, false);
  v_client_trip_id uuid := nullif(p_raw_payload->>'trip_id', '')::uuid;
  v_stray_trip public.bydmate_trips%rowtype;
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

  if not v_client_hourly then
    perform public.bydmate_apply_hourly_rollup_sample(p_user_id, p_vehicle_id, p_device_time, p_telemetry);
  end if;

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
      elsif not coalesce(v_trip.client_trip, false) then
        -- A client-owned trip ships its own regen/traction in the cumulative block, so
        -- re-deriving them here would both scan the samples table across the whole trip
        -- window and overwrite the client's figures with a second estimate that the next
        -- block would flip straight back. Junk discard still runs either way.
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
      elsif not coalesce(v_trip.client_trip, false) then
        -- A client-owned trip ships its own regen/traction in the cumulative block, so
        -- re-deriving them here would both scan the samples table across the whole trip
        -- window and overwrite the client's figures with a second estimate that the next
        -- block would flip straight back. Junk discard still runs either way.
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

  -- Client-owned trip (Phase 4). The APK already maintains this trip's whole aggregate and
  -- ships it as a cumulative block, so skip the server's create/extend entirely: no weighted
  -- means, no bydmate_trip_distance_from_meter baseline arithmetic. Two things still happen
  -- per sample: the row is stubbed so the track point's FK resolves even when the block has
  -- not landed yet (block application is best-effort and must never fail the request), and
  -- the track point itself is written -- track-point ownership stays server-side for now.
  --
  -- Placed AFTER the charging and gear-P early returns so the server's close triggers stay
  -- authoritative, and BEFORE the 5-minute gap close, which deliberately does not apply to a
  -- client-owned trip: the client owns that lifecycle (gear-P/charging markers plus its own
  -- 20-minute next-boot finalizer), and a server-side gap close would strand a still-open
  -- client trip as closed while its blocks kept arriving. The gap close remains the fallback
  -- for every server-owned trip, including via the daemon's untagged samples after car-off.
  if v_client_trip and v_client_trip_id is not null then
    -- Hot-path guard. The FOR UPDATE select above already locked this vehicle's open trip; if
    -- that is this very trip then bydmate_trips_open_unique (one open trip per user+vehicle)
    -- proves there is no stray, and the row plainly exists -- so both the stray scan and the
    -- stub insert are provably redundant. That is every sample of a drive except the first.
    -- `is distinct from` rather than `<>` so a null v_trip.id (no open trip at all) still takes
    -- the full path.
    if v_trip.id is distinct from v_client_trip_id then
      -- Any other trip still open for this vehicle would violate bydmate_trips_open_unique.
      -- That is a partial index, so `on conflict (id) do nothing` below would NOT absorb it --
      -- the insert would raise and fail the whole ingest. Close strays the same way the normal
      -- path closes a trip.
      for v_stray_trip in
        select *
        from public.bydmate_trips
        where user_id = p_user_id
          and vehicle_id = p_vehicle_id
          and ended_at is null
          and id <> v_client_trip_id
      loop
        update public.bydmate_trips
        set ended_at = v_stray_trip.last_device_time
        where id = v_stray_trip.id;

        if not public.bydmate_discard_trip_if_junk(v_stray_trip.id)
          and not coalesce(v_stray_trip.client_trip, false) then
          perform public.bydmate_finalize_trip_energy(v_stray_trip.id);
        end if;
      end loop;

      -- Aggregate columns are left at their defaults: bydmate_apply_client_trip owns them.
      -- track_point_count is server-owned and incremented below, so the RPC never writes it.
      insert into public.bydmate_trips (
        id,
        user_id,
        vehicle_id,
        started_at,
        ended_at,
        last_device_time,
        sample_count,
        track_point_count,
        distance_km,
        trip_meter_baseline_km,
        client_trip
      )
      values (
        v_client_trip_id,
        p_user_id,
        p_vehicle_id,
        p_device_time,
        null,
        p_device_time,
        0,
        0,
        0,
        0,
        true
      )
      on conflict (id) do nothing;
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
        v_client_trip_id,
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
        where id = v_client_trip_id;
      end if;
    end if;

    -- No 'sample_count' key on purpose: parseIngestStats() then falls back to the payload
    -- count and reports the sample inserted, the same shape Phase 2's live_only path relies
    -- on. Returning the trip's own sample_count here would feed a trip-scoped number into
    -- HTTP ack accounting on the single-sample path.
    return jsonb_build_object(
      'trip_id', v_client_trip_id,
      'closed_trip_id', v_closed_trip_id,
      'client_trip', true
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
  v_trip_meter_baseline := coalesce(v_trip_distance, 0);

  if found then
    if p_device_time - v_trip.last_device_time > v_trip_gap then
      v_closed_trip_id := v_trip.id;
      update public.bydmate_trips
      set ended_at = v_trip.last_device_time
      where id = v_closed_trip_id;

      if public.bydmate_discard_trip_if_junk(v_closed_trip_id) then
        v_closed_trip_id := null;
      elsif not coalesce(v_trip.client_trip, false) then
        -- A client-owned trip ships its own regen/traction in the cumulative block, so
        -- re-deriving them here would both scan the samples table across the whole trip
        -- window and overwrite the client's figures with a second estimate that the next
        -- block would flip straight back. Junk discard still runs either way.
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
          trip_meter_baseline_km,
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
          0,
          v_trip_meter_baseline,
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
      select d.distance_km, d.trip_meter_baseline_km
      into v_trip_distance, v_trip_meter_baseline
      from public.bydmate_trip_distance_from_meter(
        v_trip.trip_meter_baseline_km,
        nullif(p_telemetry->>'current_trip_distance_km', '')::numeric,
        v_trip.distance_km
      ) as d;

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
        distance_km = v_trip_distance,
        trip_meter_baseline_km = v_trip_meter_baseline
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
      trip_meter_baseline_km,
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
      0,
      v_trip_meter_baseline,
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
