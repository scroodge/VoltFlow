export type SessionStatus = "idle" | "charging" | "completed" | "stopped";
export type ChargingTariffType = "home" | "commercial_ac" | "fast_dc";
export type ChargingProviderType =
  | "home"
  | "malanka"
  | "evika"
  | "forevo"
  | "zaryadka"
  | "custom";

export type Profile = {
  id: string;
  email: string | null;
  preferred_currency: "EUR" | "USD" | "BYN" | "RUB";
  preferred_locale: "en" | "be" | "ru";
  default_price_per_kwh: number;
  home_price_per_kwh: number;
  commercial_ac_price_per_kwh: number;
  fast_dc_price_per_kwh: number;
  bydmate_cloud_api_key: string | null;
  is_premium: boolean;
  created_at: string;
};

import type { CarGeneration } from "@/lib/car-generations";

export type Car = {
  id: string;
  user_id: string;
  name: string;
  model_generation: CarGeneration;
  battery_capacity_kwh: number;
  default_charger_power_kw: number;
  default_efficiency_percent: number;
  home_charger_lat?: number | null;
  home_charger_lon?: number | null;
  home_charger_radius_m?: number | null;
  vehicle_alias?: string | null;
  created_at: string;
};

export type ChargingSessionRow = {
  id: string;
  user_id: string;
  car_id: string;
  start_percent: number;
  current_percent: number;
  target_percent: number;
  battery_capacity_kwh: number;
  charger_power_kw: number;
  efficiency_percent: number;
  tariff_type: ChargingTariffType;
  provider_type: ChargingProviderType;
  price_per_kwh: number;
  charged_energy_kwh: number;
  estimated_cost: number;
  status: SessionStatus;
  started_at: string | null;
  stopped_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ChargingTariffLocationRow = {
  id: string;
  user_id: string;
  name: string;
  lat: number;
  lng: number;
  radius_m: number;
  tariff_type: ChargingTariffType;
  provider_type: ChargingProviderType;
  price_per_kwh_override: number | null;
  created_at: string;
  updated_at: string;
};

export type ChargingSessionComputed = ChargingSessionRow & {
  derived: {
    currentPercent: number;
    chargedEnergyKwh: number;
    estimatedCost: number;
    elapsedSeconds: number;
    remainingSeconds: number;
    isComplete: boolean;
  };
};

export type PushSubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  expiration_time: number | null;
  created_at: string;
  updated_at: string;
};

export type BydmateTelemetry = {
  soc?: number | null;
  speed_kmh?: number | null;
  power_kw?: number | null;
  battery_temp_c?: number | null;
  cabin_temp_c?: number | null;
  outside_temp_c?: number | null;
  battery_voltage_v?: number | null;
  aux_voltage_v?: number | null;
  cell_voltage_min_v?: number | null;
  cell_voltage_max_v?: number | null;
  cell_delta_v?: number | null;
  diplus_min_cell_voltage_v?: number | null;
  diplus_max_cell_voltage_v?: number | null;
  diplus_cell_delta_v?: number | null;
  odometer_km?: number | null;
  soh_percent?: number | null;
  is_charging?: boolean | null;
  charge_power_kw?: number | null;
  charge_type?: string | null;
  kwh_charged?: number | null;
  range_est_km?: number | null;
  current_trip_distance_km?: number | null;
  current_trip_consumption_kwh_100km?: number | null;
};

