import type { Car, ChargingSessionRow, VoltflowMateTripRow } from "@/types/database";

/**
 * Static, hardcoded sample content shown to explorer-mode users (0 cars linked) so
 * History/Dashboard don't read as "the app is just empty." Never written to Postgres,
 * never fetched from an API, never persisted to localStorage -- pure UI-layer sample
 * content, same category as placeholder copy. See BACKLOG.md "Watermarked demo data".
 *
 * Dates are relative to render time so the preview always looks current.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const DEMO_CAR_ID = "demo-car";

export const DEMO_CAR: Car = {
  id: DEMO_CAR_ID,
  user_id: "demo",
  name: "Demo EV",
  model_generation: "gen1_2024",
  battery_chemistry: null,
  battery_capacity_kwh: 71.7,
  default_charger_power_kw: 6.6,
  default_efficiency_percent: 98,
  fast_dc_efficiency_percent: 90,
  created_at: new Date(Date.now() - 30 * DAY_MS).toISOString(),
};

export function demoChargingSessions(now = Date.now()): ChargingSessionRow[] {
  return [
    {
      id: "demo-session-1",
      user_id: "demo",
      car_id: DEMO_CAR_ID,
      start_percent: 65,
      current_percent: 92,
      target_percent: 90,
      battery_capacity_kwh: DEMO_CAR.battery_capacity_kwh,
      charger_power_kw: 6.6,
      efficiency_percent: 98,
      tariff_type: "home",
      provider_type: "home",
      user_provider_id: null,
      tariff_manual: false,
      tariff_selected_at: null,
      price_per_kwh: 0.32,
      energy_overridden: false,
      energy_corrected_at: null,
      manual_entry: false,
      charged_energy_kwh: 12.4,
      estimated_cost: 3.97,
      status: "completed",
      started_at: new Date(now - 1 * DAY_MS - 3 * 3_600_000).toISOString(),
      stopped_at: new Date(now - 1 * DAY_MS).toISOString(),
      end_max_cell_delta_v: null,
      end_delta_soc: null,
      end_median_cell_delta_v: null,
      created_at: new Date(now - 1 * DAY_MS).toISOString(),
      updated_at: new Date(now - 1 * DAY_MS).toISOString(),
    },
    {
      id: "demo-session-2",
      user_id: "demo",
      car_id: DEMO_CAR_ID,
      start_percent: 20,
      current_percent: 80,
      target_percent: 80,
      battery_capacity_kwh: DEMO_CAR.battery_capacity_kwh,
      charger_power_kw: 60,
      efficiency_percent: 90,
      tariff_type: "fast_dc",
      provider_type: "malanka",
      user_provider_id: null,
      tariff_manual: false,
      tariff_selected_at: null,
      price_per_kwh: 0.9,
      energy_overridden: false,
      energy_corrected_at: null,
      manual_entry: false,
      charged_energy_kwh: 34.2,
      estimated_cost: 30.78,
      status: "completed",
      started_at: new Date(now - 3 * DAY_MS - 45 * 60_000).toISOString(),
      stopped_at: new Date(now - 3 * DAY_MS).toISOString(),
      end_max_cell_delta_v: null,
      end_delta_soc: null,
      end_median_cell_delta_v: null,
      created_at: new Date(now - 3 * DAY_MS).toISOString(),
      updated_at: new Date(now - 3 * DAY_MS).toISOString(),
    },
  ];
}

export function demoTrips(now = Date.now()): VoltflowMateTripRow[] {
  return [
    {
      id: "demo-trip-1",
      user_id: "demo",
      vehicle_id: DEMO_CAR_ID,
      started_at: new Date(now - 1 * DAY_MS - 2 * 3_600_000).toISOString(),
      ended_at: new Date(now - 1 * DAY_MS - 1.5 * 3_600_000).toISOString(),
      last_device_time: new Date(now - 1 * DAY_MS - 1.5 * 3_600_000).toISOString(),
      sample_count: 120,
      track_point_count: 120,
      distance_km: 18.4,
      soc_start: 92,
      soc_end: 86,
      max_speed_kmh: 98,
      avg_speed_kmh: 42,
      avg_consumption_kwh_100km: 16.2,
      source: "telemetry",
    },
    {
      id: "demo-trip-2",
      user_id: "demo",
      vehicle_id: DEMO_CAR_ID,
      started_at: new Date(now - 2 * DAY_MS).toISOString(),
      ended_at: new Date(now - 2 * DAY_MS + 3_600_000).toISOString(),
      last_device_time: new Date(now - 2 * DAY_MS + 3_600_000).toISOString(),
      sample_count: 340,
      track_point_count: 340,
      distance_km: 64.7,
      soc_start: 78,
      soc_end: 52,
      max_speed_kmh: 118,
      avg_speed_kmh: 71,
      avg_consumption_kwh_100km: 17.8,
      source: "telemetry",
    },
  ];
}
