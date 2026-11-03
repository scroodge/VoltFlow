-- Write each telemetry sample once instead of three times.
--
-- `bydmate_ingest_telemetry` (10-arg) called the 9-arg function, which INSERTed the
-- sample with only telemetry, then UPDATEd the same row with the di+ columns
-- (`bydmate_apply_diplus_columns`) and again with the autoservice columns. Every
-- UPDATE leaves a dead row version, and non-HOT ones add entries to every index:
-- prod counters (2026-06-24 → 2026-11-03) were 7.3 M inserts vs 13.0 M updates on
-- `bydmate_telemetry_samples`. See BACKLOG.md → "Prod DB retention & cleanup", item 3.
--
-- Change:
--   * The column mapping moves into two typed functions,
--     `bydmate_diplus_sample_columns` and `bydmate_autoservice_sample_columns`
--     (same expressions as before, one source of truth).
--   * The 9-arg sample INSERT selects those columns, so the row is complete on insert.
--   * The 10-arg wrapper no longer UPDATEs the sample; it still applies di+ and
--     autoservice to `bydmate_live_snapshots` (same guards), now via the same functions.
--   * `bydmate_apply_diplus_columns` keeps its signature and behavior, but takes its
--     values from `bydmate_diplus_sample_columns`.
-- Duplicate samples (`on conflict do nothing`) are left untouched; before, the follow-up
-- UPDATEs matched a duplicate only when its received_at was identical.
--
-- BASE BODIES (identical to prod pg_proc on 2026-11-03):
--   9-arg  ingest  → 20261012120000_bydmate_untagged_samples_skip_legacy_trip_open.sql
--                    (only the sample INSERT block differs)
--   10-arg ingest  → 20260716100000_bydmate_live_only_fast_path.sql
--   apply_diplus   → 20261102120000_diplus_charging_params.sql
-- Rollback: re-apply those three function bodies. Idempotent (CREATE OR REPLACE).

