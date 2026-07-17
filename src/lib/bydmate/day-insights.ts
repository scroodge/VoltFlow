import type { BydmateTripRow } from "@/types/database";

export type TripWithEnergy = BydmateTripRow & {
  outside_temp_avg?: number | null;
};

export type ConsumptionBaseline = {
  medianKwh100: number | null;
  sampleTripCount: number;
};

export type DayInsight =
  | {
      kind: "baseline";
      dayKwh100: number;
      baselineKwh100: number;
      deltaPercent: number;
      better: boolean;
    }
  | {
      kind: "trip_efficiency";
      variant: "best" | "worst";
      startedAt: string;
      kwh100: number;
      distanceKm: number;
    }
  | {
      kind: "regen_share";
      regenKwh: number;
      tractionKwh: number;
      sharePercent: number;
    }
  | {
      kind: "regen_compare";
      highRegenKwh100: number;
      lowRegenKwh100: number;
      highTripCount: number;
      lowTripCount: number;
    }
  | { kind: "regen_insufficient" };

const MIN_TRIP_DISTANCE_KM = 1;
const REGEN_SHARE_THRESHOLD = 0.1;
const REGEN_COMPARE_MIN_KWH100_DELTA = 1;

function validNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function weightedAvgConsumptionKwh100(trips: TripWithEnergy[]): number | null {
  let weightedSum = 0;
  let weightedDistance = 0;

  for (const trip of trips) {
    const distance = trip.distance_km ?? 0;
    const consumption = trip.avg_consumption_kwh_100km;
    if (distance >= MIN_TRIP_DISTANCE_KM && consumption != null && consumption > 0) {
      weightedSum += consumption * distance;
      weightedDistance += distance;
    }
  }

  return weightedDistance > 0 ? weightedSum / weightedDistance : null;
}

/** Returns a trustworthy day total only when every displayed trip has measured energy. */
export function totalMeasuredTripEnergyKwh(trips: TripWithEnergy[]): number | null {
  if (trips.length === 0) return null;

  let total = 0;
  for (const trip of trips) {
    const traction = validNumber(trip.traction_energy_kwh);
    if (traction == null) return null;
    total += traction;
  }

  return total;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

export function tripRegenShare(trip: TripWithEnergy): number | null {
  const regen = validNumber(trip.regen_energy_kwh);
  const traction = validNumber(trip.traction_energy_kwh);
  if (regen == null || traction == null || traction <= 0) return null;
  return regen / traction;
}

function formatClock(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function buildDayInsights({
  trips,
  baseline,
}: {
  trips: TripWithEnergy[];
  baseline: ConsumptionBaseline | null;
}): DayInsight[] {
  const insights: DayInsight[] = [];
  const dayKwh100 = weightedAvgConsumptionKwh100(trips);

  if (dayKwh100 != null && baseline?.medianKwh100 != null && baseline.medianKwh100 > 0) {
    const deltaPercent = ((dayKwh100 - baseline.medianKwh100) / baseline.medianKwh100) * 100;
    insights.push({
      kind: "baseline",
      dayKwh100,
      baselineKwh100: baseline.medianKwh100,
      deltaPercent,
      better: dayKwh100 < baseline.medianKwh100,
    });
  }

  const ranked = trips
    .filter(
      (trip) =>
        (trip.distance_km ?? 0) >= MIN_TRIP_DISTANCE_KM &&
        trip.avg_consumption_kwh_100km != null &&
        trip.avg_consumption_kwh_100km > 0,
    )
    .sort((a, b) => (a.avg_consumption_kwh_100km ?? 0) - (b.avg_consumption_kwh_100km ?? 0));

  if (ranked.length >= 1) {
    const best = ranked[0]!;
    insights.push({
      kind: "trip_efficiency",
      variant: "best",
      startedAt: formatClock(best.started_at),
      kwh100: best.avg_consumption_kwh_100km!,
      distanceKm: best.distance_km ?? 0,
    });
  }

  if (ranked.length >= 2) {
    const worst = ranked[ranked.length - 1]!;
    if (worst.id !== ranked[0]?.id) {
      insights.push({
        kind: "trip_efficiency",
        variant: "worst",
        startedAt: formatClock(worst.started_at),
        kwh100: worst.avg_consumption_kwh_100km!,
        distanceKm: worst.distance_km ?? 0,
      });
    }
  }

  let regenSum = 0;
  let tractionSum = 0;
  for (const trip of trips) {
    regenSum += trip.regen_energy_kwh ?? 0;
    tractionSum += trip.traction_energy_kwh ?? 0;
  }

  if (tractionSum > 0 && regenSum > 0) {
    insights.push({
      kind: "regen_share",
      regenKwh: regenSum,
      tractionKwh: tractionSum,
      sharePercent: (regenSum / tractionSum) * 100,
    });
  }

  const withRegenShare = trips
    .map((trip) => ({ trip, share: tripRegenShare(trip) }))
    .filter((row): row is { trip: TripWithEnergy; share: number } => row.share != null);

  if (withRegenShare.length >= 3) {
    const threshold =
      median(withRegenShare.map((row) => row.share)) ?? REGEN_SHARE_THRESHOLD;
    const high: TripWithEnergy[] = [];
    const low: TripWithEnergy[] = [];

    for (const { trip, share } of withRegenShare) {
      if (share >= threshold) high.push(trip);
      else low.push(trip);
    }

    const highKwh100 = weightedAvgConsumptionKwh100(high);
    const lowKwh100 = weightedAvgConsumptionKwh100(low);

    if (
      high.length >= 1 &&
      low.length >= 1 &&
      highKwh100 != null &&
      lowKwh100 != null &&
      Math.abs(highKwh100 - lowKwh100) >= REGEN_COMPARE_MIN_KWH100_DELTA
    ) {
      insights.push({
        kind: "regen_compare",
        highRegenKwh100: highKwh100,
        lowRegenKwh100: lowKwh100,
        highTripCount: high.length,
        lowTripCount: low.length,
      });
    }
  }

  const hasRegenInsight = insights.some(
    (item) => item.kind === "regen_share" || item.kind === "regen_compare",
  );
  if (!hasRegenInsight && trips.length > 0 && withRegenShare.length < 3) {
    insights.push({ kind: "regen_insufficient" });
  }

  return insights.slice(0, 3);
}
