import type { BydmateLiveSnapshotRow, BydmateTripRow, ChargingSessionRow } from "@/types/database";

// Cloud summaries and daemon telemetry disagree on trip boundaries by up to a
// few minutes (energydata rows start earlier and can end much later).
const TRIP_TWIN_TOLERANCE_MS = 5 * 60_000;

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function tripIntervalMs(trip: BydmateTripRow): [number, number] | null {
  const start = Date.parse(trip.started_at);
  if (!Number.isFinite(start)) return null;
  const end = Date.parse(trip.ended_at ?? trip.last_device_time ?? trip.started_at);
  return [start, Number.isFinite(end) ? Math.max(start, end) : start];
}

/**
 * `byd_energydata` cloud trip summaries duplicate the trips the Mate telemetry
 * daemon already records. Drop an energydata row when a telemetry trip overlaps
 * it in time; keep it when no telemetry twin exists (e.g. the daemon was offline
 * for that trip). Whether a car syncs energydata tracks firmware, not model
 * generation — DiLink 3 (gen1_2024) cars produce them too — so this keys purely
 * on the presence of energydata rows in the list, never on `model_generation`.
 */
export function dedupeTripsBySource(trips: BydmateTripRow[]): BydmateTripRow[] {
  const telemetryIntervals = trips
    .filter((trip) => trip.source !== "byd_energydata")
    .map(tripIntervalMs)
    .filter((interval): interval is [number, number] => interval != null);
  if (telemetryIntervals.length === 0) return trips;

  return trips.filter((trip) => {
    if (trip.source !== "byd_energydata") return true;
    const interval = tripIntervalMs(trip);
    if (!interval) return true;
    return !telemetryIntervals.some(
      ([start, end]) =>
        interval[0] <= end + TRIP_TWIN_TOLERANCE_MS &&
        interval[1] >= start - TRIP_TWIN_TOLERANCE_MS,
    );
  });
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

// Math Distance window: walk trips back (newest first) until this much distance is
// covered, so one junk micro-trip (0 km / 0% drop) can't knock the estimate down to
// the consumption fallback. See BACKLOG.md "Math Distance: rolling ~50 km efficiency
// window" for the measured comparison against the single-trip and capacity-based
// alternatives.
const MATH_RANGE_WINDOW_KM = 50;
const MATH_RANGE_MIN_SOC_DELTA_PERCENT = 1;

export type ResolveKmPerPercentSocInput = {
  /** Deduped trips, newest first (as returned by `bydmate_trips` ordered by started_at desc). */
  trips: BydmateTripRow[];
  liveSoc: number | null | undefined;
  liveDistanceKm: number | null | undefined;
  batteryCapacityKwh: number | null | undefined;
  consumptionKwh100: number | null | undefined;
};

function tripSocDelta(
  trip: BydmateTripRow,
  isCurrent: boolean,
  liveSoc: number | null | undefined,
): number | null {
  const socStart = finiteNumber(trip.soc_start);
  if (socStart == null) return null;

  if (!trip.ended_at) {
    const currentSoc = isCurrent ? finiteNumber(liveSoc) ?? finiteNumber(trip.soc_end) : finiteNumber(trip.soc_end);
    return currentSoc != null ? socStart - currentSoc : null;
  }

  const socEnd = finiteNumber(trip.soc_end);
  return socEnd != null ? socStart - socEnd : null;
}

export function resolveKmPerPercentSoc(input: ResolveKmPerPercentSocInput): number | null {
  const { trips, liveSoc, liveDistanceKm, batteryCapacityKwh, consumptionKwh100 } = input;
  const latestTrip = trips[0] ?? null;
  if (!latestTrip) return resolveKmPerPercentFromConsumption(batteryCapacityKwh, consumptionKwh100);

  let totalDistance = 0;
  let totalSocDelta = 0;

  for (let i = 0; i < trips.length && totalDistance < MATH_RANGE_WINDOW_KM; i += 1) {
    const trip = trips[i];
    const isCurrent = i === 0;
    const distance = tripDistanceKm(trip, isCurrent && !trip.ended_at ? liveDistanceKm : null);
    const socDelta = tripSocDelta(trip, isCurrent, liveSoc);

    // Skip trips with missing or non-driving-adjacent data rather than aborting the
    // walk, so a handful of junk entries don't starve the window of real distance.
    if (distance == null || distance < 0 || socDelta == null || socDelta <= 0) continue;

    totalDistance += distance;
    totalSocDelta += socDelta;
  }

  if (totalDistance > 0 && totalSocDelta >= MATH_RANGE_MIN_SOC_DELTA_PERCENT) {
    const kmPerPercent = totalDistance / totalSocDelta;
    if (Number.isFinite(kmPerPercent) && kmPerPercent > 0) return kmPerPercent;
  }

  return resolveKmPerPercentFromConsumption(
    batteryCapacityKwh,
    consumptionKwh100 ?? latestTrip.avg_consumption_kwh_100km,
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
  const dedupedTrips = dedupeTripsBySource(trips);

  return {
    distanceSinceChargeKm: sumDistanceSinceCharge(dedupedTrips, anchorStoppedAt, liveDistanceKm),
    kmPerPercentSoc: resolveKmPerPercentSoc({
      trips: dedupedTrips,
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
  return `${km.toFixed(1)} `;
}
