import { haversineDistanceM } from "@/lib/home-charger-geofence";
import { matchNearestTariffLocation } from "@/lib/charging-tariffs";
import { filterLiveSnapshotsForVehicle } from "@/lib/charging-session-sync";
import type {
  BydmateLiveSnapshotRow,
  ChargingTariffLocationRow,
} from "@/types/database";

export type GpsCoordinates = { lat: number; lon: number };
export type GpsLocationSource = "mate-live" | "browser";

export function coordinatesFromLiveSnapshots(
  snapshots: BydmateLiveSnapshotRow[],
  vehicleId: string | null | undefined,
): GpsCoordinates | null {
  const scoped = filterLiveSnapshotsForVehicle(snapshots, vehicleId);
  for (const snapshot of scoped) {
    const lat = snapshot.location?.lat;
    const lon = snapshot.location?.lon;
    if (typeof lat === "number" && typeof lon === "number") {
      return { lat, lon };
    }
  }
  return null;
}

export function resolveTariffLocationMatch(
  location: GpsCoordinates | null | undefined,
  presets: ChargingTariffLocationRow[],
) {
  if (!location) return null;
  const preset = matchNearestTariffLocation(location, presets);
  if (!preset) return null;
  const distanceM = haversineDistanceM(location.lat, location.lon, preset.lat, preset.lng);
  return { preset, distanceM };
}

export function pickChargingGpsLocation({
  mateLocation,
  browserLocation,
}: {
  mateLocation: GpsCoordinates | null;
  browserLocation: GpsCoordinates | null;
}): { location: GpsCoordinates; source: GpsLocationSource } | null {
  if (mateLocation) return { location: mateLocation, source: "mate-live" };
  if (browserLocation) return { location: browserLocation, source: "browser" };
  return null;
}
