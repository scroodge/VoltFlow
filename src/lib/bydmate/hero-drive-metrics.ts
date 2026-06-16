import type { BydmateLiveSnapshotRow, BydmateTripRow, ChargingSessionRow } from "@/types/database";

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sessionAnchorMs(session: ChargingSessionRow): number {
  if (session.stopped_at) return Date.parse(session.stopped_at);
  if (session.started_at) return Date.parse(session.started_at);
  return Date.parse(session.created_at);
}

export function findLastFinishedChargeSession(
  sessions: ChargingSessionRow[],
  carId: string | null,
): ChargingSessionRow | null {
  if (!carId) return null;

  const finished = sessions.filter(
    (session) =>
      session.car_id === carId &&
      (session.status === "completed" || session.status === "stopped") &&
      (session.stopped_at != null || session.started_at != null),
  );
  if (finished.length === 0) return null;

  return [...finished].sort((left, right) => sessionAnchorMs(right) - sessionAnchorMs(left))[0] ?? null;
}

export function tripDistanceKm(
  trip: BydmateTripRow,
  liveTripDistanceKm: number | null | undefined,
): number | null {
  const stored = finiteNumber(trip.distance_km);
  const live = finiteNumber(liveTripDistanceKm);

  if (!trip.ended_at && live != null) {
    if (stored != null) return Math.max(stored, live);
    return live;
  }

  return stored;
}

export function sumDistanceSinceCharge(
  trips: BydmateTripRow[],
  anchorStoppedAt: string | null,
  liveTripDistanceKm?: number | null,
): number | null {
  if (!anchorStoppedAt) return null;

  const anchorMs = Date.parse(anchorStoppedAt);
  if (!Number.isFinite(anchorMs)) return null;

  let sum = 0;
  let hasAny = false;

  for (const trip of trips) {
    const startedMs = Date.parse(trip.started_at);
    if (!Number.isFinite(startedMs) || startedMs < anchorMs) continue;

    const distance = tripDistanceKm(trip, !trip.ended_at ? liveTripDistanceKm : null);
    if (distance == null || distance < 0) continue;

    sum += distance;
    hasAny = true;
  }

  return hasAny ? sum : 0;
}

export type ResolveKmPerPercentSocInput = {
  trip: BydmateTripRow | null;
  liveSoc: number | null | undefined;
  liveDistanceKm: number | null | undefined;
  batteryCapacityKwh: number | null | undefined;
  consumptionKwh100: number | null | undefined;
};

export function resolveKmPerPercentSoc(input: ResolveKmPerPercentSocInput): number | null {
  const { trip, liveSoc, liveDistanceKm, batteryCapacityKwh, consumptionKwh100 } = input;
  if (!trip) return resolveKmPerPercentFromConsumption(batteryCapacityKwh, consumptionKwh100);

  const distance = tripDistanceKm(trip, liveDistanceKm);
  const socStart = finiteNumber(trip.soc_start);
  let socDelta: number | null = null;

  if (!trip.ended_at) {
    const currentSoc = finiteNumber(liveSoc) ?? finiteNumber(trip.soc_end);
    if (socStart != null && currentSoc != null) {
      socDelta = socStart - currentSoc;
    }
  } else {
    const socEnd = finiteNumber(trip.soc_end);
    if (socStart != null && socEnd != null) {
      socDelta = socStart - socEnd;
    }
  }

  if (distance != null && socDelta != null && socDelta >= 1) {
    const kmPerPercent = distance / socDelta;
    if (Number.isFinite(kmPerPercent) && kmPerPercent > 0) return kmPerPercent;
  }

  return resolveKmPerPercentFromConsumption(
    batteryCapacityKwh,
    consumptionKwh100 ?? trip.avg_consumption_kwh_100km,
  );
}

function resolveKmPerPercentFromConsumption(
  batteryCapacityKwh: number | null | undefined,
  consumptionKwh100: number | null | undefined,
): number | null {
  const capacity = finiteNumber(batteryCapacityKwh);
  const consumption = finiteNumber(consumptionKwh100);
  if (capacity == null || capacity <= 0 || consumption == null || consumption <= 0) return null;

  const kmPerPercent = capacity / consumption;
  return Number.isFinite(kmPerPercent) && kmPerPercent > 0 ? kmPerPercent : null;
}

export function computeHeroDriveMetrics({
  sessions,
  carId,
  trips,
  snapshot,
  batteryCapacityKwh,
}: {
  sessions: ChargingSessionRow[];
  carId: string | null;
  trips: BydmateTripRow[];
  snapshot: Pick<BydmateLiveSnapshotRow, "telemetry">;
  batteryCapacityKwh: number | null;
}): {
  distanceSinceChargeKm: number | null;
  kmPerPercentSoc: number | null;
} {
  const lastCharge = findLastFinishedChargeSession(sessions, carId);
  const anchorStoppedAt = lastCharge?.stopped_at ?? lastCharge?.started_at ?? null;
  const liveDistanceKm = snapshot.telemetry.current_trip_distance_km;
  const latestTrip = trips[0] ?? null;

  return {
    distanceSinceChargeKm: sumDistanceSinceCharge(trips, anchorStoppedAt, liveDistanceKm),
    kmPerPercentSoc: resolveKmPerPercentSoc({
      trip: latestTrip,
      liveSoc: snapshot.telemetry.soc,
      liveDistanceKm,
      batteryCapacityKwh,
      consumptionKwh100: snapshot.telemetry.current_trip_consumption_kwh_100km,
    }),
  };
}

export function formatHeroDistanceKm(km: number | null | undefined): string {
  if (typeof km !== "number" || !Number.isFinite(km)) return "—";
  return `${km.toFixed(1)} km`;
}

export function formatKmPerPercent(km: number | null | undefined): string {
  if (typeof km !== "number" || !Number.isFinite(km)) return "—";
  return `${km.toFixed(1)} km/1%`;
}
