/**
 * Derivation for hand-entered charging sessions.
 *
 * The form collects only what a provider receipt shows — billed kWh, total paid, and the
 * start/end times. But `charging_sessions` requires SOC and charger power as NOT NULL with
 * `check (start_percent < target_percent)` (migration 20250511000000_init.sql), so those
 * fields have to be reconstructed here.
 *
 * Direction of the math is the inverse of a normal session: instead of SOC delta → energy,
 * we go billed (grid-side) energy → battery-side energy → SOC delta. That inversion is why
 * a manual row must never become a `charging_efficiency_observations` record — the SOC it
 * reports was computed *from* the billed kWh using the configured efficiency, so feeding it
 * back as a measurement would just re-derive the constant we started with.
 *
 * See docs/CHARGING_SESSIONS.md → "Manual entry for missed sessions".
 */

// Value imports stay relative with an explicit .ts extension so the bare Node test runner
// (--experimental-strip-types, no path-alias loader) can resolve them; only `import type`
// may use the "@/" alias, since types are stripped before resolution.
import { resolveTariffTypeByPower } from "../../../lib/charging-tariffs.ts";
import { efficiencyPercentForTariff } from "../../../lib/charging-efficiency.ts";
import type { ChargingProviderType, ChargingTariffType } from "@/types/database";

/** Hard cap matching the `chargerPowerKw` bound used by the start-session schema. */
const MAX_CHARGER_POWER_KW = 350;
/** Below this the derived power is meaningless — treat the entry as invalid. */
const MIN_CHARGER_POWER_KW = 0.01;
/** A single session longer than this is almost certainly a typo in the times. */
export const MAX_MANUAL_SESSION_HOURS = 24;
/** Smallest SOC delta that still satisfies `start_percent < target_percent`. */
const MIN_SOC_DELTA = 1;

export type ManualSessionCar = {
  battery_capacity_kwh: number;
  default_efficiency_percent: number;
  fast_dc_efficiency_percent?: number | null;
};

export type ManualSessionInput = {
  billedKwh: number;
  totalCost: number;
  startedAtMs: number;
  stoppedAtMs: number;
  car: ManualSessionCar;
  /**
   * SOC (%) measured by telemetry near `startedAtMs`, when the pipeline recorded samples
   * but never opened a session. `null` when nothing was in range.
   */
  anchorSoc?: number | null;
};

export type ManualSessionDerived = {
  startPercent: number;
  currentPercent: number;
  targetPercent: number;
  chargerPowerKw: number;
  efficiencyPercent: number;
  tariffType: ChargingTariffType;
  providerType: ChargingProviderType;
  pricePerKwh: number;
  chargedEnergyKwh: number;
  estimatedCost: number;
  /**
   * False when no telemetry SOC anchored the range, meaning `startPercent`/`targetPercent`
   * describe only the *size* of the gain, not where it sat on the battery. The UI must show
   * "—" rather than presenting these as measured values.
   */
  socAnchored: boolean;
};

export type ManualSessionDerivation =
  | { ok: true; derived: ManualSessionDerived }
  | { ok: false; reason: ManualSessionError };

export type ManualSessionError =
  | "invalid_times"
  | "duration_too_long"
  | "invalid_energy"
  | "invalid_cost"
  | "invalid_car"
  | "implausible_power";

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * Rebuild the NOT NULL session columns from receipt figures.
 *
 * Returns a discriminated result rather than throwing so the server action and the client
 * preview can share one code path — the dialog calls this on every keystroke to render the
 * derived power/price/SOC line, and shows nothing when the entry is not yet valid.
 */
