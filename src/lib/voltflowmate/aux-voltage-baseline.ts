import type { AuxVoltageDailyPoint } from "./aux-voltage-history.ts";

export const AUX_BASELINE_DAYS = 90;
export const AUX_MIN_RESTING_DAYS = 14;

export type AuxVoltageBaseline = {
  sufficient: boolean;
  restingDayCount: number;
  restingNow: number | null;
  baseline: number | null;
  change: number | null;
};

function percentile90(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * 0.9;
  const lower = Math.floor(index);
  const fraction = index - lower;
  return sorted[lower] + (sorted[Math.min(lower + 1, sorted.length - 1)] - sorted[lower]) * fraction;
}

export function computeAuxVoltageBaseline(points: readonly AuxVoltageDailyPoint[]): AuxVoltageBaseline {
  const resting = points
    .filter((point) => point.vResting != null && Number.isFinite(point.vResting))
    .sort((a, b) => a.date.localeCompare(b.date));
  const latest = resting.at(-1) ?? null;
  if (!latest) return { sufficient: false, restingDayCount: 0, restingNow: null, baseline: null, change: null };

  const cutoff = new Date(`${latest.date}T00:00:00.000Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - (AUX_BASELINE_DAYS - 1));
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  const windowPoints = resting.filter((point) => point.date >= cutoffDate);
  const restingNow = latest.vResting as number;
  if (windowPoints.length < AUX_MIN_RESTING_DAYS) {
    return { sufficient: false, restingDayCount: windowPoints.length, restingNow, baseline: null, change: null };
  }
  const baseline = percentile90(windowPoints.map((point) => point.vResting as number));
  return { sufficient: true, restingDayCount: windowPoints.length, restingNow, baseline, change: restingNow - baseline };
}
