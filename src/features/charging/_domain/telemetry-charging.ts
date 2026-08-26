import type { VoltflowMateDiplus, VoltflowMateTelemetry } from "@/types/database";

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
  diplus?: Pick<VoltflowMateDiplus, "charge_gun_state"> | null;
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
 * Active charging or gun plugged in. Ignores Mate `is_charging` when gun is explicitly
 * unplugged (1) and there's no real charge power. Aligns with BYD Mate TelemetrySnapshot
 * gun-state logic.
 */
export function isTelemetryCharging(
  telemetry: Pick<VoltflowMateTelemetry, "is_charging" | "charge_power_kw">,
  context?: TelemetryChargingDiplusContext | null,
) {
  // Real charge power wins regardless of gun state: car `way`'s Di+ gun state reads 1
  // ("unplugged") for the *majority* of its genuine charging samples, so gun state alone
  // is not a reliable unplug signal for this vehicle. Check it only as a fallback, for
  // the case it was designed for — a stale `charge_power_kw`/`is_charging` reading left
  // over from a charge that has actually ended.
  const chargePowerKw = finiteTelemetryNumber(telemetry.charge_power_kw);
  if (chargePowerKw != null && chargePowerKw > TELEMETRY_CHARGE_POWER_THRESHOLD_KW) {
    return true;
  }

  if (finiteTelemetryNumber(readChargeGunState(context)) === 1) return false;

  const gun = readChargeGunState(context);
  if (gun != null) {
    return chargeGunStateIndicatesCharging(gun);
  }

  return false;
}

/**
 * Charging-session history only. Keeps the historical `is_charging` signal for
 * samples captured within an already-open session, but never treats traction
 * `power_kw` as charging. Real charge power wins over an explicit Di+ unplug state
 * (see `isTelemetryCharging`); the unplug state is only a fallback for stale readings.
 */
export function isTelemetryHistoryCharging(
  telemetry: Pick<VoltflowMateTelemetry, "is_charging" | "charge_power_kw">,
  context?: TelemetryChargingDiplusContext | null,
) {
  const chargePowerKw = finiteTelemetryNumber(telemetry.charge_power_kw);
  if (chargePowerKw != null && chargePowerKw > TELEMETRY_CHARGE_POWER_THRESHOLD_KW) {
    return true;
  }

  if (finiteTelemetryNumber(readChargeGunState(context)) === 1) return false;

  return telemetry.is_charging === true;
}

/** Parked or unknown speed — not driving away. */
export function isVehicleParkedForCharging(speedKmh: number | null | undefined) {
  return speedKmh == null || speedKmh <= AUTO_CHARGING_DRIVE_STOP_SPEED_KMH;
}

/**
 * Mate ingest auto session **start** only — the strict half of the pair.
 * Uses charge_power_kw (never traction power_kw). Requires vehicle parked.
 *
 * Requires *real charge power*: Di+ `is_charging` means "gun connected", not "energy
 * flowing", and it stays true indefinitely after a charger stops while the gun is left
 * plugged in. Accepting it alone opened phantom sessions in a loop (car `way`,
 * 2026-08-26: two 0 kWh sessions after a charge that had ended two hours earlier — see
 * CHANGELOG.md). The old `soc >= 100` balance-tail guard could not catch it either,
 * because SOC drifts *down* (100 → 99.9 → 99.8) from standby draw while parked.
 *
 * Not accepting `is_charging` at ~0 kW costs nothing on a genuine charge: across every
 * vehicle in production, samples with strictly-rising SOC report
 * `charge_power_kw > TELEMETRY_CHARGE_POWER_THRESHOLD_KW` 77–99% of the time, auto-start
 * needs a multi-sample streak anyway, and the session is backdated to the streak's first
 * charging sample (and to the last idle SOC within 30 min), so ramp-up energy is kept.
 *
 * Use `isMateAutoSessionChargingSustained` to decide whether an already-open session is
 * still charging — that one must tolerate momentary zero readings.
 */
export function isMateAutoSessionCharging(
  telemetry: Pick<VoltflowMateTelemetry, "is_charging" | "charge_power_kw" | "soc">,
  speedKmh: number | null | undefined,
  // Kept for call-site symmetry with isMateAutoSessionChargingSustained: both predicates
  // are called on the same sample. Gun state is deliberately not consulted here — real
  // measured power is the only thing that may start a session.
  _context?: TelemetryChargingDiplusContext | null,
) {
  if (!isVehicleParkedForCharging(speedKmh)) return false;

  // Real charge power regardless of gun state (see isTelemetryCharging: car `way`'s gun
  // state reads 1 for the majority of its genuine charging samples), so an unreliable gun
  // state can never suppress a real measured charge.
  const chargePowerKw = finiteTelemetryNumber(telemetry.charge_power_kw);
  return chargePowerKw != null && chargePowerKw > TELEMETRY_CHARGE_POWER_THRESHOLD_KW;
}

/**
 * Mate ingest auto session **keep-alive** only — the tolerant half of the pair.
 * Whether an already-open session should stay open on this sample.
 *
 * Deliberately looser than `isMateAutoSessionCharging`: a genuine charge reports the odd
 * zero/absent `charge_power_kw` mid-session, and ending a real session on two such blips
 * would be far worse than holding it open a few minutes too long. The "charger stopped
 * but the gun is still in" case is closed by the reducer's zero-power stall
 * (`AUTO_CHARGING_ZERO_POWER_STALL_MS`) instead, which needs a *sustained* run of zero.
 */
export function isMateAutoSessionChargingSustained(
  telemetry: Pick<VoltflowMateTelemetry, "is_charging" | "charge_power_kw" | "soc">,
  speedKmh: number | null | undefined,
  context?: TelemetryChargingDiplusContext | null,
) {
  if (!isVehicleParkedForCharging(speedKmh)) return false;

  const chargePowerKw = finiteTelemetryNumber(telemetry.charge_power_kw);
  if (chargePowerKw != null && chargePowerKw > TELEMETRY_CHARGE_POWER_THRESHOLD_KW) {
    return true;
  }

  if (finiteTelemetryNumber(readChargeGunState(context)) === 1) return false;

  return telemetry.is_charging === true;
}

/** @deprecated Use isMateAutoSessionCharging — kept so call sites can migrate. */
export function isAcWallboxCharging(
  telemetry: Pick<VoltflowMateTelemetry, "is_charging" | "charge_power_kw" | "soc" | "power_kw">,
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

  // The car's configured default is its AC charger power. Never use it for an
  // explicitly identified DC session when the initial instantaneous reading is
  // zero/invalid — that would misclassify the session as home AC and poison its
  // fixed fallback rate. Use the conservative DC fallback until live power arrives.
  if (isDc) {
    return raw != null && raw > 0 && raw <= cap ? raw : FALLBACK_DC_CHARGER_KW;
  }

  if (raw != null && raw > 0 && raw <= cap) return raw;
  const def = finiteTelemetryNumber(defaultKw);
  if (def != null && def > 0 && def <= cap) return def;
  return FALLBACK_AC_CHARGER_KW;
}

export function telemetrySpeedKmh(telemetry: Pick<VoltflowMateTelemetry, "speed_kmh">) {
  const speed = finiteTelemetryNumber(telemetry.speed_kmh);
  return speed != null && speed >= 0 ? speed : null;
}
