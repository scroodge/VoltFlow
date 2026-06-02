import type { BydmateTelemetry } from "@/types/database";

export const TELEMETRY_CHARGE_POWER_THRESHOLD_KW = 0.1;
export const AUTO_CHARGING_MIN_CONSECUTIVE_SAMPLES = 2;
export const AUTO_CHARGING_DRIVE_STOP_SPEED_KMH = 5;

export function finiteTelemetryNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function isTelemetryCharging(telemetry: Pick<BydmateTelemetry, "is_charging" | "charge_power_kw">) {
  if (telemetry.is_charging === true) return true;
  const chargePowerKw = finiteTelemetryNumber(telemetry.charge_power_kw);
  return chargePowerKw != null && chargePowerKw > TELEMETRY_CHARGE_POWER_THRESHOLD_KW;
}

export function telemetrySpeedKmh(telemetry: Pick<BydmateTelemetry, "speed_kmh">) {
  const speed = finiteTelemetryNumber(telemetry.speed_kmh);
  return speed != null && speed >= 0 ? speed : null;
}
