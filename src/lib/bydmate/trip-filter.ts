import type { BydmateTripRow } from "@/types/database";

const MOVING_SPEED_THRESHOLD_KMH = 3;
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

function hasMovingEvidence(trip: BydmateTripRow, points: TripMotionPowerPoint[]) {
  const distance = finiteNumber(trip.distance_km);
  if (distance != null && distance > STATIONARY_DISTANCE_THRESHOLD_KM) return true;

  const maxSpeed = finiteNumber(trip.max_speed_kmh);
  if (maxSpeed != null && maxSpeed > MOVING_SPEED_THRESHOLD_KMH) return true;

  const avgSpeed = finiteNumber(trip.avg_speed_kmh);
  if (avgSpeed != null && avgSpeed > MOVING_SPEED_THRESHOLD_KMH) return true;

  return points.some((point) => {
    const speed = finiteNumber(point.speed_kmh);
    if (speed != null && speed > MOVING_SPEED_THRESHOLD_KMH) return true;

    const currentTripDistance = finiteNumber(point.current_trip_distance_km);
    return currentTripDistance != null && currentTripDistance > STATIONARY_DISTANCE_THRESHOLD_KM;
  });
}

function hasStationaryEvidence(trip: BydmateTripRow, points: TripMotionPowerPoint[]) {
  const distance = finiteNumber(trip.distance_km);
  if (distance != null && distance <= STATIONARY_DISTANCE_THRESHOLD_KM) return true;

  const maxSpeed = finiteNumber(trip.max_speed_kmh);
  if (maxSpeed != null && maxSpeed <= MOVING_SPEED_THRESHOLD_KMH) return true;

  const avgSpeed = finiteNumber(trip.avg_speed_kmh);
  if (avgSpeed != null && avgSpeed <= MOVING_SPEED_THRESHOLD_KMH) return true;

  return points.some((point) => {
    const speed = finiteNumber(point.speed_kmh);
    if (speed != null && speed <= MOVING_SPEED_THRESHOLD_KMH) return true;

    const currentTripDistance = finiteNumber(point.current_trip_distance_km);
    return currentTripDistance != null && currentTripDistance <= STATIONARY_DISTANCE_THRESHOLD_KM;
  });
}

export function isStationaryChargingLikeTrip(
  trip: BydmateTripRow,
  points: TripMotionPowerPoint[],
) {
  return (
    hasNegativePower(points) &&
    hasStationaryEvidence(trip, points) &&
    !hasMovingEvidence(trip, points)
  );
}
