import type { TranslationKey } from "@/lib/i18n";
import type { ChargingSessionRow, VoltflowMateLiveSnapshotRow, VoltflowMateTripRow } from "@/types/database";
import {
  environmentConsumptionFactor,
  estimateConsumptionKwh100Km,
  estimateRangeFromSoc,
  estimateVehicleRangeKm,
  resolveUsableBatteryKwh,
  type RangeEstimate,
} from "./range-estimate.ts";
import {
  resolveKmPerPercentSoc,
  selectTripsWithinDistanceWindow,
  sumDistanceSinceCharge,
  tripDistanceKm,
} from "./hero-drive-metrics.ts";
import { weightedAvgConsumptionKwh100 } from "./trip-metrics.ts";

export type ExplainRowKind = "input" | "derived" | "result";
export type ExplainRow = {
  labelKey: TranslationKey;
  value: number | null;
  unit?: string;
  digits?: number;
  kind: ExplainRowKind;
  noteKey?: TranslationKey;
};
export type MetricExplanation = {
  metricKey: "aiRange" | "mathRange" | "kmPerPercent" | "sinceCharge" | "recentEnergy";
  titleKey: TranslationKey;
  formulaKey: TranslationKey;
  rows: ExplainRow[];
  sourceAt?: string | null;
};

const finite = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const row = (labelKey: TranslationKey, value: number | null, unit: string, kind: ExplainRowKind, digits = 1, noteKey?: TranslationKey): ExplainRow =>
  ({ labelKey, value, unit, kind, digits, noteKey });

export function explainAiRange({ snapshot, recentTrips, batteryCapacityKwh, estimate }: {
  snapshot: VoltflowMateLiveSnapshotRow;
  recentTrips: VoltflowMateTripRow[];
  batteryCapacityKwh: number | null;
  estimate?: RangeEstimate;
}): MetricExplanation {
  const soc = finite(snapshot.telemetry.soc);
  const soh = finite(snapshot.telemetry.soh_percent);
  const usableBattery = resolveUsableBatteryKwh(batteryCapacityKwh, soh);
  const consumption = estimateConsumptionKwh100Km(snapshot, recentTrips, { batteryCapacityKwh });
  const calculated = estimateVehicleRangeKm(snapshot, recentTrips, { batteryCapacityKwh });
  const result = estimate?.estimatedRangeKm ?? calculated.estimatedRangeKm;
  return {
    metricKey: "aiRange", titleKey: "vehicle.explain.metrics.aiRange.title", formulaKey: "vehicle.explain.metrics.aiRange.formula",
    sourceAt: snapshot.received_at,
    rows: [
      row("vehicle.explain.rows.batteryCapacity", finite(batteryCapacityKwh), "kWh", "input", 1, batteryCapacityKwh == null ? "vehicle.explain.notes.defaultCapacity" : undefined),
      row("vehicle.explain.rows.soh", soh, "%", "input"),
      row("vehicle.explain.rows.soc", soc, "%", "input"),
      row("vehicle.explain.rows.usableBattery", usableBattery, "kWh", "derived"),
      row("vehicle.explain.rows.usableEnergy", usableBattery != null && soc != null ? usableBattery * Math.min(100, Math.max(0, soc)) / 100 : null, "kWh", "derived"),
      row("vehicle.explain.rows.environmentFactor", environmentConsumptionFactor(snapshot), "×", "derived", 2),
      row("vehicle.explain.rows.consumption", consumption, "kWh/100km", "derived"),
      row("vehicle.explain.rows.result", result, "km", "result", 0),
    ],
  };
}

function windowTotals(trips: VoltflowMateTripRow[], liveSoc: number | null | undefined, liveDistanceKm: number | null | undefined) {
  const selected = selectTripsWithinDistanceWindow(trips, liveDistanceKm);
  let distance = 0;
  let socDelta = 0;
  let hasSoc = false;
  selected.forEach((trip, index) => {
    const d = tripDistanceKm(trip, index === 0 && !trip.ended_at ? liveDistanceKm : null);
    const start = finite(trip.soc_start);
    const end = !trip.ended_at && index === 0 ? finite(liveSoc) ?? finite(trip.soc_end) : finite(trip.soc_end);
    if (d != null && d >= 0 && start != null && end != null && start > end) {
      distance += d; socDelta += start - end; hasSoc = true;
    }
  });
  return { distance: distance || null, socDelta: hasSoc ? socDelta : null };
}

