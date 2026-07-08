-- Add autoservice Binder FID fields to telemetry samples and live snapshots.
-- These fields come from the BYD autoservice system service (requires ADB),
-- providing BMS-direct data that Di+ either doesn't expose or exposes unreliably.
-- Source: AndyShaman's BYDMate FidRegistry.kt
-- Idempotent: safe to re-run.

-- Telemetry samples: add autoservice fields
alter table public.bydmate_telemetry_samples
  add column if not exists autoservice_soc_percent numeric,
  add column if not exists autoservice_power_kw numeric,
  add column if not exists autoservice_gun_state integer,
  add column if not exists autoservice_bms_state integer,
  add column if not exists autoservice_charge_capacity_kwh numeric,
  add column if not exists autoservice_charge_battery_volt numeric,
  add column if not exists autoservice_battery_type integer,
  add column if not exists autoservice_lifetime_mileage_km numeric,
  add column if not exists autoservice_lifetime_kwh numeric;

comment on column public.bydmate_telemetry_samples.autoservice_soc_percent is
  'SOC from autoservice FID_SOC (BMS-direct, more reliable than Di+)';
comment on column public.bydmate_telemetry_samples.autoservice_power_kw is
  'Signed engine power from autoservice FID_ENGINE_POWER (+consumption, -regen)';
comment on column public.bydmate_telemetry_samples.autoservice_gun_state is
  'Gun connect state from autoservice FID_GUN_CONNECT_STATE (1=NONE, 2=AC, 3=DC, 4=AC_DC, 5=VTOL)';
comment on column public.bydmate_telemetry_samples.autoservice_bms_state is
  'BMS charging state from FID_CHARGING_BMS_STATE (1=CHARGING, 2=FINISH, 13=PAUSE)';
comment on column public.bydmate_telemetry_samples.autoservice_charge_capacity_kwh is
  'Per-session BMS energy counter from FID_CHARGING_CAPACITY (persists across DiLink sleep)';
comment on column public.bydmate_telemetry_samples.autoservice_charge_battery_volt is
  'Charger HV voltage from FID_CHARGE_BATTERY_VOLT';
comment on column public.bydmate_telemetry_samples.autoservice_battery_type is
  'Battery chemistry from FID_BATTERY_TYPE (0=LEAD_ACID, 1=IRON/LFP, 65535=INVALID)';
comment on column public.bydmate_telemetry_samples.autoservice_lifetime_mileage_km is
  'BMS-authoritative odometer from FID_LIFETIME_MILEAGE (divide raw by 10)';
comment on column public.bydmate_telemetry_samples.autoservice_lifetime_kwh is
  'Total energy throughput from FID_LIFETIME_KWH';

-- Live snapshots: add autoservice fields
alter table public.bydmate_live_snapshots
  add column if not exists autoservice_soc_percent numeric,
  add column if not exists autoservice_power_kw numeric,
  add column if not exists autoservice_gun_state integer,
  add column if not exists autoservice_bms_state integer,
  add column if not exists autoservice_charge_capacity_kwh numeric,
  add column if not exists autoservice_charge_battery_volt numeric,
  add column if not exists autoservice_battery_type integer,
  add column if not exists autoservice_lifetime_mileage_km numeric,
  add column if not exists autoservice_lifetime_kwh numeric;

comment on column public.bydmate_live_snapshots.autoservice_soc_percent is
  'SOC from autoservice FID_SOC (BMS-direct, more reliable than Di+)';
comment on column public.bydmate_live_snapshots.autoservice_power_kw is
  'Signed engine power from autoservice FID_ENGINE_POWER (+consumption, -regen)';
comment on column public.bydmate_live_snapshots.autoservice_gun_state is
  'Gun connect state from autoservice FID_GUN_CONNECT_STATE';
comment on column public.bydmate_live_snapshots.autoservice_bms_state is
  'BMS charging state from FID_CHARGING_BMS_STATE';
comment on column public.bydmate_live_snapshots.autoservice_charge_capacity_kwh is
  'Per-session BMS energy counter from FID_CHARGING_CAPACITY';
comment on column public.bydmate_live_snapshots.autoservice_charge_battery_volt is
  'Charger HV voltage from FID_CHARGE_BATTERY_VOLT';
comment on column public.bydmate_live_snapshots.autoservice_battery_type is
  'Battery chemistry from FID_BATTERY_TYPE';
comment on column public.bydmate_live_snapshots.autoservice_lifetime_mileage_km is
  'BMS-authoritative odometer from FID_LIFETIME_MILEAGE';
comment on column public.bydmate_live_snapshots.autoservice_lifetime_kwh is
  'Total energy throughput from FID_LIFETIME_KWH';