create or replace function public.bydmate_diplus_sample_columns(p_diplus jsonb, p_telemetry jsonb)
returns table (
  diplus_soc numeric,
  diplus_speed_kmh numeric,
  diplus_mileage_km numeric,
  diplus_power_kw numeric,
  diplus_charge_gun_state text,
  diplus_charging_status text,
  diplus_battery_capacity_kwh numeric,
  diplus_total_elec_consumption_kwh numeric,
  diplus_voltage_12v numeric,
  diplus_max_cell_voltage_v numeric,
  diplus_min_cell_voltage_v numeric,
  diplus_cell_delta_v numeric,
  diplus_avg_battery_temp_c numeric,
  diplus_exterior_temp_c numeric,
  diplus_gear text,
  diplus_power_state text,
  diplus_inside_temp_c numeric,
  diplus_ac_status text,
  diplus_ac_temp_c numeric,
  diplus_fan_level numeric,
  diplus_door_fl text,
  diplus_door_fr text,
  diplus_door_rl text,
  diplus_door_rr text,
  diplus_window_fl_percent numeric,
  diplus_window_fr_percent numeric,
  diplus_window_rl_percent numeric,
  diplus_window_rr_percent numeric,
  diplus_sunroof_percent numeric,
  diplus_trunk text,
  diplus_hood text,
  diplus_tire_press_fl_kpa numeric,
  diplus_tire_press_fr_kpa numeric,
  diplus_tire_press_rl_kpa numeric,
  diplus_tire_press_rr_kpa numeric,
  diplus_drive_mode text,
  diplus_work_mode text,
  diplus_auto_park text,
  diplus_rain text,
  diplus_light_low text,
  diplus_drl text,
  diplus_bms_state integer,
  diplus_charge_power_raw_kw numeric,
  diplus_max_charge_power_kw numeric
)
language sql
stable
set search_path = public
as $$
  with src as (
    select
      coalesce(p_diplus, '{}'::jsonb) as d,
      coalesce(p_telemetry, '{}'::jsonb) as t
  ),
  socs as (
    select
      src.d,
      src.t,
      public.bydmate_jsonb_numeric(src.d, 'soc') as diplus_soc,
      public.bydmate_jsonb_numeric(src.t, 'soc') as telemetry_soc
    from src
  ),
  v as (
    select
      socs.d,
      socs.t,
      -- Same reading at finer resolution, or nothing: 0.5 is exactly the app's rounding
      -- step (DiParsClient.parseIntNum uses round()), so a larger gap means the two
      -- fields came from different sources and the di+ one stays authoritative.
      case
        when chosen.soc between 0 and 100 then chosen.soc
        else null
      end as soc,
      coalesce(
        public.bydmate_jsonb_numeric(socs.t, 'diplus_min_cell_voltage_v'),
        public.bydmate_jsonb_numeric(socs.t, 'cell_voltage_min_v'),
        public.bydmate_jsonb_numeric(socs.d, 'min_cell_voltage_v')
      ) as min_cell,
      coalesce(
        public.bydmate_jsonb_numeric(socs.t, 'diplus_max_cell_voltage_v'),
        public.bydmate_jsonb_numeric(socs.t, 'cell_voltage_max_v'),
        public.bydmate_jsonb_numeric(socs.d, 'max_cell_voltage_v')
      ) as max_cell
    from socs
    cross join lateral (
      select case
        when socs.diplus_soc is not null
          and socs.telemetry_soc is not null
          and abs(socs.telemetry_soc - socs.diplus_soc) <= 0.5
          then socs.telemetry_soc
        else socs.diplus_soc
      end as soc
    ) chosen
  )
  select
    v.soc,
    public.bydmate_jsonb_numeric(v.d, 'speed_kmh'),
    public.bydmate_jsonb_numeric(v.d, 'mileage_km'),
    public.bydmate_jsonb_numeric(v.d, 'power_kw'),
    public.bydmate_jsonb_text(v.d, 'charge_gun_state'),
    public.bydmate_jsonb_text(v.d, 'charging_status'),
    public.bydmate_jsonb_numeric(v.d, 'battery_capacity_kwh'),
    public.bydmate_jsonb_numeric(v.d, 'total_elec_consumption_kwh'),
    public.bydmate_jsonb_numeric(v.d, 'voltage_12v'),
    v.max_cell,
    v.min_cell,
    coalesce(
      public.bydmate_jsonb_numeric(v.t, 'diplus_cell_delta_v'),
      public.bydmate_jsonb_numeric(v.t, 'cell_delta_v'),
      public.bydmate_jsonb_numeric(v.d, 'cell_delta_v'),
      v.max_cell - v.min_cell
    ),
    public.bydmate_jsonb_numeric(v.d, 'avg_battery_temp_c'),
    public.bydmate_jsonb_numeric(v.d, 'exterior_temp_c'),
    public.bydmate_jsonb_text(v.d, 'gear'),
    public.bydmate_jsonb_text(v.d, 'power_state'),
    public.bydmate_jsonb_numeric(v.d, 'inside_temp_c'),
    public.bydmate_jsonb_text(v.d, 'ac_status'),
    public.bydmate_jsonb_numeric(v.d, 'ac_temp_c'),
    public.bydmate_jsonb_numeric(v.d, 'fan_level'),
    public.bydmate_jsonb_text(v.d, 'door_fl'),
    public.bydmate_jsonb_text(v.d, 'door_fr'),
    public.bydmate_jsonb_text(v.d, 'door_rl'),
    public.bydmate_jsonb_text(v.d, 'door_rr'),
    public.bydmate_jsonb_numeric(v.d, 'window_fl_percent'),
    public.bydmate_jsonb_numeric(v.d, 'window_fr_percent'),
    public.bydmate_jsonb_numeric(v.d, 'window_rl_percent'),
    public.bydmate_jsonb_numeric(v.d, 'window_rr_percent'),
    public.bydmate_jsonb_numeric(v.d, 'sunroof_percent'),
    public.bydmate_jsonb_text(v.d, 'trunk'),
    public.bydmate_jsonb_text(v.d, 'hood'),
    public.bydmate_jsonb_numeric(v.d, 'tire_press_fl_kpa'),
    public.bydmate_jsonb_numeric(v.d, 'tire_press_fr_kpa'),
    public.bydmate_jsonb_numeric(v.d, 'tire_press_rl_kpa'),
    public.bydmate_jsonb_numeric(v.d, 'tire_press_rr_kpa'),
    public.bydmate_jsonb_text(v.d, 'drive_mode'),
    public.bydmate_jsonb_text(v.d, 'work_mode'),
    public.bydmate_jsonb_text(v.d, 'auto_park'),
    public.bydmate_jsonb_text(v.d, 'rain'),
    public.bydmate_jsonb_text(v.d, 'light_low'),
    public.bydmate_jsonb_text(v.d, 'drl'),
    public.bydmate_jsonb_numeric(v.d, 'bms_state')::integer,
    public.bydmate_jsonb_numeric(v.d, 'charge_power_raw_kw'),
    public.bydmate_jsonb_numeric(v.d, 'max_charge_power_kw')
  from v;
