import type { BydmateLiveSnapshotRow } from "@/types/database";

/** Minimal seed when dev dashboard has no live Mate row yet. */
export function buildDevDashboardSeedSnapshot(): BydmateLiveSnapshotRow {
  const now = new Date().toISOString();
  return {
    id: "dev-dashboard-seed",
    vehicle_id: "dev-dashboard",
    user_id: "dev",
    source: "BYDMate",
    schema_version: 1,
    device_time: now,
    received_at: now,
    updated_at: now,
    telemetry: {},
    location: {},
    raw_payload: null,
  };
}

/** Fresh live snapshot for dev “driving” mode on the cockpit. */
export function buildDrivingSnapshot(base: BydmateLiveSnapshotRow): BydmateLiveSnapshotRow {
  const now = new Date().toISOString();
  return {
    ...base,
    device_time: now,
    received_at: now,
    updated_at: now,
    telemetry: {
      ...base.telemetry,
      speed_kmh: 38,
      power_kw: 17,
      is_charging: false,
      charge_power_kw: 0,
    },
  };
}

/** Parked, not charging — for optional dev QA. */
export function buildParkedSnapshot(base: BydmateLiveSnapshotRow): BydmateLiveSnapshotRow {
  const now = new Date().toISOString();
  return {
    ...base,
    device_time: now,
    received_at: now,
    updated_at: now,
    diplus_gear: "P",
    diplus_mileage_km: base.diplus_mileage_km ?? 24860,
    diplus_voltage_12v: 12.6,
    diplus_min_cell_voltage_v: 3.31,
    diplus_max_cell_voltage_v: 3.33,
    diplus_cell_delta_v: 0.02,
    telemetry: {
      ...base.telemetry,
      soc: 64,
      speed_kmh: 0,
      power_kw: 0,
      battery_temp_c: 24,
      cabin_temp_c: 21,
      outside_temp_c: 18,
      battery_voltage_v: 386,
      aux_voltage_v: 12.6,
      soh_percent: base.telemetry.soh_percent ?? 99,
      is_charging: false,
      charge_power_kw: 0,
      charge_type: null,
      kwh_charged: 0,
      range_est_km: 274,
      current_trip_distance_km: 0,
      current_trip_consumption_kwh_100km: null,
    },
    diplus: {
      ...base.diplus,
      soc: 64,
      speed_kmh: 0,
      power_kw: 0,
      gear: "P",
      charge_gun_state: 1,
      charging_status: 0,
      mileage_km: base.diplus?.mileage_km ?? base.diplus_mileage_km ?? 24860,
      voltage_12v: 12.6,
      max_cell_voltage_v: 3.33,
      min_cell_voltage_v: 3.31,
      cell_delta_v: 0.02,
      avg_battery_temp_c: 24,
      exterior_temp_c: 18,
      inside_temp_c: 21,
    },
  };
}
