import type { VoltflowMateLocation, Car } from "@/types/database";

const EARTH_RADIUS_M = 6_371_000;

function toRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

export function haversineDistanceM(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function carHasHomeGeofence(car: Pick<Car, "home_charger_lat" | "home_charger_lon">) {
  return (
    typeof car.home_charger_lat === "number" &&
    Number.isFinite(car.home_charger_lat) &&
    typeof car.home_charger_lon === "number" &&
    Number.isFinite(car.home_charger_lon)
  );
}

export function isAtHomeCharger(
  location: VoltflowMateLocation | null | undefined,
  car: Pick<Car, "home_charger_lat" | "home_charger_lon" | "home_charger_radius_m">,
): boolean {
  if (!carHasHomeGeofence(car)) return false;
  const lat = location?.lat;
  const lon = location?.lon;
  if (typeof lat !== "number" || typeof lon !== "number") return false;

  const radiusM = car.home_charger_radius_m ?? 150;
  const distanceM = haversineDistanceM(lat, lon, car.home_charger_lat!, car.home_charger_lon!);
  return distanceM <= radiusM;
}
