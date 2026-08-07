import type { BydmateTripRow } from "@/types/database";

type TripEnergyFields = Pick<
  BydmateTripRow,
  "traction_energy_kwh" | "regen_energy_kwh" | "distance_km" | "avg_consumption_kwh_100km"
>;

/** Minimal shape needed to average the device-reported consumption field. */
export type TripConsumptionFields = {
  distance_km: number | null;
  avg_consumption_kwh_100km: number | null;
};

/**
 * Trips shorter than this are dropped from consumption averages: they are
 * dominated by cold-start draw with no cruise to offset it, so including them
 * skews an average far above what the same driving actually costs.
 */
export const MIN_CONSUMPTION_TRIP_DISTANCE_KM = 1;

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Distance-weighted average of the device-reported `avg_consumption_kwh_100km`
 * field — the single implementation behind every "average consumption" figure
 * that reports what the car itself displays (day view, analytics summary and
 * panels, efficiency chart, live trip pill, range forecast).
 *
 * Not the same number as {@link tripNetConsumptionKwh100}, which derives
 * consumption from measured energy instead; see BACKLOG.md "Consumption formula
 * map" for why both exist.
 *
 * Returns `null` when no trip qualifies — never a differently-weighted fallback,
 * so a caller cannot show an unweighted mean under the same label.
 */
export function weightedAvgConsumptionKwh100(
  trips: readonly TripConsumptionFields[],
  options: { minDistanceKm?: number } = {},
): number | null {
  const minDistanceKm = options.minDistanceKm ?? MIN_CONSUMPTION_TRIP_DISTANCE_KM;
  let weightedSum = 0;
  let weightedDistance = 0;

  for (const trip of trips) {
    const distance = trip.distance_km;
    const consumption = trip.avg_consumption_kwh_100km;
    // Consumption must be positive: the device reports zero or negative on a
    // long regen descent, which is real but is not an "average consumption".
    if (!isFiniteNumber(distance) || distance < minDistanceKm) continue;
    if (!isFiniteNumber(consumption) || consumption <= 0) continue;

    weightedSum += consumption * distance;
    weightedDistance += distance;
  }

  return weightedDistance > 0 ? weightedSum / weightedDistance : null;
}

/**
 * Energy drawn for traction. Older imported trips may not have a direct
 * traction value, so use their reported consumption as an equivalent fallback.
 */
export function tripTractionEnergyKwh(trip: TripEnergyFields): number | null {
  if (isFiniteNumber(trip.traction_energy_kwh)) return trip.traction_energy_kwh;

  if (
    isFiniteNumber(trip.distance_km) &&
    trip.distance_km > 0 &&
    isFiniteNumber(trip.avg_consumption_kwh_100km)
  ) {
    return (trip.distance_km * trip.avg_consumption_kwh_100km) / 100;
  }

  return null;
}

export function tripEnergyPerKm(trip: TripEnergyFields): number | null {
  const tractionKwh = tripTractionEnergyKwh(trip);
  if (!isFiniteNumber(tractionKwh) || !isFiniteNumber(trip.distance_km) || trip.distance_km <= 0) {
    return null;
  }

  return tractionKwh / trip.distance_km;
}

/** Net battery energy used per 100 km after recovered regenerative energy. */
export function tripNetConsumptionKwh100(trip: TripEnergyFields): number | null {
  const tractionKwh = tripTractionEnergyKwh(trip);
  if (
    !isFiniteNumber(tractionKwh) ||
    !isFiniteNumber(trip.regen_energy_kwh) ||
    !isFiniteNumber(trip.distance_km) ||
    trip.distance_km <= 0
  ) {
    return null;
  }

  return ((tractionKwh - trip.regen_energy_kwh) / trip.distance_km) * 100;
}