export function deriveManualSessionFields(
  input: ManualSessionInput,
): ManualSessionDerivation {
  const { billedKwh, totalCost, startedAtMs, stoppedAtMs, car } = input;

  if (
    !Number.isFinite(startedAtMs) ||
    !Number.isFinite(stoppedAtMs) ||
    stoppedAtMs <= startedAtMs
  ) {
    return { ok: false, reason: "invalid_times" };
  }
  const durationHours = (stoppedAtMs - startedAtMs) / 3_600_000;
  if (durationHours > MAX_MANUAL_SESSION_HOURS) {
    return { ok: false, reason: "duration_too_long" };
  }
  if (!isPositiveFinite(billedKwh)) {
    return { ok: false, reason: "invalid_energy" };
  }
  if (!Number.isFinite(totalCost) || totalCost < 0) {
    return { ok: false, reason: "invalid_cost" };
  }
  if (!isPositiveFinite(car.battery_capacity_kwh)) {
    return { ok: false, reason: "invalid_car" };
  }

  const rawPowerKw = billedKwh / durationHours;
  if (rawPowerKw < MIN_CHARGER_POWER_KW) {
    return { ok: false, reason: "implausible_power" };
  }
  const chargerPowerKw = Math.min(rawPowerKw, MAX_CHARGER_POWER_KW);

  // Power decides the tariff band (and therefore the efficiency) exactly as it does for a
  // GPS-less auto session — see resolveSessionTariff. Provider stays "custom" because the
  // user gave us a price, not a provider.
  const tariffType = resolveTariffTypeByPower(chargerPowerKw);
  const efficiencyPercent = efficiencyPercentForTariff(car, tariffType);

  // Grid-side (metered, what the receipt says) → battery-side (what the SOC actually gained).
  const batterySideKwh = (billedKwh * efficiencyPercent) / 100;
  const rawSocDelta = (batterySideKwh / car.battery_capacity_kwh) * 100;
  const socDelta = Math.min(100, Math.max(MIN_SOC_DELTA, rawSocDelta));

  const anchor = input.anchorSoc;
  const socAnchored =
    typeof anchor === "number" && Number.isFinite(anchor) && anchor >= 0 && anchor <= 100;

  let startPercent = socAnchored ? (anchor as number) : 0;
  let targetPercent = Math.min(100, startPercent + socDelta);
  // A gain that runs past 100% means the anchor was stale or the receipt covers more than
  // this pack could hold. Keep the delta honest and slide the window down instead of
  // silently shrinking it.
  if (targetPercent - startPercent < socDelta) {
    startPercent = Math.max(0, 100 - socDelta);
    targetPercent = Math.min(100, startPercent + socDelta);
  }
  // Satisfy `charging_sessions_percent_order` even after clamping.
  if (startPercent >= targetPercent) {
    startPercent = Math.max(0, targetPercent - MIN_SOC_DELTA);
  }

  return {
    ok: true,
    derived: {
      startPercent,
      currentPercent: targetPercent,
      targetPercent,
      chargerPowerKw,
      efficiencyPercent,
      tariffType,
      providerType: "custom",
      pricePerKwh: totalCost / billedKwh,
      chargedEnergyKwh: billedKwh,
      estimatedCost: totalCost,
      socAnchored,
    },
  };
}

export type ManualSessionWindow = {
  started_at: string | null;
  stopped_at: string | null;
};

/**
 * True when a candidate window overlaps an existing session for the same car.
 *
 * Without this, entering a charge that was actually recorded double-counts it in the day
 * summary and every monthly total. Touching endpoints (one ends exactly when the next
 * begins) are not an overlap.
 */
export function manualSessionOverlaps(
  existing: ManualSessionWindow,
  candidate: { startedAtMs: number; stoppedAtMs: number },
): boolean {
  if (!existing.started_at) return false;
  const existingStart = Date.parse(existing.started_at);
  if (!Number.isFinite(existingStart)) return false;

  // An open session (no stop time) blocks anything at or after its start.
  const existingStop = existing.stopped_at ? Date.parse(existing.stopped_at) : NaN;
  const effectiveStop = Number.isFinite(existingStop) ? existingStop : Number.POSITIVE_INFINITY;

  return candidate.startedAtMs < effectiveStop && existingStart < candidate.stoppedAtMs;
}
