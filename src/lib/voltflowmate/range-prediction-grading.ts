export type GradingSession = {
  id: string;
  status: string;
  start_percent: number;
  started_at: string | null;
  stopped_at: string | null;
  end_range_est_km: number | null;
  end_range_soc: number | null;
};

export type GradingTrip = {
  started_at: string;
  distance_km: number | null;
  /** `ended_at`, or `last_device_time` while open; lets the plausibility guard check speed. */
  ended_at?: string | null;
};

import {
  computeRangeTrustFactor,
  type RangeTrustSummary,
} from "./range-trust-factor.ts";
import { isPlausibleTripDistance } from "./trip-distance-plausibility.ts";

export type RangePredictionCycle = {
  /** Session that made the promise (the charge being graded against). */
  promiseSessionId: string;
  /** Session that ended the discharge cycle (the next charge). */
  nextSessionId: string;
  chargeEndedAt: string;
  cycleEndedAt: string;
  promiseKm: number;
  anchorSoc: number;
  /** Car promise extrapolated to a full tank (km at 100%). */
  predictedKmAt100: number;
  actualKmAt100: number;
  errorPct: number;
  distanceTraveledKm: number;
  socDropPercent: number;
  tripCount: number;
  cycleDays: number;
};

export type RangePredictionReport = {
  cycles: RangePredictionCycle[];
  gradedCount: number;
  meanErrorPct: number | null;
  medianErrorPct: number | null;
  /** Share of graded cycles where reality fell short of the promise (%). */
  optimisticCount: number;
  pessimisticCount: number;
  avgPredictedKmAt100: number | null;
  avgActualKmAt100: number | null;
  /** Forward correction learned from this report's cycles in a trailing window. */
  trust: RangeTrustSummary | null;
};

const MIN_SOC_DROP_PERCENT = 2;
const MIN_CYCLE_DISTANCE_KM = 0.5;
const MAX_CYCLE_DAYS = 45;

function finiteNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Grade each "promise → reality" discharge cycle.
 *
 * A cycle is a pair of consecutive closed sessions: the first ends with a frozen
 * range promise (end_range_est_km @ end_range_soc, captured by
 * 20261006180000), the second starts after the car was driven down. Reality =
 * trip distance driven between the two; error = actual vs promised km per % SOC.
 *
 * Skips dirty pairs (no promise, stale anchor, tiny SOC drop, unreasonably long
 * parked cycles, no driving) rather than grading noise. Pure: sessions/trips are
 * fetched by the caller.
 */
export function gradeRangePredictionCycles(
  sessions: GradingSession[],
  trips: GradingTrip[],
  window: { from: string; to: string },
): RangePredictionReport {
  const closed = sessions
    .filter(
      (session) =>
        session.status !== "charging" &&
        session.stopped_at != null &&
        session.started_at != null,
    )
    .sort((a, b) => Date.parse(a.stopped_at!) - Date.parse(b.stopped_at!));

  const windowFrom = Date.parse(window.from);
  const windowTo = Date.parse(window.to);

  const cycles: RangePredictionCycle[] = [];

  for (let i = 1; i < closed.length; i += 1) {
    const promise = closed[i - 1];
    const next = closed[i];

    const promiseKm = finiteNumber(promise.end_range_est_km);
    const anchorSoc = finiteNumber(promise.end_range_soc);
    const cycleEndedAt = next.started_at!;
    const chargeEndedAt = promise.stopped_at!;

    if (
      promiseKm == null ||
      promiseKm <= 0 ||
      anchorSoc == null ||
      anchorSoc <= 0 ||
      // grade on the promise, but display cycles whose NEXT charge falls in the window
      Date.parse(next.stopped_at!) < windowFrom ||
      Date.parse(chargeEndedAt) > windowTo ||
      Date.parse(cycleEndedAt) <= Date.parse(chargeEndedAt)
    ) {
      continue;
    }

    const socDrop = anchorSoc - next.start_percent;
    const cycleDays =
      (Date.parse(cycleEndedAt) - Date.parse(chargeEndedAt)) / 86_400_000;

    let distanceTraveledKm = 0;
    let tripCount = 0;
    let hasImplausibleTrip = false;
    for (const trip of trips) {
      const started = Date.parse(trip.started_at);
      if (
        started <= Date.parse(chargeEndedAt) ||
        started > Date.parse(cycleEndedAt)
      ) {
        continue;
      }
      const distance = finiteNumber(trip.distance_km);
      if (distance == null || distance <= 0) continue;
      if (!isPlausibleTripDistance(trip)) {
        hasImplausibleTrip = true;
        break;
      }
      distanceTraveledKm += distance;
      tripCount += 1;
    }

    if (
      // An odometer-scale trip has no trustworthy distance, so the cycle's true km is unknown:
      // skip it rather than grade noise (or silently under-count by dropping just that trip).
      hasImplausibleTrip ||
      socDrop < MIN_SOC_DROP_PERCENT ||
      cycleDays > MAX_CYCLE_DAYS ||
      distanceTraveledKm < MIN_CYCLE_DISTANCE_KM
    ) {
      continue;
    }

    const predictedKmPerSoc = promiseKm / anchorSoc;
    const actualKmPerSoc = distanceTraveledKm / socDrop;

    cycles.push({
      promiseSessionId: promise.id,
      nextSessionId: next.id,
      chargeEndedAt,
      cycleEndedAt: next.stopped_at!,
      promiseKm: round1(promiseKm),
      anchorSoc: round1(anchorSoc),
      predictedKmAt100: round1(predictedKmPerSoc * 100),
      actualKmAt100: round1(actualKmPerSoc * 100),
      errorPct: round1((actualKmPerSoc / predictedKmPerSoc - 1) * 100),
      distanceTraveledKm: round1(distanceTraveledKm),
      socDropPercent: round1(socDrop),
      tripCount,
      cycleDays: round1(cycleDays),
    });
  }

  cycles.sort(
    (a, b) => Date.parse(b.cycleEndedAt) - Date.parse(a.cycleEndedAt),
  );

  const errors = cycles.map((cycle) => cycle.errorPct);
  const mean =
    errors.length > 0
      ? round1(errors.reduce((sum, value) => sum + value, 0) / errors.length)
      : null;
  const sorted = [...errors].sort((a, b) => a - b);
  const median =
    sorted.length > 0
      ? round1(
          sorted.length % 2 === 1
            ? sorted[(sorted.length - 1) / 2]
            : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2,
        )
      : null;

  return {
    cycles,
    gradedCount: cycles.length,
    meanErrorPct: mean,
    medianErrorPct: median,
    optimisticCount: errors.filter((value) => value < 0).length,
    pessimisticCount: errors.filter((value) => value >= 0).length,
    avgPredictedKmAt100:
      cycles.length > 0
        ? round1(
            cycles.reduce((sum, cycle) => sum + cycle.predictedKmAt100, 0) /
              cycles.length,
          )
        : null,
    avgActualKmAt100:
      cycles.length > 0
        ? round1(
            cycles.reduce((sum, cycle) => sum + cycle.actualKmAt100, 0) /
              cycles.length,
          )
        : null,
    trust: computeRangeTrustFactor(cycles, { nowIso: window.to }),
  };
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}
