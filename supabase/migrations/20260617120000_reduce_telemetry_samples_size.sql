-- Reduce bydmate_telemetry_samples on-disk size.
--
-- Context: bydmate_telemetry_samples was ~453 MB of a ~507 MB / 512 MB free-tier
-- database. Each row averaged ~1.35 KB, dominated by two jsonb blobs:
--   * telemetry (~500 B/row) -- source of truth, kept.
--   * diplus    (~874 B/row) -- raw device payload, fully redundant on this table:
--                               every value the app reads is already exploded into
--                               flat diplus_* columns (and the cell-voltage/SOC
--                               readers prefer those columns first). The live
--                               snapshot table (bydmate_live_snapshots) keeps its
--                               own diplus blob, so live-view is unaffected.
--
-- This migration:
--   1. Makes bydmate_apply_diplus_columns only write the raw `diplus` column when
--      the target table actually has it (so live_snapshots keeps it, samples drops it).
--   2. Drops the redundant index user_vehicle_time_idx (DESC) -- fully covered by the
--      UNIQUE index on (user_id, vehicle_id, device_time) via a backward scan.
--   3. Drops the raw `diplus` column from bydmate_telemetry_samples.
--   4. Adds bydmate_prune_telemetry_samples(keep_days) for ongoing retention of old
--      non-charging rows already captured in the hourly rollup.
--
-- NOTE: DROP COLUMN only marks the column dropped; run VACUUM FULL (outside a
-- transaction / migration) afterwards to actually reclaim the disk space.

