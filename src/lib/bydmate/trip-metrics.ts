import type { BydmateTripRow } from "@/types/database";

type TripEnergyFields = Pick<
  BydmateTripRow,
  "traction_energy_kwh" | "regen_energy_kwh" | "distance_km" | "avg_consumption_kwh_100km"
>;

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
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