export function explainMathRange({ soc, kmPerPercentSoc, trips, batteryCapacityKwh, sourceAt }: {
  soc: number | null | undefined; kmPerPercentSoc: number | null; trips: VoltflowMateTripRow[];
  batteryCapacityKwh: number | null; sourceAt?: string | null;
}): MetricExplanation {
  const validSoc = finite(soc);
  // Calling the canonical SOC estimator documents the fallback basis without replacing
  // the measured km/% result used by the tile.
  const fallback = estimateRangeFromSoc({ soc, batteryCapacityKwh, recentTrips: trips });
  const result = validSoc != null && kmPerPercentSoc != null ? validSoc * kmPerPercentSoc : null;
  return { metricKey: "mathRange", titleKey: "vehicle.explain.metrics.mathRange.title", formulaKey: "vehicle.explain.metrics.mathRange.formula", sourceAt,
    rows: [row("vehicle.explain.rows.soc", validSoc, "%", "input"), row("vehicle.explain.rows.kmPerPercent", kmPerPercentSoc, "km/%", "input"), row("vehicle.explain.rows.fallbackConsumption", fallback.consumptionKwh100Km, "kWh/100km", "derived"), row("vehicle.explain.rows.result", result, "km", "result", 0)] };
}

export function explainKmPerPercent({ trips, liveSoc, liveDistanceKm, batteryCapacityKwh, consumptionKwh100, sourceAt }: {
  trips: VoltflowMateTripRow[]; liveSoc: number | null | undefined; liveDistanceKm: number | null | undefined;
  batteryCapacityKwh: number | null; consumptionKwh100: number | null | undefined; sourceAt?: string | null;
}): MetricExplanation {
  const result = resolveKmPerPercentSoc({ trips, liveSoc, liveDistanceKm, batteryCapacityKwh, consumptionKwh100 });
  const totals = windowTotals(trips, liveSoc, liveDistanceKm);
  return { metricKey: "kmPerPercent", titleKey: "vehicle.explain.metrics.kmPerPercent.title", formulaKey: "vehicle.explain.metrics.kmPerPercent.formula", sourceAt,
    rows: [row("vehicle.explain.rows.tripWindowDistance", totals.distance, "km", "input"), row("vehicle.explain.rows.socDelta", totals.socDelta, "%", "input"), row("vehicle.explain.rows.batteryCapacity", finite(batteryCapacityKwh), "kWh", "input"), row("vehicle.explain.rows.consumption", finite(consumptionKwh100), "kWh/100km", "input"), row("vehicle.explain.rows.result", result, "km/%", "result") ] };
}

export function explainDistanceSinceCharge({ trips, anchorStoppedAt, liveDistanceKm, lastSession, sourceAt }: {
  trips: VoltflowMateTripRow[]; anchorStoppedAt: string | null; liveDistanceKm: number | null | undefined;
  lastSession?: ChargingSessionRow | null; sourceAt?: string | null;
}): MetricExplanation {
  const result = sumDistanceSinceCharge(trips, anchorStoppedAt, liveDistanceKm);
  const anchorMs = anchorStoppedAt ? Date.parse(anchorStoppedAt) : NaN;
  return { metricKey: "sinceCharge", titleKey: "vehicle.explain.metrics.sinceCharge.title", formulaKey: "vehicle.explain.metrics.sinceCharge.formula", sourceAt,
    rows: [row("vehicle.explain.rows.lastChargeEnded", Number.isFinite(anchorMs) ? anchorMs : null, "date", "input", 0, !lastSession ? "vehicle.explain.notes.noCharge" : undefined), row("vehicle.explain.rows.liveTripDistance", finite(liveDistanceKm), "km", "input"), row("vehicle.explain.rows.result", result, "km", "result") ] };
}

export function explainRecentEnergy({ trips, avgConsumptionKwh100, sourceAt }: {
  trips: VoltflowMateTripRow[]; avgConsumptionKwh100?: number | null; sourceAt?: string | null;
}): MetricExplanation {
  const consumption = avgConsumptionKwh100 ?? weightedAvgConsumptionKwh100(trips);
  const distance = trips.reduce((sum, trip) => sum + Math.max(0, finite(trip.distance_km) ?? 0), 0);
  const result = consumption != null ? consumption / 2 : null;
  return { metricKey: "recentEnergy", titleKey: "vehicle.explain.metrics.recentEnergy.title", formulaKey: "vehicle.explain.metrics.recentEnergy.formula", sourceAt,
    rows: [row("vehicle.explain.rows.tripWindowDistance", distance || null, "km", "input"), row("vehicle.explain.rows.consumption", consumption, "kWh/100km", "input"), row("vehicle.explain.rows.result", result, "kWh", "result") ] };
}
