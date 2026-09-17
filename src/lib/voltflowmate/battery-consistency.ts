import {
  FULL_CHARGE_SOC_THRESHOLD,
  nearestSohPercent,
} from "./charge-delta-trend.ts";
import type { TelemetryHistoryPoint } from "@/lib/voltflowmate/telemetry-history";
import type { ChargingSessionRow } from "@/types/database";

/**
 * Battery Consistency diagnoses HV pack UNIFORMITY, not individual cells.
 *
 * Di+ reports only pack-level minimum and maximum cell voltage, never a per-cell
 * array, a physical cell number for Vmin/Vmax, or per-cell internal resistance.
 * Nothing in this module may claim otherwise: no cell numbers, no "internal
 * resistance" (call it "cell voltage spread"), no bad-cell diagnosis. See
 * BACKLOG.md's "Cell-voltage-spread (ΔV) health tracking" and "Battery Consistency"
 * entries for the on-car verification behind this constraint.
 *
 * Only the top-of-charge context ships in phase 1. Mid-SOC-rest and under-load
 * contexts are additional WHERE-clause variants of the same top_of_charge CTE shape
 * and are deferred (see BACKLOG.md) rather than built before this one is validated.
 */
export type DiagnosticContext = "top_charge";

export type BatteryConsistencyPoint = {
  sessionId: string;
  time: number;
  /** Median cell-voltage delta over the top-of-charge window, in millivolts. Never 0 for missing data. */
  cellDeltaMv: number;
  deltaSoc: number;
  sohPercent: number | null;
  diagnosticContext: DiagnosticContext;
};

/**
 * Only the fields the trend reads. Narrow on purpose, matching ChargeDeltaSession in
 * charge-delta-trend.ts: a query selecting a handful of columns must not be typed as
 * a full session row it cannot honestly fill.
 */
export type BatteryConsistencySession = Pick<
  ChargingSessionRow,
  "id" | "status" | "end_median_cell_delta_v" | "end_delta_soc" | "started_at" | "stopped_at"
>;

export type ConsistencyStatus = "excellent" | "good" | "watch" | "poor" | "insufficient_data";
export type ConsistencyTrend = "improving" | "stable" | "worsening" | "insufficient_data";

export type BatteryConsistencySummary = {
  points: BatteryConsistencyPoint[];
  latest: BatteryConsistencyPoint | null;
  status: ConsistencyStatus;
  trend: ConsistencyTrend;
};

export type SohEstimate = {
  sohPercent: number | null;
  /** Always "app_estimate": there is no FID/autoservice SOH field today (verified 2026-09-14). Never relabel as vehicle-reported. */
  source: "app_estimate";
};

export type TemperatureSpreadResult = {
  spreadC: null;
  available: false;
  /** Di+ never reports simultaneous pack Tmin/Tmax, only one rolling average (verified 2026-09-14). This is a data gap, not a bug. */
  reason: "not_supported_by_current_telemetry";
};

/**
 * PROVISIONAL thresholds, not derived from a battery-engineering standard or vehicle
 * documentation. Centralized here (per the project's threshold-colocation convention,
 * e.g. CHARGING_DRIVE_SPEED_KMH in charging-live.ts) so they are easy to find and
 * revise once real fleet history exists. Do not present these as authoritative.
 */
export const CELL_DELTA_PROVISIONAL_THRESHOLDS_MV = {
  excellentMax: 10,
  goodMax: 25,
  watchMax: 50,
} as const;

/** Below this, a change in latest-vs-recent median is noise, not a trend. Provisional. */
export const CONSISTENCY_TREND_STABLE_TOLERANCE_MV = 2;
/** Minimum comparable top-of-charge points before a trend direction is claimed at all. */
export const CONSISTENCY_TREND_MIN_POINTS = 3;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Volts to millivolts, null-safe: missing data must stay unavailable, never become 0. */
export function cellDeltaVoltsToMv(volts: number | null | undefined): number | null {
  return isFiniteNumber(volts) ? volts * 1000 : null;
}

