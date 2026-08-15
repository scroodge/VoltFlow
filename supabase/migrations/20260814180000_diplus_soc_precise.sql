-- Keep the fractional SOC that VoltFlow Mate already sends instead of flattening it
-- to a whole percent.
--
-- Di+ 2.0 reports SOC at 0.1 % resolution. VoltFlow Mate versionCode 340 puts that
-- unrounded value into `telemetry.soc`, but the `diplus` object in the same payload
-- still carries the app's rounded integer (DiParsData.soc is an Int; see
-- CloudTelemetryPayload.kt). This function flattens from `p_diplus`, so the decimal
-- was dropped on the way into the column even though nothing here rounds and
-- `diplus_soc` is an unconstrained `numeric`. Measured on prod 2026-08-14:
-- `telemetry->>'soc' = 66.2` alongside `diplus->>'soc' = 66` and `diplus_soc = 66`.
--
-- Fixing it here rather than in the app covers every car already running 340 without
-- waiting on an APK release, and covers the daemon and Edge Function ingest paths too.
--
-- The rule is a refinement, not a source switch: `telemetry.soc` is used only when it
-- agrees with the di+ value to within the app's own rounding step (<= 0.5), so the
-- column keeps its di+ provenance. When di+ is down and the app falls back to the
-- autoservice SOC, the diplus object carries no `soc`, the two values are more than
-- 0.5 apart, or the payload predates 340, the previous di+ value is kept unchanged --
-- on prod the divergent case did not occur once in the last 7 days (3649 rows gained
-- a decimal, 0 rows disagreed by more than 0.5).
--
-- The 0-100 range guard from 20260810120000_guard_diplus_soc_range.sql is preserved:
-- di+'s -1 unavailable-SOC sentinel still lands as NULL, whichever source won.
create or replace function public.bydmate_apply_diplus_columns(p_table regclass, p_where text, p_diplus jsonb, p_user_id uuid, p_vehicle_id text, p_device_time timestamp with time zone DEFAULT NULL::timestamp with time zone, p_received_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_telemetry jsonb DEFAULT '{}'::jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_diplus jsonb := coalesce(p_diplus, '{}'::jsonb);
  v_telemetry jsonb := coalesce(p_telemetry, '{}'::jsonb);
  v_diplus_soc numeric;
  v_telemetry_soc numeric;
  v_soc numeric;
  v_min_cell_voltage numeric;
  v_max_cell_voltage numeric;
  v_cell_delta numeric;
  v_has_diplus_col boolean;
  v_diplus_assign text;
  v_guard text := '';
  v_sql text;
begin
  v_diplus_soc := public.bydmate_jsonb_numeric(v_diplus, 'soc');
  v_telemetry_soc := public.bydmate_jsonb_numeric(v_telemetry, 'soc');

  -- Same reading at finer resolution, or nothing: 0.5 is exactly the app's rounding
  -- step (DiParsClient.parseIntNum uses round()), so a larger gap means the two
  -- fields came from different sources and the di+ one stays authoritative.
  if v_diplus_soc is not null
     and v_telemetry_soc is not null
     and abs(v_telemetry_soc - v_diplus_soc) <= 0.5
  then
    v_soc := v_telemetry_soc;
  else
    v_soc := v_diplus_soc;
  end if;

  if v_soc is not null and v_soc not between 0 and 100 then
    v_soc := null;
  end if;

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
       diplus_soc = $10,
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
    v_cell_delta,
    v_soc;
end;
$function$;
