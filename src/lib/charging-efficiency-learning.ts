import type { ChargingTariffType } from "@/types/database";
import type { TelemetrySampleRow } from "@/lib/charging-session-reconcile-logic";

/**
 * Smart Charge "Loose Mode": turns provider-corrected sessions into a measured efficiency
 * per car + tariff group, then suggests updating the car's configured efficiency field.
 * Suggestion only — never auto-applied (see docs/CHARGING_SESSIONS.md).
 */

/** A billed correction outside this range is almost certainly a typo (decimal point,
 *  wrong unit) rather than a real efficiency reading — flagged as a warning, not blocked,
 *  since a genuinely unusual charge (e.g. heavy preconditioning load) can still be real. */
const PLAUSIBLE_EFFICIENCY_MIN_PERCENT = 50;
const PLAUSIBLE_EFFICIENCY_MAX_PERCENT = 105;

export function isPlausibleMeasuredEfficiency(percent: number): boolean {
  return (
    Number.isFinite(percent) &&
    percent >= PLAUSIBLE_EFFICIENCY_MIN_PERCENT &&
    percent <= PLAUSIBLE_EFFICIENCY_MAX_PERCENT
  );
}

/**
 * Inverts the session energy formula (charged_energy_kwh = batteryKwh / efficiency) to
 * recover the efficiency implied by a provider-billed kWh figure. Battery-side kWh comes
 * from the session's own SOC delta × battery capacity — the same "grid truth" anchor used
 * everywhere else in the app (see charging-efficiency.ts).
 */
export function measuredEfficiencyForSession({
  socDeltaPercent,
  batteryCapacityKwh,
  billedEnergyKwh,
}: {
  socDeltaPercent: number;
  batteryCapacityKwh: number;
  billedEnergyKwh: number;
}): number | null {
  if (!(socDeltaPercent > 0) || !(batteryCapacityKwh > 0) || !(billedEnergyKwh > 0)) return null;
  const batteryKwh = (socDeltaPercent / 100) * batteryCapacityKwh;
  return (batteryKwh / billedEnergyKwh) * 100;
}

export type TelemetryContextSummary = {
  avgBatteryTempC: number | null;
  avgOutsideTempC: number | null;
  avgChargePowerKw: number | null;
  sampleCount: number;
};

/**
 * Context snapshot for one session's telemetry window — averaged over charging samples
 * only (charge_power_kw > 0), since idle/driving samples before or after the plug-in
 * would dilute the reading. Stored alongside the measurement, not modeled yet (v1 is
 * evidence display only — see docs/CHARGING_SESSIONS.md "Provider corrections").
 */
export function summarizeTelemetryContext(samples: TelemetrySampleRow[]): TelemetryContextSummary {
  const batteryTemps: number[] = [];
  const outsideTemps: number[] = [];
  const chargePowers: number[] = [];

  for (const row of samples) {
    const chargePowerKw = finiteNumber(row.telemetry?.charge_power_kw);
    if (chargePowerKw == null || chargePowerKw <= 0) continue;
    chargePowers.push(chargePowerKw);
    const batteryTempC = finiteNumber(row.telemetry?.battery_temp_c);
    if (batteryTempC != null) batteryTemps.push(batteryTempC);
    const outsideTempC = finiteNumber(row.telemetry?.outside_temp_c);
    if (outsideTempC != null) outsideTemps.push(outsideTempC);
  }

  return {
    avgBatteryTempC: average(batteryTemps),
    avgOutsideTempC: average(outsideTemps),
    avgChargePowerKw: average(chargePowers),
    sampleCount: chargePowers.length,
  };
}

export type EfficiencyGroup = "ac" | "fast_dc";

/** AC and commercial-AC share one car field (default_efficiency_percent); fast DC has
 *  its own (fast_dc_efficiency_percent) — see Car type in src/types/database.ts. */
export function efficiencyGroupForTariffType(tariffType: ChargingTariffType): EfficiencyGroup {
  return tariffType === "fast_dc" ? "fast_dc" : "ac";
}

export function tariffTypesForEfficiencyGroup(group: EfficiencyGroup): ChargingTariffType[] {
  return group === "fast_dc" ? ["fast_dc"] : ["home", "commercial_ac"];
}

export type EfficiencyObservationInput = {
  measuredEfficiencyPercent: number;
  avgBatteryTempC: number | null;
  avgOutsideTempC: number | null;
  computedAt: string;
};

export type ChargingEfficiencySuggestion = {
  suggestedPercent: number;
  sampleCount: number;
  spread: number;
  avgBatteryTempC: number | null;
  avgOutsideTempC: number | null;
};

const SUGGESTION_WINDOW_SIZE = 10;
const MIN_OBSERVATIONS_FOR_SUGGESTION = 3;
/** Wide agreement across corrections is required before trusting the median enough to
 *  surface it — a car mixing very different conditions (e.g. one icy DC session dragged
 *  into an otherwise-warm window) should wait for more data rather than suggest early. */
const MAX_SPREAD_PERCENT = 5;
/** Below this, the suggestion would just be measurement noise around the current value. */
const MIN_DELTA_PERCENT = 1;

/**
 * Combines a car+tariff-group's observations into one suggested efficiency. Takes the
 * median of the most recent window (resists a single bad receipt) and only surfaces when
 * there's enough data, it agrees with itself, and it actually differs from what's
 * configured today. `observations` may be given in any order.
 */
export function suggestEfficiency(
  observations: EfficiencyObservationInput[],
  currentPercent: number,
): ChargingEfficiencySuggestion | null {
  if (observations.length < MIN_OBSERVATIONS_FOR_SUGGESTION) return null;

  const window = [...observations]
    .sort((a, b) => Date.parse(b.computedAt) - Date.parse(a.computedAt))
    .slice(0, SUGGESTION_WINDOW_SIZE);

  const sortedPercents = window.map((o) => o.measuredEfficiencyPercent).sort((a, b) => a - b);
  const spread = sortedPercents[sortedPercents.length - 1] - sortedPercents[0];
  if (spread > MAX_SPREAD_PERCENT) return null;

  const suggestedPercent = round1(median(sortedPercents));
  if (Math.abs(suggestedPercent - currentPercent) < MIN_DELTA_PERCENT) return null;

  return {
    suggestedPercent,
    sampleCount: window.length,
    spread: round1(spread),
    avgBatteryTempC: average(window.map((o) => o.avgBatteryTempC).filter(isNumber)),
    avgOutsideTempC: average(window.map((o) => o.avgOutsideTempC).filter(isNumber)),
  };
}

function isNumber(value: number | null): value is number {
  return value != null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function median(sortedValues: number[]): number {
  const mid = Math.floor(sortedValues.length / 2);
  return sortedValues.length % 2 !== 0
    ? sortedValues[mid]
    : (sortedValues[mid - 1] + sortedValues[mid]) / 2;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
