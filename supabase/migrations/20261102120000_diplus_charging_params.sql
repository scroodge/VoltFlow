-- di+ 2.0.0b8+ charging params from Mate's getDiPars template (#116 / #117 / #125).
--
-- Mate (BYDMate-own) now asks di+ for 电池管理状态 / 充电功率 / 最大允许充电功率 and sends them
-- as diplus.bms_state / charge_power_raw_kw / max_charge_power_kw. Older di+ echoes an unknown
-- placeholder back literally, so those senders simply omit the keys and these columns stay null.
--
--   diplus_bms_state            BYD getBatteryManagementDeviceState() raw enum — same values as
--                               autoservice_bms_state (0 preparing, 1 charging, 2 complete,
--                               15 gun in / idle), but also sent by the car-off daemon, which
--                               never sends autoservice.*.
--   diplus_charge_power_raw_kw  BYD getChargingPower(). Diagnostic only: it read 0.0 through
--                               real AC charges on car `way` (BYDMate-own docs/DIPLUS_DATA.md).
--                               Never a substitute for telemetry.charge_power_kw.
--   diplus_max_charge_power_kw  BMS max allowed charge power, kW.
--
-- Collect-only: nothing in the charging state machine reads these yet (BACKLOG option A).
--
-- BASE BODY = bydmate_apply_diplus_columns LIVE on prod on 2026-11-02 (dumped from pg_proc).
-- The only change is the three trailing assignments. create or replace keeps the existing
-- ACL (postgres + service_role only; anon/authenticated have no EXECUTE — verified).
-- Both tables get the columns because the function updates samples and live snapshots.
-- Rollback: re-apply the function without the three assignments; the columns are harmless.
-- Idempotent: safe to re-run.

alter table public.bydmate_telemetry_samples
  add column if not exists diplus_bms_state integer,
  add column if not exists diplus_charge_power_raw_kw numeric,
  add column if not exists diplus_max_charge_power_kw numeric;

alter table public.bydmate_live_snapshots
  add column if not exists diplus_bms_state integer,
  add column if not exists diplus_charge_power_raw_kw numeric,
  add column if not exists diplus_max_charge_power_kw numeric;

CREATE OR REPLACE FUNCTION public.bydmate_apply_diplus_columns(p_table regclass, p_where text, p_diplus jsonb, p_user_id uuid, p_vehicle_id text, p_device_time timestamp with time zone DEFAULT NULL::timestamp with time zone, p_received_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_telemetry jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
       diplus_drl = public.bydmate_jsonb_text($2, 'drl'),
       diplus_bms_state = public.bydmate_jsonb_numeric($2, 'bms_state')::integer,
       diplus_charge_power_raw_kw = public.bydmate_jsonb_numeric($2, 'charge_power_raw_kw'),
       diplus_max_charge_power_kw = public.bydmate_jsonb_numeric($2, 'max_charge_power_kw')
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