$$;

revoke all on function public.bydmate_diplus_sample_columns(jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.bydmate_diplus_sample_columns(jsonb, jsonb)
  to service_role;

create or replace function public.bydmate_autoservice_sample_columns(p_autoservice jsonb)
returns table (
  autoservice_soc_percent numeric,
  autoservice_power_kw numeric,
  autoservice_gun_state integer,
  autoservice_bms_state integer,
  autoservice_charge_capacity_kwh numeric,
  autoservice_charge_battery_volt numeric,
  autoservice_battery_type integer,
  autoservice_lifetime_mileage_km numeric,
  autoservice_lifetime_kwh numeric
)
language sql
immutable
set search_path = public
as $$
  -- `->>` on a missing / non-object value yields null, so a sample without an
  -- autoservice object gets all-null columns, exactly as when no UPDATE ran.
  select
    nullif(p_autoservice->>'soc_percent', '')::numeric,
    nullif(p_autoservice->>'power_kw', '')::numeric,
    (nullif(p_autoservice->>'gun_state', '')::numeric)::integer,
    (nullif(p_autoservice->>'bms_state', '')::numeric)::integer,
    nullif(p_autoservice->>'charge_capacity_kwh', '')::numeric,
    nullif(p_autoservice->>'charge_battery_volt', '')::numeric,
    (nullif(p_autoservice->>'battery_type', '')::numeric)::integer,
    nullif(p_autoservice->>'lifetime_mileage_km', '')::numeric,
    nullif(p_autoservice->>'lifetime_kwh', '')::numeric;
$$;

revoke all on function public.bydmate_autoservice_sample_columns(jsonb)
  from public, anon, authenticated;
grant execute on function public.bydmate_autoservice_sample_columns(jsonb)
  to service_role;

CREATE OR REPLACE FUNCTION public.bydmate_apply_diplus_columns(p_table regclass, p_where text, p_diplus jsonb, p_user_id uuid, p_vehicle_id text, p_device_time timestamp with time zone DEFAULT NULL::timestamp with time zone, p_received_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_telemetry jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_has_diplus_col boolean;
  v_diplus_assign text;
  v_guard text := '';
  v_sql text;
begin
  -- Only write the raw jsonb blob on tables that still carry the column.
  v_has_diplus_col := exists (
    select 1 from pg_attribute
    where attrelid = p_table and attname = 'diplus'
      and attnum > 0 and not attisdropped
  );

  if v_has_diplus_col then
    v_diplus_assign := 'diplus = coalesce($1, diplus), ';
  else
    v_diplus_assign := '';
    -- Keep $1 referenced so the param count still matches the USING list below.
    v_guard := ' and ($1 is null or $1 is not null)';
  end if;

  v_sql := format('update %s set ', p_table) || v_diplus_assign
    || '(diplus_soc, diplus_speed_kmh, diplus_mileage_km, diplus_power_kw, diplus_charge_gun_state, diplus_charging_status, diplus_battery_capacity_kwh, diplus_total_elec_consumption_kwh, diplus_voltage_12v, diplus_max_cell_voltage_v, diplus_min_cell_voltage_v, diplus_cell_delta_v, diplus_avg_battery_temp_c, diplus_exterior_temp_c, diplus_gear, diplus_power_state, diplus_inside_temp_c, diplus_ac_status, diplus_ac_temp_c, diplus_fan_level, diplus_door_fl, diplus_door_fr, diplus_door_rl, diplus_door_rr, diplus_window_fl_percent, diplus_window_fr_percent, diplus_window_rl_percent, diplus_window_rr_percent, diplus_sunroof_percent, diplus_trunk, diplus_hood, diplus_tire_press_fl_kpa, diplus_tire_press_fr_kpa, diplus_tire_press_rl_kpa, diplus_tire_press_rr_kpa, diplus_drive_mode, diplus_work_mode, diplus_auto_park, diplus_rain, diplus_light_low, diplus_drl, diplus_bms_state, diplus_charge_power_raw_kw, diplus_max_charge_power_kw) = '
    || '(select * from public.bydmate_diplus_sample_columns($2, $7))'
    || ' where ' || p_where || v_guard;

  execute v_sql
  using p_diplus,
    coalesce(p_diplus, '{}'::jsonb),
    p_user_id,
    p_vehicle_id,
    p_device_time,
    p_received_at,
    coalesce(p_telemetry, '{}'::jsonb);
end;
$function$;

create or replace function public.bydmate_ingest_telemetry(p_user_id uuid, p_vehicle_id text, p_source text, p_schema_version integer, p_device_time timestamp with time zone, p_received_at timestamp with time zone, p_telemetry jsonb, p_location jsonb, p_raw_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
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
  v_has_open_trip boolean;
  v_legacy_open_blocked boolean := false;
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

  -- The di+ and autoservice columns ride in the same INSERT. They used to be
  -- written by two follow-up UPDATEs from the 10-arg wrapper, which left two dead
  -- row versions per sample (see header).
  insert into public.bydmate_telemetry_samples (
    vehicle_id,
    user_id,
    device_time,
    received_at,
    telemetry,
    diplus_soc,
    diplus_speed_kmh,
    diplus_mileage_km,
    diplus_power_kw,
    diplus_charge_gun_state,
    diplus_charging_status,
    diplus_battery_capacity_kwh,
    diplus_total_elec_consumption_kwh,
    diplus_voltage_12v,
    diplus_max_cell_voltage_v,
    diplus_min_cell_voltage_v,
    diplus_cell_delta_v,
    diplus_avg_battery_temp_c,
    diplus_exterior_temp_c,
    diplus_gear,
    diplus_power_state,
    diplus_inside_temp_c,
    diplus_ac_status,
    diplus_ac_temp_c,
    diplus_fan_level,
    diplus_door_fl,
    diplus_door_fr,
    diplus_door_rl,
    diplus_door_rr,
    diplus_window_fl_percent,
    diplus_window_fr_percent,
    diplus_window_rl_percent,
    diplus_window_rr_percent,
    diplus_sunroof_percent,
    diplus_trunk,
    diplus_hood,
    diplus_tire_press_fl_kpa,
    diplus_tire_press_fr_kpa,
    diplus_tire_press_rl_kpa,
    diplus_tire_press_rr_kpa,
    diplus_drive_mode,
    diplus_work_mode,
    diplus_auto_park,
    diplus_rain,
    diplus_light_low,
    diplus_drl,
    diplus_bms_state,
    diplus_charge_power_raw_kw,
    diplus_max_charge_power_kw,
    autoservice_soc_percent,
    autoservice_power_kw,
    autoservice_gun_state,
    autoservice_bms_state,
    autoservice_charge_capacity_kwh,
    autoservice_charge_battery_volt,
    autoservice_battery_type,
    autoservice_lifetime_mileage_km,
    autoservice_lifetime_kwh
  )
  select
    p_vehicle_id,
    p_user_id,
    p_device_time,
    p_received_at,
    p_telemetry,
    d.*,
    a.*
  from public.bydmate_diplus_sample_columns(p_raw_payload->'diplus', p_telemetry) d
  cross join public.bydmate_autoservice_sample_columns(p_raw_payload->'autoservice') a
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

  -- Third-party webhook samples (bydmate-app-webhook) are telemetry only. They carry no
  -- client_trip block and no trip-meter delta, so the server trip path below would build a
  -- 0 km twin of every real Mate trip, and its charging / gear-P / stray-trip / gap closes
  -- could end a still-open Mate client trip (bydmate_trips_open_unique: one open trip per
  -- user+vehicle). Live snapshot, sample and hourly rollup above are kept.
  if p_source = 'bydmate-app-webhook' then
    return jsonb_build_object(
      'trip_skipped', true,
      'vehicle_id', p_vehicle_id,
      'last_device_time', p_device_time
    );
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

  v_has_open_trip := found;

  -- An untagged sample (daemon / fast-mode history row: no client_trip, ~3 s delivery) must
  -- not OPEN a server-owned trip for a vehicle whose app records client trips. The app's
  -- client-tagged batch for the same drive lands ~15-25 s later, closes the legacy trip as a
  -- stray with 1 sample / 0 km, and Rules A/B keep it (its max speed is 10-53 km/h) -> a
  -- visible duplicate next to the real trip. On every client-trip vehicle in prod, every
  -- legacy trip was such a stub (none carried distance). Vehicles without client trips in the
  -- last 7 days keep the legacy path. Only evaluated when a new trip would be opened, never
  -- on the per-sample extend path.
  if not v_has_open_trip or p_device_time - v_trip.last_device_time > v_trip_gap then
    v_legacy_open_blocked := exists (
      select 1
      from public.bydmate_trips c
      where c.user_id = p_user_id
        and c.vehicle_id = p_vehicle_id
        and c.started_at >= p_device_time - interval '7 days'
        and c.client_trip
    );
  end if;

  v_trip_distance := nullif(p_telemetry->>'current_trip_distance_km', '')::numeric;
  v_consumption := nullif(p_telemetry->>'current_trip_consumption_kwh_100km', '')::numeric;
  v_trip_meter_baseline := coalesce(v_trip_distance, 0);

  if v_has_open_trip then
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

      if v_is_drive_sample and not v_legacy_open_blocked then
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
  elsif not v_legacy_open_blocked then
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
  from public, anon, authenticated;
grant execute on function public.bydmate_ingest_telemetry(uuid, text, text, integer, timestamptz, timestamptz, jsonb, jsonb, jsonb)
  to service_role;

create or replace function public.bydmate_ingest_telemetry(
  p_user_id uuid,
  p_vehicle_id text,
  p_source text,
  p_schema_version integer,
  p_device_time timestamptz,
  p_received_at timestamptz,
  p_telemetry jsonb,
  p_diplus jsonb,
  p_location jsonb,
  p_raw_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_diplus jsonb := coalesce(p_diplus, '{}'::jsonb);
  v_raw_payload jsonb := coalesce(p_raw_payload, '{}'::jsonb);
  v_autoservice jsonb := p_raw_payload->'autoservice';
  v_live_only boolean := coalesce(nullif(v_raw_payload->>'live_only', '')::boolean, false);
begin
  if v_live_only then
    -- Fast path: refresh live state only. No history row, no hourly rollup, no
    -- trip create/extend. The bydmate_prevent_stale_live_snapshot_update trigger
    -- still keeps a retried older heartbeat from moving the snapshot backwards.
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
      p_telemetry,
      coalesce(p_location, '{}'::jsonb),
      v_raw_payload || jsonb_build_object('diplus', v_diplus)
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
  else
    -- The 9-arg function writes the sample with its di+ and autoservice columns
    -- already filled from raw_payload.diplus / raw_payload.autoservice.
    v_result := public.bydmate_ingest_telemetry(
      p_user_id,
      p_vehicle_id,
      p_source,
      p_schema_version,
      p_device_time,
      p_received_at,
      p_telemetry,
      p_location,
      v_raw_payload || jsonb_build_object('diplus', v_diplus)
    );
  end if;

  -- Live snapshot diplus columns are applied on both paths: VoltFlow's live view
  -- reads gear / gun state / 12V / cell voltages from these columns, and the
  -- route's persistence check asserts they are populated. The device_time guard
  -- makes this a no-op when a newer sample already advanced the snapshot.
  perform public.bydmate_apply_diplus_columns(
    'public.bydmate_live_snapshots'::regclass,
    'user_id = $3 and vehicle_id = $4 and device_time <= $5',
    p_diplus,
    p_user_id,
    p_vehicle_id,
    p_device_time,
    null,
    p_telemetry
  );

  if jsonb_typeof(v_autoservice) = 'object' then
    -- Same guard as the diplus apply: never stamp an older batch sample's values onto
    -- a live snapshot that has already advanced past it.
    update public.bydmate_live_snapshots
    set (autoservice_soc_percent, autoservice_power_kw, autoservice_gun_state, autoservice_bms_state, autoservice_charge_capacity_kwh, autoservice_charge_battery_volt, autoservice_battery_type, autoservice_lifetime_mileage_km, autoservice_lifetime_kwh) =
      (select * from public.bydmate_autoservice_sample_columns(v_autoservice))
    where user_id = p_user_id
      and vehicle_id = p_vehicle_id
      and device_time <= p_device_time;
  end if;

  if v_live_only then
    -- No sample_count key: parseIngestStats falls back to the payload count and
    -- reports the sample as accepted. See the ack-accounting note in the header.
    return jsonb_build_object('live_only', true);
  end if;

  return v_result;
end;
$$;

revoke all on function public.bydmate_ingest_telemetry(uuid, text, text, integer, timestamptz, timestamptz, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.bydmate_ingest_telemetry(uuid, text, text, integer, timestamptz, timestamptz, jsonb, jsonb, jsonb, jsonb)
  to service_role;
