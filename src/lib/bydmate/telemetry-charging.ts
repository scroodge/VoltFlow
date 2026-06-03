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

/** AC wallbox charging for auto session start/stop — excludes 100% SOC balance tail (is_charging + 0 kW). */
export function isAcWallboxCharging(
  telemetry: Pick<BydmateTelemetry, "is_charging" | "charge_power_kw" | "soc" | "power_kw">,
) {
  const chargePowerKw =
    finiteTelemetryNumber(telemetry.charge_power_kw) ?? finiteTelemetryNumber(telemetry.power_kw);
  if (chargePowerKw != null && chargePowerKw > TELEMETRY_CHARGE_POWER_THRESHOLD_KW) {
    return true;
  }
  if (telemetry.is_charging !== true) return false;
  const soc = finiteTelemetryNumber(telemetry.soc);
  if (soc != null && soc >= 100) return false;
  return chargePowerKw != null && chargePowerKw > TELEMETRY_CHARGE_POWER_THRESHOLD_KW;
}

export function telemetrySpeedKmh(telemetry: Pick<BydmateTelemetry, "speed_kmh">) {
  const speed = finiteTelemetryNumber(telemetry.speed_kmh);
  return speed != null && speed >= 0 ? speed : null;
}
