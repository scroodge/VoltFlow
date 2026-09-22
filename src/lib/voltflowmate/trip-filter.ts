import type { VoltflowMateTripRow } from "@/types/database";

export const MOVING_SPEED_THRESHOLD_KMH = 3;
export const MIN_TRIP_SAMPLES = 3;
const STATIONARY_DISTANCE_THRESHOLD_KM = 0.1;
const CHARGING_POWER_THRESHOLD_KW = -0.1;

export type TripMotionPowerPoint = {
  power_kw?: number | null;
  speed_kmh?: number | null;
  current_trip_distance_km?: number | null;
};

function finiteNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function hasNegativePower(points: TripMotionPowerPoint[]) {
  return points.some((point) => {
    const power = finiteNumber(point.power_kw);
    return power != null && power < CHARGING_POWER_THRESHOLD_KW;
  });
}

function hasMovingEvidence(
  trip: VoltflowMateTripRow,
  points: TripMotionPowerPoint[],
) {
  const distance = finiteNumber(trip.distance_km);
  if (distance != null && distance > STATIONARY_DISTANCE_THRESHOLD_KM)
    return true;

  const maxSpeed = finiteNumber(trip.max_speed_kmh);
  if (maxSpeed != null && maxSpeed > MOVING_SPEED_THRESHOLD_KMH) return true;

  const avgSpeed = finiteNumber(trip.avg_speed_kmh);
  if (avgSpeed != null && avgSpeed > MOVING_SPEED_THRESHOLD_KMH) return true;

  return points.some((point) => {
    const speed = finiteNumber(point.speed_kmh);
    if (speed != null && speed > MOVING_SPEED_THRESHOLD_KMH) return true;

    const currentTripDistance = finiteNumber(point.current_trip_distance_km);
    return (
      currentTripDistance != null &&
      currentTripDistance > STATIONARY_DISTANCE_THRESHOLD_KM
    );
  });
}

function hasStationaryEvidence(
  trip: VoltflowMateTripRow,
  points: TripMotionPowerPoint[],
) {
  const distance = finiteNumber(trip.distance_km);
  if (distance != null && distance <= STATIONARY_DISTANCE_THRESHOLD_KM)
    return true;

  const maxSpeed = finiteNumber(trip.max_speed_kmh);
  if (maxSpeed != null && maxSpeed <= MOVING_SPEED_THRESHOLD_KMH) return true;

  const avgSpeed = finiteNumber(trip.avg_speed_kmh);
  if (avgSpeed != null && avgSpeed <= MOVING_SPEED_THRESHOLD_KMH) return true;

  return points.some((point) => {
    const speed = finiteNumber(point.speed_kmh);
    if (speed != null && speed <= MOVING_SPEED_THRESHOLD_KMH) return true;

    const currentTripDistance = finiteNumber(point.current_trip_distance_km);
    return (
      currentTripDistance != null &&
      currentTripDistance <= STATIONARY_DISTANCE_THRESHOLD_KM
    );
  });
}

export function isSingleSampleTrip(trip: VoltflowMateTripRow): boolean {
  return trip.sample_count < 2;
}

/**
 * Stationary micro-trips (0–2 samples, no real movement) — common while parked.
 *
 * A trip with fewer than `MIN_TRIP_SAMPLES` in-between telemetry samples is only junk
 * when it also has no moving evidence. `sample_count = 0` is not always a rare
 * telemetry gap — it is the *permanent* shape of `bydmate_trips.source =
 * 'byd_energydata'` rows: some BYD models keep their own on-car trip log, and
 * `bydmate_ingest_trip_summaries` (migration `20260706190000`) imports it as
 * aggregate-only trips (real `distance_km`/`avg_speed_kmh`, but no telemetry samples,
 * GPS track, max speed, or SOC — ever), bypassing `bydmate_ingest_telemetry` and its
 * server junk filter entirely. This function is the *only* junk check that ever runs
 * on those rows, so it must judge them by moving evidence, not sample count. See
 * CHANGELOG.md → "Trip display filter no longer hides real byd_energydata-imported
 * trips" (2026-09-22).
 */
export function isJunkTrip(
  trip: VoltflowMateTripRow,
  points: TripMotionPowerPoint[] = [],
) {
  if (isStationaryChargingLikeTrip(trip, points)) return true;
  if (trip.sample_count < MIN_TRIP_SAMPLES && !hasMovingEvidence(trip, points))
    return true;
  return false;
}

export function isStationaryChargingLikeTrip(
  trip: VoltflowMateTripRow,
  points: TripMotionPowerPoint[],
) {
  return (
    hasNegativePower(points) &&
    hasStationaryEvidence(trip, points) &&
    !hasMovingEvidence(trip, points)
  );
}
