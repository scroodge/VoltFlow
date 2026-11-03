import type { VoltflowMateTelemetry } from "../../types/database.ts";

/**
 * Distilled per-trip / per-session series (`bydmate_trip_series`,
 * `bydmate_charging_session_series`, migration 20261103210000). Columnar: `t` holds epoch ms and
 * every other key an array of the same length. They replace raw samples once those are purged.
 */
export type DistilledTelemetrySeries = Record<string, unknown[] | undefined>;

export type DistilledSeriesRow = {
  source_sample_count: number;
  point_count: number;
  series: DistilledTelemetrySeries | null;
};

export type DistilledSeriesPoint = {
  device_time: string;
  telemetry: VoltflowMateTelemetry;
  diplus_charge_gun_state: string | number | null;
  diplus_min_cell_voltage_v: number | null;
  diplus_max_cell_voltage_v: number | null;
  diplus_cell_delta_v: number | null;
};

const TELEMETRY_NUMBER_KEYS = [
  "soc",
  "power_kw",
  "charge_power_kw",
  "speed_kmh",
  "odometer_km",
  "current_trip_distance_km",
  "battery_temp_c",
  "outside_temp_c",
  "cabin_temp_c",
  "charge_current_a",
  "battery_voltage_v",
] as const;

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function seriesToTelemetryPoints(
  series: DistilledTelemetrySeries | null | undefined,
) {
  const times = series?.t;
  if (!series || !Array.isArray(times)) return [];

  const points: DistilledSeriesPoint[] = [];
  times.forEach((ms, index) => {
    if (typeof ms !== "number" || !Number.isFinite(ms)) return;
    const at = (key: string) => series[key]?.[index];

    const telemetry: VoltflowMateTelemetry = {};
    for (const key of TELEMETRY_NUMBER_KEYS) {
      const value = numberOrNull(at(key));
      if (value != null) telemetry[key] = value;
    }
    const isCharging = at("is_charging");
    if (typeof isCharging === "boolean") telemetry.is_charging = isCharging;
    const chargeType = at("charge_type");
    if (typeof chargeType === "string") telemetry.charge_type = chargeType;

    const gunState = at("diplus_charge_gun_state");
    points.push({
      device_time: new Date(ms).toISOString(),
      telemetry,
      diplus_charge_gun_state:
        typeof gunState === "string" || typeof gunState === "number"
          ? gunState
          : null,
      diplus_min_cell_voltage_v: numberOrNull(at("diplus_min_cell_voltage_v")),
      diplus_max_cell_voltage_v: numberOrNull(at("diplus_max_cell_voltage_v")),
      diplus_cell_delta_v: numberOrNull(at("diplus_cell_delta_v")),
    });
  });
  return points;
}

/**
 * Raw samples win while they are complete; once the purge has removed some or all of them, the
 * distilled series (built from the full set) is the better copy.
 */
export function shouldUseDistilledSeries(
  rawCount: number,
  row: DistilledSeriesRow | null | undefined,
) {
  if (!row || row.point_count <= 0) return false;
  return rawCount < row.source_sample_count;
}