export type BydmateDiplus = {
  soc?: number | null;
  speed_kmh?: number | null;
  mileage_km?: number | null;
  power_kw?: number | null;
  charge_gun_state?: string | number | null;
  charging_status?: string | number | null;
  battery_capacity_kwh?: number | null;
  total_elec_consumption_kwh?: number | null;
  voltage_12v?: number | null;
  max_cell_voltage_v?: number | null;
  min_cell_voltage_v?: number | null;
  cell_delta_v?: number | null;
  avg_battery_temp_c?: number | null;
  exterior_temp_c?: number | null;
  gear?: string | number | null;
  power_state?: string | number | null;
  inside_temp_c?: number | null;
  ac_status?: string | number | boolean | null;
  ac_temp_c?: number | null;
  fan_level?: number | null;
  door_fl?: string | number | boolean | null;
  door_fr?: string | number | boolean | null;
  door_rl?: string | number | boolean | null;
  door_rr?: string | number | boolean | null;
  window_fl_percent?: number | null;
  window_fr_percent?: number | null;
  window_rl_percent?: number | null;
  window_rr_percent?: number | null;
  sunroof_percent?: number | null;
  trunk?: string | number | boolean | null;
  hood?: string | number | boolean | null;
  tire_press_fl_kpa?: number | null;
  tire_press_fr_kpa?: number | null;
  tire_press_rl_kpa?: number | null;
  tire_press_rr_kpa?: number | null;
  drive_mode?: string | number | null;
  work_mode?: string | number | null;
  auto_park?: string | number | boolean | null;
  rain?: string | number | boolean | null;
  light_low?: string | number | boolean | null;
  drl?: string | number | boolean | null;
  sunshade_percent?: number | null;
  sentry_state?: string | number | null;
  sentry_provider?: string | null;
  sentry_active?: boolean | null;
  stall_sentry_mode?: string | null;
  remote_lock_state?: string | number | null;
};

export type VehicleCommandStatus = "pending" | "sent" | "done" | "failed" | "rejected";

export type VehicleCommandRow = {
  id: string;
  user_id: string;
  vehicle_id: string;
  type: string;
  params: Record<string, unknown>;
  status: VehicleCommandStatus;
  result: Record<string, unknown> | null;
  created_at: string;
  executed_at: string | null;
};

export type BydmateLocation = {
  lat?: number | null;
  lon?: number | null;
  accuracy_m?: number | null;
  bearing_deg?: number | null;
};

export type BydmateLiveSnapshotRow = {
  id: string;
  vehicle_id: string;
  user_id: string;
  source: "BYDMate";
  schema_version: 1;
  device_time: string;
  received_at: string;
  telemetry: BydmateTelemetry;
  diplus?: BydmateDiplus;
  location: BydmateLocation;
  raw_payload: unknown;
  updated_at: string;
  diplus_min_cell_voltage_v?: number | null;
  diplus_max_cell_voltage_v?: number | null;
  diplus_cell_delta_v?: number | null;
  diplus_mileage_km?: number | null;
  diplus_voltage_12v?: number | null;
  diplus_gear?: string | number | null;
  mate_version?: string | null;
};

export type MateAppReleaseRow = {
  id: string;
  version: string;
  version_code: number | null;
  apk_url: string | null;
  release_notes: string | null;
  published_at: string;
  created_at: string;
};

export type BydmateTelemetryPointRow = Omit<BydmateLiveSnapshotRow, "updated_at"> & {
  id: string;
};

export type BydmateTelemetrySampleRow = {
  id: string;
  vehicle_id: string;
  user_id: string;
  device_time: string;
  received_at: string;
  telemetry: BydmateTelemetry;
  diplus?: BydmateDiplus;
  diplus_min_cell_voltage_v?: number | null;
  diplus_max_cell_voltage_v?: number | null;
  diplus_cell_delta_v?: number | null;
};

export type BydmateTripRow = {
  id: string;
  user_id: string;
  vehicle_id: string;
  started_at: string;
  ended_at: string | null;
  last_device_time: string;
  sample_count: number;
  track_point_count: number;
  distance_km: number | null;
  trip_meter_baseline_km?: number | null;
  soc_start: number | null;
  soc_end: number | null;
  max_speed_kmh: number | null;
  avg_speed_kmh: number | null;
  avg_consumption_kwh_100km: number | null;
  regen_energy_kwh?: number | null;
  traction_energy_kwh?: number | null;
  power_sample_count?: number;
};

export type BydmateTripTrackPointRow = {
  id?: string;
  trip_id?: string;
  user_id?: string;
  device_time: string;
  lat: number;
  lon: number;
  accuracy_m: number | null;
  bearing_deg: number | null;
  speed_kmh: number | null;
  power_kw: number | null;
  soc: number | null;
};

export type BydmateRouteLabelRow = {
  user_id: string;
  vehicle_id: string;
  route_id: string;
  name: string | null;
  is_park: boolean;
  created_at: string;
  updated_at: string;
};
