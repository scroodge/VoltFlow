-- bydmate_update_hourly_energy integrates traction `power_kw` between consecutive samples
-- into regen_kwh_sum/traction_kwh_sum with no charging guard. docs/ARCHITECTURE.md rule 5
-- ("auto-detect charging from charge_power_kw, never traction power_kw") was applied to
-- charging-session detection but never to this rollup.
--
-- Confirmed in prod on 2026-09-17: on nikolayushak1998@gmail.com's account, power_kw mirrors
-- -charge_power_kw while parked and DC fast-charging (speed 0, SOC climbing fast), so a single
-- hour of charging (37.2 kWh) was booked entirely as "regen" -- the exact spikes (37-58 kWh/day)
-- the user spotted on the Analytics "Рекуперированная энергия" chart against a normal 1-5 kWh
-- baseline.
--
-- Fix: bydmate_update_hourly_energy now takes the current sample's charge_power_kw, also reads
-- the previous sample's charge_power_kw, and skips the interval entirely (no regen/traction
-- accumulation) when either endpoint shows real charging power (> 0.1 kW, the threshold already
-- used elsewhere in this codebase for charge-power gating). The signature changes, so the old
-- 4-arg function is dropped and replaced; its sole caller, bydmate_apply_hourly_rollup_sample,
-- is updated in the same migration to extract and pass charge_power_kw through.

drop function if exists public.bydmate_update_hourly_energy(uuid, text, timestamptz, numeric);

