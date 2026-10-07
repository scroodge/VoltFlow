/**
 * Plausibility guard for a stored `bydmate_trips.distance_km` (BACKLOG.md "Odometer-scale trip
 * distances", stage 1).
 *
 * A Mate client trip can reach the server with the car's odometer as its distance (tens of
 * thousands of km in minutes). The server filters these at close since migration
 * 20260917120000, but older rows and still-open trips remain, so every consumer that sums or
 * grades distance must not trust one blindly. Real trips are far inside both limits.
 *
 * Pure and deliberately not coupled to `bydmate_discard_trip_if_junk` Rule C: that rule falls
 * back to 80 km/h when max speed is null and would reject legitimate highway averages.
 */
export const MAX_PLAUSIBLE_TRIP_KM = 1500;
export const MAX_PLAUSIBLE_TRIP_SPEED_KMH = 250;
/** Below this, implied speed is dominated by rounding, so only the km cap applies. */
const MIN_KM_FOR_SPEED_CHECK = 1;

export type TripDistanceCandidate = {
  distance_km: number | null | undefined;
  started_at: string;
  /** `ended_at`, or `last_device_time` for a trip that is still open. */
  ended_at?: string | null;
};

/**
 * False when the distance cannot be real: above the per-trip cap, or implying a speed no car
 * reaches. A missing or non-positive distance is not judged here (callers already skip it),
 * and an unknown duration can only be checked against the km cap.
 */
export function isPlausibleTripDistance(trip: TripDistanceCandidate): boolean {
  const distance = trip.distance_km;
  if (
    typeof distance !== "number" ||
    !Number.isFinite(distance) ||
    distance <= 0
  ) {
    return true;
  }
  if (distance > MAX_PLAUSIBLE_TRIP_KM) return false;
  if (distance <= MIN_KM_FOR_SPEED_CHECK || !trip.ended_at) return true;

  const durationS =
    (Date.parse(trip.ended_at) - Date.parse(trip.started_at)) / 1000;
  if (!Number.isFinite(durationS) || durationS <= 0) return true;
  return (distance * 3600) / durationS <= MAX_PLAUSIBLE_TRIP_SPEED_KMH;
}

type SanitizableTrip = {
  distance_km: number | null | undefined;
  started_at: string;
  ended_at?: string | null;
  last_device_time?: string | null;
};

/**
 * Read-side safety net (BACKLOG.md stage 1b): returns each trip unchanged, except that an
 * implausible `distance_km` becomes `null` on a copy. The drive stays in the list with its
 * time and route, but no sum, consumption or range figure can use the bogus distance. Never
 * mutates the input; stored rows are untouched. An open trip is judged against
 * `last_device_time`, since it has no `ended_at` yet.
 *
 * Do NOT feed this to `gradeRangePredictionCycles`: it already skips a whole cycle that
 * contains an implausible trip, and a nulled distance would make it silently under-count.
 */
export function sanitizeTripDistances<T extends SanitizableTrip>(
  trips: T[],
): T[] {
  return trips.map((trip) =>
    isPlausibleTripDistance({
      distance_km: trip.distance_km,
      started_at: trip.started_at,
      ended_at: trip.ended_at ?? trip.last_device_time ?? null,
    })
      ? trip
      : { ...trip, distance_km: null },
  );
}
