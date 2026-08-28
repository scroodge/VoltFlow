import type { TranslationKey } from "@/lib/i18n";
import type { ChargingSessionRow, ChargingTariffType, VoltflowMateLiveSnapshotRow, VoltflowMateTripRow } from "@/types/database";
import {
  activeChargingTimeLeftSeconds,
  cappedPositivePowerKw,
  chargingSecondsToFull,
  costFromGridEnergy,
  energyFromGridKwh,
  energyNeededKwh,
  formatDuration,
} from "../../features/charging/_domain/charging-math.ts";
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
import { tripCost, tripEnergyPerKm, tripNetConsumptionKwh100, tripTractionEnergyKwh, weightedAvgConsumptionKwh100 } from "./trip-metrics.ts";

export type ExplainRowKind = "input" | "derived" | "result";
export type ExplainRow = {
  labelKey: TranslationKey;
  value: number | null;
  unit?: string;
  digits?: number;
  kind: ExplainRowKind;
  noteKey?: TranslationKey;
  displayValue?: string;
};
export type MetricExplanation = {
  metricKey: "aiRange" | "mathRange" | "kmPerPercent" | "sinceCharge" | "recentEnergy" | "parkChargeTime" | "parkChargeEnergy" | "parkChargeCost" | "activeChargeTime" | "activeChargeEnergy" | "activeChargeCost" | "tripTractionEnergy" | "tripEnergyPerKm" | "tripNetConsumption" | "tripCost";
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
  const consumption = estimateConsumptionKwh100Km(snapshot, recentTrips);
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

type ChargeEstimateInputs = {
  batteryCapacityKwh: number | null | undefined;
  fromPercent: number | null | undefined;
  efficiencyPercent: number | null | undefined;
};

function chargeGridEnergy(input: ChargeEstimateInputs, toPercent = 100) {
  const capacity = finite(input.batteryCapacityKwh);
  const from = finite(input.fromPercent);
  const efficiency = finite(input.efficiencyPercent);
  if (capacity == null || capacity <= 0 || from == null || efficiency == null || efficiency <= 0) return null;
  return energyFromGridKwh(energyNeededKwh(capacity, from, toPercent), efficiency);
}

export function explainParkChargeTime(input: ChargeEstimateInputs & {
  powerKw: number | null | undefined;
  tariffType: ChargingTariffType;
  sourceAt?: string | null;
}): MetricExplanation {
  const capacity = finite(input.batteryCapacityKwh);
  const soc = finite(input.fromPercent);
  const efficiency = finite(input.efficiencyPercent);
  const power = finite(input.powerKw);
  const result = capacity != null && capacity > 0 && soc != null && efficiency != null && efficiency > 0 && power != null && power > 0
    ? chargingSecondsToFull({ batteryCapacityKwh: capacity, currentPercent: soc, efficiencyPercent: efficiency, powerKw: power, tariffType: input.tariffType })
    : null;
  const rows = [
    row("vehicle.explain.rows.batteryCapacity", capacity, "kWh", "input"),
    row("vehicle.explain.rows.soc", soc, "%", "input"),
    row("dashboard.explain.rows.efficiency", efficiency, "%", "input"),
    row("dashboard.explain.rows.chargePower", power, "kW", "input"),
  ];
  if (input.tariffType === "fast_dc") {
    rows.push(
      row("dashboard.explain.rows.dcBand70", power, "kW", "derived"),
      row("dashboard.explain.rows.dcBand90", power == null ? null : cappedPositivePowerKw(power, 45), "kW", "derived"),
      row("dashboard.explain.rows.dcBand95", power == null ? null : cappedPositivePowerKw(power, 25), "kW", "derived"),
      row("dashboard.explain.rows.dcBand100", power == null ? null : cappedPositivePowerKw(power, 15), "kW", "derived"),
    );
  }
  const resultRow = row("vehicle.explain.rows.result", result, "s", "result", 0);
  resultRow.displayValue = result == null ? undefined : formatDuration(Math.round(result));
  rows.push(resultRow);
  return { metricKey: "parkChargeTime", titleKey: "dashboard.explain.metrics.parkChargeTime.title", formulaKey: "dashboard.explain.metrics.parkChargeTime.formula", sourceAt: input.sourceAt, rows };
}

export function explainParkChargeEnergy(input: ChargeEstimateInputs & { sourceAt?: string | null }): MetricExplanation {
  const result = chargeGridEnergy(input);
  return { metricKey: "parkChargeEnergy", titleKey: "dashboard.explain.metrics.parkChargeEnergy.title", formulaKey: "dashboard.explain.metrics.parkChargeEnergy.formula", sourceAt: input.sourceAt,
    rows: [row("vehicle.explain.rows.batteryCapacity", finite(input.batteryCapacityKwh), "kWh", "input"), row("vehicle.explain.rows.soc", finite(input.fromPercent), "%", "input"), row("dashboard.explain.rows.efficiency", finite(input.efficiencyPercent), "%", "input"), row("vehicle.explain.rows.result", result, "kWh", "result")], };
}

export function explainParkChargeCost(input: ChargeEstimateInputs & { pricePerKwh: number | null | undefined; currencyUnit?: string; sourceAt?: string | null }): MetricExplanation {
  const energy = chargeGridEnergy(input);
  const price = finite(input.pricePerKwh);
  const result = energy != null && price != null ? costFromGridEnergy(energy, price) : null;
  return { metricKey: "parkChargeCost", titleKey: "dashboard.explain.metrics.parkChargeCost.title", formulaKey: "dashboard.explain.metrics.parkChargeCost.formula", sourceAt: input.sourceAt,
    rows: [row("dashboard.explain.rows.gridEnergy", energy, "kWh", "derived"), row("dashboard.explain.rows.pricePerKwh", price, `${input.currencyUnit ?? ""}/kWh`, "input", 2), row("vehicle.explain.rows.result", result, input.currencyUnit ?? "", "result", 2)], };
}

export function explainActiveChargeTime(input: ChargeEstimateInputs & { powerKw: number | null | undefined; fallbackSeconds: number | null | undefined; sourceAt?: string | null }): MetricExplanation {
  const capacity = finite(input.batteryCapacityKwh); const soc = finite(input.fromPercent); const efficiency = finite(input.efficiencyPercent); const power = finite(input.powerKw); const fallback = finite(input.fallbackSeconds);
  const result = capacity != null && capacity > 0 && soc != null && efficiency != null && efficiency > 0 && fallback != null
    ? activeChargingTimeLeftSeconds({ batteryCapacityKwh: capacity, currentPercent: soc, efficiencyPercent: efficiency, powerKw: power != null && power > 0 ? power : null, fallbackSeconds: fallback }) : null;
  const resultRow = row("vehicle.explain.rows.result", result, "s", "result", 0); resultRow.displayValue = result == null ? undefined : formatDuration(Math.round(result));
  return { metricKey: "activeChargeTime", titleKey: "dashboard.explain.metrics.activeChargeTime.title", formulaKey: power != null && power > 0 ? "dashboard.explain.metrics.activeChargeTime.formula" : "dashboard.explain.metrics.activeChargeTime.fallbackFormula", sourceAt: input.sourceAt,
    rows: [row("dashboard.explain.rows.remainingGridEnergy", chargeGridEnergy(input), "kWh", "derived"), row("dashboard.explain.rows.chargePower", power, "kW", "input"), resultRow], };
}

export function explainActiveChargeEnergy(input: ChargeEstimateInputs & { currentPercent: number | null | undefined; sourceAt?: string | null }): MetricExplanation {
  const current = finite(input.currentPercent);
  const result = current == null ? null : chargeGridEnergy(input, current);
  return { metricKey: "activeChargeEnergy", titleKey: "dashboard.explain.metrics.activeChargeEnergy.title", formulaKey: "dashboard.explain.metrics.activeChargeEnergy.formula", sourceAt: input.sourceAt,
    rows: [row("vehicle.explain.rows.batteryCapacity", finite(input.batteryCapacityKwh), "kWh", "input"), row("dashboard.explain.rows.startSoc", finite(input.fromPercent), "%", "input"), row("vehicle.explain.rows.soc", current, "%", "input"), row("dashboard.explain.rows.efficiency", finite(input.efficiencyPercent), "%", "input"), row("vehicle.explain.rows.result", result, "kWh", "result", 2)], };
}

export function explainActiveChargeCost(input: ChargeEstimateInputs & { pricePerKwh: number | null | undefined; currencyUnit?: string; sourceAt?: string | null }): MetricExplanation {
  const energy = chargeGridEnergy(input);
  const price = finite(input.pricePerKwh);
  const result = energy != null && price != null && price > 0 ? costFromGridEnergy(energy, price) : null;
  return { metricKey: "activeChargeCost", titleKey: "dashboard.explain.metrics.activeChargeCost.title", formulaKey: "dashboard.explain.metrics.activeChargeCost.formula", sourceAt: input.sourceAt,
    rows: [row("dashboard.explain.rows.gridEnergy", energy, "kWh", "derived"), row("dashboard.explain.rows.pricePerKwh", price, `${input.currencyUnit ?? ""}/kWh`, "input", 2), row("vehicle.explain.rows.result", result, input.currencyUnit ?? "", "result", 2)], };
}

function tripEnergyRows(trip: VoltflowMateTripRow) {
  return [
    row("tripExplain.rows.reportedTraction", finite(trip.traction_energy_kwh), "kWh", "input", 2),
    row("tripExplain.rows.reportedConsumption", finite(trip.avg_consumption_kwh_100km), "kWh/100km", "input", 1),
    row("tripExplain.rows.distance", finite(trip.distance_km), "km", "input", 1),
  ];
}

export function explainTripTractionEnergy(trip: VoltflowMateTripRow): MetricExplanation {
  return { metricKey: "tripTractionEnergy", titleKey: "tripExplain.metrics.traction.title", formulaKey: "tripExplain.metrics.traction.formula", sourceAt: trip.last_device_time ?? trip.ended_at,
    rows: [...tripEnergyRows(trip), row("vehicle.explain.rows.result", tripTractionEnergyKwh(trip), "kWh", "result", 2)] };
}

export function explainTripEnergyPerKm(trip: VoltflowMateTripRow): MetricExplanation {
  return { metricKey: "tripEnergyPerKm", titleKey: "tripExplain.metrics.energyPerKm.title", formulaKey: "tripExplain.metrics.energyPerKm.formula", sourceAt: trip.last_device_time ?? trip.ended_at,
    rows: [row("tripExplain.rows.tractionEnergy", tripTractionEnergyKwh(trip), "kWh", "derived", 2), row("tripExplain.rows.distance", finite(trip.distance_km), "km", "input", 1), row("vehicle.explain.rows.result", tripEnergyPerKm(trip), "kWh/km", "result", 2)] };
}

export function explainTripNetConsumption(trip: VoltflowMateTripRow): MetricExplanation {
  return { metricKey: "tripNetConsumption", titleKey: "tripExplain.metrics.netConsumption.title", formulaKey: "tripExplain.metrics.netConsumption.formula", sourceAt: trip.last_device_time ?? trip.ended_at,
    rows: [row("tripExplain.rows.tractionEnergy", tripTractionEnergyKwh(trip), "kWh", "derived", 2), row("tripExplain.rows.regenEnergy", finite(trip.regen_energy_kwh), "kWh", "input", 2), row("tripExplain.rows.distance", finite(trip.distance_km), "km", "input", 1), row("vehicle.explain.rows.result", tripNetConsumptionKwh100(trip), "kWh/100 km", "result", 1)] };
}

export function explainTripCost({ trip, pricePerKwh, currencyUnit }: { trip: VoltflowMateTripRow; pricePerKwh: number | null | undefined; currencyUnit?: string }): MetricExplanation {
  return { metricKey: "tripCost", titleKey: "tripExplain.metrics.cost.title", formulaKey: "tripExplain.metrics.cost.formula", sourceAt: trip.last_device_time ?? trip.ended_at,
    rows: [row("tripExplain.rows.tractionEnergy", tripTractionEnergyKwh(trip), "kWh", "derived", 2), row("tripExplain.rows.pricePerKwh", finite(pricePerKwh), `${currencyUnit ?? ""}/kWh`, "input", 2), row("vehicle.explain.rows.result", tripCost(trip, pricePerKwh), currencyUnit ?? "", "result", 2)] };
}
