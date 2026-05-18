export type SessionStatus = "idle" | "charging" | "completed" | "stopped";

export type Profile = {
  id: string;
  email: string | null;
  preferred_currency: "EUR" | "USD" | "BYN" | "RUB";
  preferred_locale: "en" | "be" | "ru";
  default_price_per_kwh: number;
  bydmate_cloud_api_key: string | null;
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
  price_per_kwh: number;
  charged_energy_kwh: number;
  estimated_cost: number;
  status: SessionStatus;
  started_at: string | null;
  stopped_at: string | null;
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
  location: BydmateLocation;
  raw_payload: unknown;
  updated_at: string;
};

export type BydmateTelemetryPointRow = Omit<BydmateLiveSnapshotRow, "updated_at"> & {
  id: string;
};