function sessionTime(session: BatteryConsistencySession): number | null {
  const time = Date.parse(session.stopped_at ?? session.started_at ?? "");
  return Number.isFinite(time) ? time : null;
}

/**
 * Build the top-of-charge cell-consistency trend, oldest first. Only sessions with a
 * captured median delta (end_median_cell_delta_v, set by the phase-1 migration) at a
 * near-100% SOC are comparable points; everything else is silently excluded rather
 * than approximated, matching buildChargeDeltaTrend's own full-vs-partial split.
 */
export function buildBatteryConsistencyTrend(
  sessions: BatteryConsistencySession[],
  sohPoints: TelemetryHistoryPoint[] = [],
): BatteryConsistencyPoint[] {
  const points: BatteryConsistencyPoint[] = [];

  for (const session of sessions) {
    if (session.status === "charging") continue;

    const time = sessionTime(session);
    if (time == null) continue;

    const deltaSoc = session.end_delta_soc;
    if (!isFiniteNumber(deltaSoc) || deltaSoc < FULL_CHARGE_SOC_THRESHOLD) continue;

    const cellDeltaMv = cellDeltaVoltsToMv(session.end_median_cell_delta_v);
    if (cellDeltaMv == null || cellDeltaMv <= 0) continue;

    points.push({
      sessionId: session.id,
      time,
      cellDeltaMv,
      deltaSoc,
      sohPercent: nearestSohPercent(time, sohPoints),
      diagnosticContext: "top_charge",
    });
  }

  return points.sort((a, b) => a.time - b.time);
}

/** Vehicle-reported SOH does not exist in this pipeline (verified 2026-09-14: no FID_SOH field anywhere). Always label as an app-side estimate. */
export function describeSoh(sohPercent: number | null | undefined): SohEstimate {
  return {
    sohPercent: isFiniteNumber(sohPercent) ? sohPercent : null,
    source: "app_estimate",
  };
}

/** Di+ never reports pack Tmin/Tmax today; this always returns "unavailable" rather than fabricating a spread. */
export function computeTemperatureSpread(): TemperatureSpreadResult {
  return { spreadC: null, available: false, reason: "not_supported_by_current_telemetry" };
}

export function classifyCellConsistencyStatus(cellDeltaMv: number | null): ConsistencyStatus {
  if (!isFiniteNumber(cellDeltaMv)) return "insufficient_data";
  const { excellentMax, goodMax, watchMax } = CELL_DELTA_PROVISIONAL_THRESHOLDS_MV;
  if (cellDeltaMv <= excellentMax) return "excellent";
  if (cellDeltaMv <= goodMax) return "good";
  if (cellDeltaMv <= watchMax) return "watch";
  return "poor";
}

/**
 * Compares the latest point against the median of the prior comparable points (not
 * just the single previous one) so one noisy session can't flip the trend label.
 */
export function classifyConsistencyTrend(points: BatteryConsistencyPoint[]): ConsistencyTrend {
  if (points.length < CONSISTENCY_TREND_MIN_POINTS) return "insufficient_data";

  const latest = points[points.length - 1];
  const priorValues = points
    .slice(0, -1)
    .map((point) => point.cellDeltaMv)
    .sort((a, b) => a - b);
  const mid = Math.floor(priorValues.length / 2);
  const priorMedian =
    priorValues.length % 2 === 0
      ? (priorValues[mid - 1] + priorValues[mid]) / 2
      : priorValues[mid];

  const diff = latest.cellDeltaMv - priorMedian;
  if (Math.abs(diff) <= CONSISTENCY_TREND_STABLE_TOLERANCE_MV) return "stable";
  return diff > 0 ? "worsening" : "improving";
}

export function buildBatteryConsistencySummary(
  sessions: BatteryConsistencySession[],
  sohPoints: TelemetryHistoryPoint[] = [],
): BatteryConsistencySummary {
  const points = buildBatteryConsistencyTrend(sessions, sohPoints);
  const latest = points.at(-1) ?? null;

  return {
    points,
    latest,
    status: classifyCellConsistencyStatus(latest?.cellDeltaMv ?? null),
    trend: classifyConsistencyTrend(points),
  };
}
