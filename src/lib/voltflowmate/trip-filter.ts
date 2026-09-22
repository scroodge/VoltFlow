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
 * when it also has no moving evidence. A gap-closed daemon trip can legitimately have
 * `sample_count = 0` (only the open+close bracket reached ingest) while still carrying a
 * real `distance_km` derived from the car's trip-meter delta — that must not be hidden
 * just because no extend samples arrived in between. See docs/TRIPS.md → "Client display
 * filter" and BACKLOG.md "Trip display filter hides real gap-bridged trips".
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
