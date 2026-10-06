import type { RangePredictionCycle } from "@/lib/voltflowmate/range-prediction-grading";

export type RangeTrustSummary = {
  /** Multiply the car's next range promise by this to approximate reality. */
  factor: number;
  sampleCycles: number;
  windowDays: number;
};

const TRUST_WINDOW_DAYS = 90;
const MIN_TRUST_CYCLES = 3;
const MIN_FACTOR = 0.5;
const MAX_FACTOR = 1.15;
/** A cycle's influence halves every 14 days, so a change in how the car forms its
 * promise washes out of the correction in weeks instead of dragging for 90 days. */
const HALF_LIFE_DAYS = 14;

/**
 * Learn a forward correction for the car's end-of-charge range promise.
 *
 * factor = recency-weighted median(actualKmAt100 / predictedKmAt100) over cycles that
 * ended within a trailing window (weight 0.5^(ageDays/HALF_LIFE_DAYS)). The median (not the
 * mean) keeps one noisy cycle from swinging it; the recency weight keeps it responsive to
 * the car's *current* promise behavior. Clamped because a factor outside plausible battery
 * behavior signals bad data, not insight. Returns null when the sample is too thin to
 * trust the correction itself.
 *
 * Deliberately outside the `range_est_km` ban graph: this grades and corrects the
 * car's historical promise, it never feeds `range-estimate.ts`.
 */
export function computeRangeTrustFactor(
  cycles: RangePredictionCycle[],
  opts: { nowIso: string; windowDays?: number },
): RangeTrustSummary | null {
  const windowDays = opts.windowDays ?? TRUST_WINDOW_DAYS;
  const now = Date.parse(opts.nowIso);
  const from = now - windowDays * 86_400_000;

  const samples = cycles
    .filter(
      (cycle) =>
        Number.isFinite(cycle.predictedKmAt100) &&
        cycle.predictedKmAt100 > 0 &&
        Number.isFinite(cycle.actualKmAt100) &&
        cycle.actualKmAt100 > 0,
    )
    .map((cycle) => ({
      ratio: cycle.actualKmAt100 / cycle.predictedKmAt100,
      ended: Date.parse(cycle.cycleEndedAt),
    }))
    .filter((sample) => sample.ended > from && sample.ended <= now);

  if (samples.length < MIN_TRUST_CYCLES) return null;

  samples.sort((a, b) => a.ratio - b.ratio);
  const totalWeight = samples.reduce(
    (sum, sample) =>
      sum +
      Math.pow(
        0.5,
        Math.max(0, now - sample.ended) / (HALF_LIFE_DAYS * 86_400_000),
      ),
    0,
  );
  let cumulative = 0;
  let median = samples[samples.length - 1].ratio;
  for (const sample of samples) {
    cumulative += Math.pow(
      0.5,
      Math.max(0, now - sample.ended) / (HALF_LIFE_DAYS * 86_400_000),
    );
    if (cumulative >= totalWeight / 2) {
      median = sample.ratio;
      break;
    }
  }

  const clamped = Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, median));

  return {
    factor: Math.round(clamped * 100) / 100,
    sampleCycles: samples.length,
    windowDays,
  };
}
