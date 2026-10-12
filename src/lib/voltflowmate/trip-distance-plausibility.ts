/**
 * Plausibility guard for a stored `bydmate_trips.distance_km` (BACKLOG.md "Odometer-scale trip
 * distances").
 *
 * A Mate client trip can reach the server with the car's odometer as its distance (tens of
 * thousands of km in minutes). The server guards new writes (migrations 20261007130000 /
 * 20261007150000), but still-open trips and any older row remain, so every consumer that sums or
 * grades distance must not trust one blindly.
 *
 * The rule is the per-trip cap ONLY. An implied-speed test (distance / recorded duration) was
 * tried and removed: some trips carry a truncated duration (15-122 s) with a correct distance
 * (energy agrees within ~10 %), and on 2,650 client trips every one flagged by speed alone was
 * such a false positive, while the 7 genuine odometer-scale phantoms (> 15,000 km) all exceed
 * the cap. Every vehicle's odometer is well above the cap, so a phantom is always caught.
 *
 * Keep in sync with the SQL twin `bydmate_trip_distance_plausible` (supabase/migrations).
 */
export const MAX_PLAUSIBLE_TRIP_KM = 1500;

export type TripDistanceCandidate = {
  distance_km: number | null | undefined;
};

/**
 * False only when the distance exceeds the per-trip cap. A missing or non-positive distance is
 * not judged here (callers already skip it).
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
  return distance <= MAX_PLAUSIBLE_TRIP_KM;
}

/**
 * Read-side safety net: returns each trip unchanged, except that an implausible `distance_km`
 * becomes `null` on a copy. The drive stays in the list with its time and route, but no sum,
 * consumption or range figure can use the bogus distance. Never mutates the input; stored rows
 * are untouched.
 *
 * Do NOT feed this to `gradeRangePredictionCycles`: it already skips a whole cycle that
 * contains an implausible trip, and a nulled distance would make it silently under-count.
 */
export function sanitizeTripDistances<T extends TripDistanceCandidate>(
  trips: T[],
): T[] {
  return trips.map((trip) =>
    isPlausibleTripDistance(trip) ? trip : { ...trip, distance_km: null },
  );
}