create function public.bydmate_update_hourly_energy(
  p_user_id uuid,
  p_vehicle_id text,
  p_device_time timestamp with time zone,
  p_power numeric,
  p_charge_power numeric
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_prev record;
  v_hour_start timestamptz;
  v_dt_seconds numeric;
  v_energy record;
begin
  if p_power is null then
    return;
  end if;

  select
    s.device_time,
    nullif(s.telemetry->>'power_kw', '')::numeric as power_kw,
    nullif(s.telemetry->>'charge_power_kw', '')::numeric as charge_power_kw
  into v_prev
  from public.bydmate_telemetry_samples s
  where s.user_id = p_user_id
    and s.vehicle_id = p_vehicle_id
    and s.device_time < p_device_time
  order by s.device_time desc
  limit 1;

  if not found or v_prev.power_kw is null then
    return;
  end if;

  -- Traction power_kw can mirror -charge_power_kw while charging on some cars/firmware; never
  -- book a charging interval as regen/traction energy.
  if coalesce(v_prev.charge_power_kw, 0) > 0.1 or coalesce(p_charge_power, 0) > 0.1 then
    return;
  end if;

  v_dt_seconds := extract(epoch from (p_device_time - v_prev.device_time));
  if v_dt_seconds <= 0 or v_dt_seconds > 180 then
    return;
  end if;

  v_hour_start := date_trunc('hour', p_device_time at time zone 'utc');

  select * into v_energy
  from public.bydmate_interval_energy_kwh(v_prev.power_kw, p_power, v_dt_seconds);

  update public.bydmate_telemetry_hourly
  set
    regen_kwh_sum = regen_kwh_sum + coalesce(v_energy.regen_kwh, 0),
    traction_kwh_sum = traction_kwh_sum + coalesce(v_energy.traction_kwh, 0)
  where user_id = p_user_id
    and vehicle_id = p_vehicle_id
    and hour_start = v_hour_start;
end;
$function$;

revoke all on function public.bydmate_update_hourly_energy(uuid, text, timestamptz, numeric, numeric) from public;
grant execute on function public.bydmate_update_hourly_energy(uuid, text, timestamptz, numeric, numeric) to service_role;

create or replace function public.bydmate_apply_hourly_rollup_sample(
  p_user_id uuid,
  p_vehicle_id text,
  p_device_time timestamp with time zone,
  p_telemetry jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_soc numeric;
  v_speed numeric;
  v_power numeric;
  v_charge_power numeric;
  v_battery_temp numeric;
  v_cabin_temp numeric;
  v_outside_temp numeric;
  v_hour_start timestamptz;
begin
  v_soc := nullif(p_telemetry->>'soc', '')::numeric;
  v_speed := nullif(p_telemetry->>'speed_kmh', '')::numeric;
  v_power := nullif(p_telemetry->>'power_kw', '')::numeric;
  v_charge_power := nullif(p_telemetry->>'charge_power_kw', '')::numeric;
  v_battery_temp := nullif(p_telemetry->>'battery_temp_c', '')::numeric;
  v_cabin_temp := nullif(p_telemetry->>'cabin_temp_c', '')::numeric;
  v_outside_temp := nullif(p_telemetry->>'outside_temp_c', '')::numeric;
  v_hour_start := date_trunc('hour', p_device_time at time zone 'utc');

  insert into public.bydmate_telemetry_hourly (
    user_id,
    vehicle_id,
    hour_start,
    sample_count,
    soc_min,
    soc_max,
    soc_last,
    speed_max,
    power_avg,
    battery_temp_avg,
    cabin_temp_avg,
    outside_temp_avg,
    power_sample_count,
    battery_temp_sample_count,
    cabin_temp_sample_count,
    outside_temp_sample_count
  )
  values (
    p_user_id,
    p_vehicle_id,
    v_hour_start,
    1,
    v_soc,
    v_soc,
    v_soc,
    v_speed,
    v_power,
    v_battery_temp,
    v_cabin_temp,
    v_outside_temp,
    case when v_power is null then 0 else 1 end,
    case when v_battery_temp is null then 0 else 1 end,
    case when v_cabin_temp is null then 0 else 1 end,
    case when v_outside_temp is null then 0 else 1 end
  )
  on conflict (user_id, vehicle_id, hour_start) do update
  set
    sample_count = public.bydmate_telemetry_hourly.sample_count + 1,
    soc_min = least(public.bydmate_telemetry_hourly.soc_min, excluded.soc_min),
    soc_max = greatest(public.bydmate_telemetry_hourly.soc_max, excluded.soc_max),
    soc_last = coalesce(excluded.soc_last, public.bydmate_telemetry_hourly.soc_last),
    speed_max = greatest(public.bydmate_telemetry_hourly.speed_max, excluded.speed_max),
    power_avg = case
      when excluded.power_sample_count = 0 then public.bydmate_telemetry_hourly.power_avg
      when public.bydmate_telemetry_hourly.power_sample_count = 0 then excluded.power_avg
      else (
        public.bydmate_telemetry_hourly.power_avg * public.bydmate_telemetry_hourly.power_sample_count
        + excluded.power_avg
      ) / (public.bydmate_telemetry_hourly.power_sample_count + excluded.power_sample_count)
    end,
    battery_temp_avg = case
      when excluded.battery_temp_sample_count = 0 then public.bydmate_telemetry_hourly.battery_temp_avg
      when public.bydmate_telemetry_hourly.battery_temp_sample_count = 0 then excluded.battery_temp_avg
      else (
        public.bydmate_telemetry_hourly.battery_temp_avg * public.bydmate_telemetry_hourly.battery_temp_sample_count
        + excluded.battery_temp_avg
      ) / (public.bydmate_telemetry_hourly.battery_temp_sample_count + excluded.battery_temp_sample_count)
    end,
    cabin_temp_avg = case
      when excluded.cabin_temp_sample_count = 0 then public.bydmate_telemetry_hourly.cabin_temp_avg
      when public.bydmate_telemetry_hourly.cabin_temp_sample_count = 0 then excluded.cabin_temp_avg
      else (
        public.bydmate_telemetry_hourly.cabin_temp_avg * public.bydmate_telemetry_hourly.cabin_temp_sample_count
        + excluded.cabin_temp_avg
      ) / (public.bydmate_telemetry_hourly.cabin_temp_sample_count + excluded.cabin_temp_sample_count)
    end,
    outside_temp_avg = case
      when excluded.outside_temp_sample_count = 0 then public.bydmate_telemetry_hourly.outside_temp_avg
      when public.bydmate_telemetry_hourly.outside_temp_sample_count = 0 then excluded.outside_temp_avg
      else (
        public.bydmate_telemetry_hourly.outside_temp_avg * public.bydmate_telemetry_hourly.outside_temp_sample_count
        + excluded.outside_temp_avg
      ) / (public.bydmate_telemetry_hourly.outside_temp_sample_count + excluded.outside_temp_sample_count)
    end,
    power_sample_count = public.bydmate_telemetry_hourly.power_sample_count + excluded.power_sample_count,
    battery_temp_sample_count = public.bydmate_telemetry_hourly.battery_temp_sample_count + excluded.battery_temp_sample_count,
    cabin_temp_sample_count = public.bydmate_telemetry_hourly.cabin_temp_sample_count + excluded.cabin_temp_sample_count,
    outside_temp_sample_count = public.bydmate_telemetry_hourly.outside_temp_sample_count + excluded.outside_temp_sample_count;

  perform public.bydmate_update_hourly_energy(p_user_id, p_vehicle_id, p_device_time, v_power, v_charge_power);
end;
$function$;