-- 1. Conditional raw-diplus write -------------------------------------------------
create or replace function public.bydmate_apply_diplus_columns(
  p_table regclass,
  p_where text,
  p_diplus jsonb,
  p_user_id uuid,
  p_vehicle_id text,
  p_device_time timestamp with time zone default null,
  p_received_at timestamp with time zone default null,
  p_telemetry jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_diplus jsonb := coalesce(p_diplus, '{}'::jsonb);
  v_telemetry jsonb := coalesce(p_telemetry, '{}'::jsonb);
  v_min_cell_voltage numeric;
  v_max_cell_voltage numeric;
  v_cell_delta numeric;
  v_has_diplus_col boolean;
  v_diplus_assign text;
  v_guard text := '';
  v_sql text;
begin
  v_min_cell_voltage := coalesce(
    public.bydmate_jsonb_numeric(v_telemetry, 'diplus_min_cell_voltage_v'),
    public.bydmate_jsonb_numeric(v_telemetry, 'cell_voltage_min_v'),
    public.bydmate_jsonb_numeric(v_diplus, 'min_cell_voltage_v')
  );

  v_max_cell_voltage := coalesce(
    public.bydmate_jsonb_numeric(v_telemetry, 'diplus_max_cell_voltage_v'),
    public.bydmate_jsonb_numeric(v_telemetry, 'cell_voltage_max_v'),
    public.bydmate_jsonb_numeric(v_diplus, 'max_cell_voltage_v')
  );

  v_cell_delta := coalesce(
    public.bydmate_jsonb_numeric(v_telemetry, 'diplus_cell_delta_v'),
    public.bydmate_jsonb_numeric(v_telemetry, 'cell_delta_v'),
    public.bydmate_jsonb_numeric(v_diplus, 'cell_delta_v'),
    case
      when v_min_cell_voltage is not null and v_max_cell_voltage is not null
        then v_max_cell_voltage - v_min_cell_voltage
      else null
    end
  );

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

  v_sql := format('update %s set ', p_table) || v_diplus_assign || $set$
       diplus_soc = public.bydmate_jsonb_numeric($2, 'soc'),
       diplus_speed_kmh = public.bydmate_jsonb_numeric($2, 'speed_kmh'),
       diplus_mileage_km = public.bydmate_jsonb_numeric($2, 'mileage_km'),
       diplus_power_kw = public.bydmate_jsonb_numeric($2, 'power_kw'),
       diplus_charge_gun_state = public.bydmate_jsonb_text($2, 'charge_gun_state'),
       diplus_charging_status = public.bydmate_jsonb_text($2, 'charging_status'),
       diplus_battery_capacity_kwh = public.bydmate_jsonb_numeric($2, 'battery_capacity_kwh'),
       diplus_total_elec_consumption_kwh = public.bydmate_jsonb_numeric($2, 'total_elec_consumption_kwh'),
       diplus_voltage_12v = public.bydmate_jsonb_numeric($2, 'voltage_12v'),
       diplus_max_cell_voltage_v = $8,
       diplus_min_cell_voltage_v = $7,
       diplus_cell_delta_v = $9,
       diplus_avg_battery_temp_c = public.bydmate_jsonb_numeric($2, 'avg_battery_temp_c'),
       diplus_exterior_temp_c = public.bydmate_jsonb_numeric($2, 'exterior_temp_c'),
       diplus_gear = public.bydmate_jsonb_text($2, 'gear'),
       diplus_power_state = public.bydmate_jsonb_text($2, 'power_state'),
       diplus_inside_temp_c = public.bydmate_jsonb_numeric($2, 'inside_temp_c'),
       diplus_ac_status = public.bydmate_jsonb_text($2, 'ac_status'),
       diplus_ac_temp_c = public.bydmate_jsonb_numeric($2, 'ac_temp_c'),
       diplus_fan_level = public.bydmate_jsonb_numeric($2, 'fan_level'),
       diplus_door_fl = public.bydmate_jsonb_text($2, 'door_fl'),
       diplus_door_fr = public.bydmate_jsonb_text($2, 'door_fr'),
       diplus_door_rl = public.bydmate_jsonb_text($2, 'door_rl'),
       diplus_door_rr = public.bydmate_jsonb_text($2, 'door_rr'),
       diplus_window_fl_percent = public.bydmate_jsonb_numeric($2, 'window_fl_percent'),
       diplus_window_fr_percent = public.bydmate_jsonb_numeric($2, 'window_fr_percent'),
       diplus_window_rl_percent = public.bydmate_jsonb_numeric($2, 'window_rl_percent'),
       diplus_window_rr_percent = public.bydmate_jsonb_numeric($2, 'window_rr_percent'),
       diplus_sunroof_percent = public.bydmate_jsonb_numeric($2, 'sunroof_percent'),
       diplus_trunk = public.bydmate_jsonb_text($2, 'trunk'),
       diplus_hood = public.bydmate_jsonb_text($2, 'hood'),
       diplus_tire_press_fl_kpa = public.bydmate_jsonb_numeric($2, 'tire_press_fl_kpa'),
       diplus_tire_press_fr_kpa = public.bydmate_jsonb_numeric($2, 'tire_press_fr_kpa'),
       diplus_tire_press_rl_kpa = public.bydmate_jsonb_numeric($2, 'tire_press_rl_kpa'),
       diplus_tire_press_rr_kpa = public.bydmate_jsonb_numeric($2, 'tire_press_rr_kpa'),
       diplus_drive_mode = public.bydmate_jsonb_text($2, 'drive_mode'),
       diplus_work_mode = public.bydmate_jsonb_text($2, 'work_mode'),
       diplus_auto_park = public.bydmate_jsonb_text($2, 'auto_park'),
       diplus_rain = public.bydmate_jsonb_text($2, 'rain'),
       diplus_light_low = public.bydmate_jsonb_text($2, 'light_low'),
       diplus_drl = public.bydmate_jsonb_text($2, 'drl')
     where $set$ || p_where || v_guard;

  execute v_sql
  using p_diplus,
    v_diplus,
    p_user_id,
    p_vehicle_id,
    p_device_time,
    p_received_at,
    v_min_cell_voltage,
    v_max_cell_voltage,
    v_cell_delta;
end;
$function$;

-- 2. Drop the redundant index ----------------------------------------------------
drop index if exists public.bydmate_telemetry_samples_user_vehicle_time_idx;

-- 3. Drop the redundant raw diplus blob ------------------------------------------
alter table public.bydmate_telemetry_samples drop column if exists diplus;

-- 4. Retention helper for ongoing pruning ----------------------------------------
-- Deletes raw samples older than p_keep_days that are NOT inside a charging-session
-- window (charts need that resolution) and whose hour is already captured in the
-- hourly rollup, so no aggregate history is lost.
create or replace function public.bydmate_prune_telemetry_samples(p_keep_days integer default 30)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_deleted integer;
begin
  with cs as (
    select user_id, started_at, coalesce(stopped_at, now()) as stopped_at
    from public.charging_sessions
  ), del as (
    delete from public.bydmate_telemetry_samples s
    where s.device_time < now() - make_interval(days => p_keep_days)
      and coalesce(s.telemetry->>'is_charging', '') <> 'true'
      and not exists (
        select 1 from cs
        where cs.user_id = s.user_id
          and s.device_time between cs.started_at - interval '15 min'
                                and cs.stopped_at + interval '15 min'
      )
      and exists (
        select 1 from public.bydmate_telemetry_hourly h
        where h.user_id = s.user_id
          and h.vehicle_id = s.vehicle_id
          and h.hour_start = date_trunc('hour', s.device_time at time zone 'utc')
      )
    returning 1
  )
  select count(*) into v_deleted from del;
  return v_deleted;
end;
$function$;
