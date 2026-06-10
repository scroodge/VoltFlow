import type { BydmateDiplus, BydmateTelemetry } from "@/types/database";

export const TELEMETRY_CHARGE_POWER_THRESHOLD_KW = 0.1;
/** BYD Mate / Di+: gun connected (AC or DC), not unplugged (1). */
export const CHARGING_GUN_STATES = new Set([2, 3, 4, 5]);
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

export type TelemetryChargingDiplusContext = {
  diplus?: Pick<BydmateDiplus, "charge_gun_state"> | null;
  diplus_charge_gun_state?: string | number | null;
};

export function readChargeGunState(context?: TelemetryChargingDiplusContext | null) {
  if (!context) return null;
  const fromDiplus = context.diplus?.charge_gun_state;
  if (fromDiplus != null) return fromDiplus;
  return context.diplus_charge_gun_state ?? null;
}

export function chargeGunStateIndicatesCharging(gun: unknown) {
  const gunState = finiteTelemetryNumber(gun);
  return gunState != null && CHARGING_GUN_STATES.has(gunState);
}

export function telemetryChargingContext(
  source: TelemetryChargingDiplusContext | null | undefined,
): TelemetryChargingDiplusContext | undefined {
  if (!source) return undefined;
  return {
    diplus: source.diplus,
    diplus_charge_gun_state: source.diplus_charge_gun_state,
  };
}

/**
 * Active charging or gun plugged in. Ignores Mate `is_charging` when gun is explicitly unplugged (1).
 * Aligns with BYD Mate TelemetrySnapshot gun-state logic.
 */
export function isTelemetryCharging(
  telemetry: Pick<BydmateTelemetry, "is_charging" | "charge_power_kw">,
  context?: TelemetryChargingDiplusContext | null,
) {
  const chargePowerKw = finiteTelemetryNumber(telemetry.charge_power_kw);
  if (chargePowerKw != null && chargePowerKw > TELEMETRY_CHARGE_POWER_THRESHOLD_KW) {
    return true;
  }

  const gun = readChargeGunState(context);
  if (gun != null) {
    return chargeGunStateIndicatesCharging(gun);
  }

  return false;
}

/** Parked or unknown speed — not driving away. */
export function isVehicleParkedForCharging(speedKmh: number | null | undefined) {
  return speedKmh == null || speedKmh <= AUTO_CHARGING_DRIVE_STOP_SPEED_KMH;
}

/**
 * Mate ingest auto session start/stop only.
 * Uses charge_power_kw (never traction power_kw). Requires vehicle parked.
 * Excludes 100% SOC balance tail (is_charging + ~0 kW).
 */
export function isMateAutoSessionCharging(
  telemetry: Pick<BydmateTelemetry, "is_charging" | "charge_power_kw" | "soc">,
  speedKmh: number | null | undefined,
) {
  if (!isVehicleParkedForCharging(speedKmh)) return false;

  const chargePowerKw = finiteTelemetryNumber(telemetry.charge_power_kw);
  if (chargePowerKw != null && chargePowerKw > TELEMETRY_CHARGE_POWER_THRESHOLD_KW) {
    return true;
  }

  if (telemetry.is_charging !== true) return false;
  const soc = finiteTelemetryNumber(telemetry.soc);
  if (soc != null && soc >= 100) return false;
  return chargePowerKw != null && chargePowerKw > TELEMETRY_CHARGE_POWER_THRESHOLD_KW;
}

/** @deprecated Use isMateAutoSessionCharging — kept so call sites can migrate. */
export function isAcWallboxCharging(
  telemetry: Pick<BydmateTelemetry, "is_charging" | "charge_power_kw" | "soc" | "power_kw">,
  speedKmh?: number | null,
) {
  return isMateAutoSessionCharging(telemetry, speedKmh ?? null);
}

export function telemetrySpeedKmh(telemetry: Pick<BydmateTelemetry, "speed_kmh">) {
  const speed = finiteTelemetryNumber(telemetry.speed_kmh);
  return speed != null && speed >= 0 ? speed : null;
}
