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
  context?: TelemetryChargingDiplusContext | null,
) {
  if (!isVehicleParkedForCharging(speedKmh)) return false;

  const chargePowerKw = finiteTelemetryNumber(telemetry.charge_power_kw);
  if (chargePowerKw != null && chargePowerKw > TELEMETRY_CHARGE_POWER_THRESHOLD_KW) {
    return true;
  }

  // `is_charging` can remain true after unplug. A known Di+ gun state of 1 is
  // authoritative for that stale-flag case; do not create/keep an auto session.
  if (finiteTelemetryNumber(readChargeGunState(context)) === 1) return false;

  if (telemetry.is_charging !== true) return false;
  const soc = finiteTelemetryNumber(telemetry.soc);
  if (soc != null && soc >= 100) return false;
  return true;
}

/** @deprecated Use isMateAutoSessionCharging — kept so call sites can migrate. */
export function isAcWallboxCharging(
  telemetry: Pick<BydmateTelemetry, "is_charging" | "charge_power_kw" | "soc" | "power_kw">,
  speedKmh?: number | null,
) {
  return isMateAutoSessionCharging(telemetry, speedKmh ?? null);
}

/** Plausible AC wallbox ceiling; di+ charge_power_kw spikes above this are glitches, not real. */
export const MAX_PLAUSIBLE_AC_CHARGER_KW = 22;
/** DC fast-charge ceiling. */
export const MAX_PLAUSIBLE_DC_CHARGER_KW = 350;
const FALLBACK_AC_CHARGER_KW = 7.2;
const FALLBACK_DC_CHARGER_KW = 50;

/**
 * di+ `charge_power_kw` is noisy — observed spikes of 22–64 kW on a 4 kW AC charger (car
 * `way`). The auto-session captures one sample as the session's fixed charger power, which
 * then drives wall-clock math; a single spike makes the rate ~15× too fast and the SOC
 * overshoots instantly. Reject implausible readings (cap by gun type) and fall back to the
 * car default. `chargeType` comes from `telemetry.charge_type` ("AC"|"DC"); unknown is
 * treated as AC (the conservative, lower cap).
 */
export function sanitizeChargerPowerKw(
  rawKw: number | null | undefined,
  chargeType: string | null | undefined,
  defaultKw: number | null | undefined,
): number {
  const isDc = chargeType === "DC";
  const cap = isDc ? MAX_PLAUSIBLE_DC_CHARGER_KW : MAX_PLAUSIBLE_AC_CHARGER_KW;
  const raw = finiteTelemetryNumber(rawKw);
  if (raw != null && raw > 0 && raw <= cap) return raw;
  const def = finiteTelemetryNumber(defaultKw);
  if (def != null && def > 0 && def <= cap) return def;
  return isDc ? FALLBACK_DC_CHARGER_KW : FALLBACK_AC_CHARGER_KW;
}

export function telemetrySpeedKmh(telemetry: Pick<BydmateTelemetry, "speed_kmh">) {
  const speed = finiteTelemetryNumber(telemetry.speed_kmh);
  return speed != null && speed >= 0 ? speed : null;
}
