"use client";

import { useBydmateTripTrackQuery } from "@/hooks/use-bydmate-trip-track-query";
import { useLatestBydmateTripsQuery } from "@/hooks/use-bydmate-trips-query";
import type { BydmateLiveSnapshotRow, BydmateTelemetry } from "@/types/database";

function validNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export type VehicleLastKnownLocation =
  | {
      source: "live";
      lat: number;
      lon: number;
      accuracyM: number | null;
      bearingDeg: number | null;
      deviceTimeIso: string;
    }
  | {
      source: "lastTrip";
      lat: number;
      lon: number;
      accuracyM: number | null;
      deviceTimeIso: string;
      telemetry: BydmateTelemetry;
    };

/**
 * Resolves "where's the car right now" the same way for every consumer: the live
 * snapshot's location when present, else the last trip's final GPS track point.
 * `bydmate_live_snapshots.location` is purged to `{}` after 24h for every account
 * tier (migration 20260720150000_security_gps_retention_and_mate_key_hash.sql), so
 * the last-trip fallback is what carries this past that window.
 */
export function useVehicleLastKnownLocation(
  vehicleId: string | null,
  snapshot: BydmateLiveSnapshotRow | null,
): { location: VehicleLastKnownLocation | null; isLoading: boolean } {
  const liveLat = validNumber(snapshot?.location?.lat);
  const liveLon = validNumber(snapshot?.location?.lon);
  const hasLiveLocation = liveLat != null && liveLon != null;

  const { data: latestTrips = [] } = useLatestBydmateTripsQuery(
    vehicleId,
    1,
    !hasLiveLocation && Boolean(vehicleId),
  );
  const lastTripId = hasLiveLocation ? null : (latestTrips[0]?.id ?? null);
  const { data: trackPoints = [], isLoading: isTrackLoading } =
    useBydmateTripTrackQuery(lastTripId);
  const lastTrackPoint = trackPoints[trackPoints.length - 1] ?? null;
  const tripLat = validNumber(lastTrackPoint?.lat);
  const tripLon = validNumber(lastTrackPoint?.lon);

  if (hasLiveLocation && snapshot) {
    return {
      location: {
        source: "live",
        lat: liveLat as number,
        lon: liveLon as number,
        accuracyM: validNumber(snapshot.location.accuracy_m),
        bearingDeg: validNumber(snapshot.location.bearing_deg),
        deviceTimeIso: snapshot.device_time,
      },
      isLoading: false,
    };
  }

  if (lastTrackPoint && tripLat != null && tripLon != null) {
    return {
      location: {
        source: "lastTrip",
        lat: tripLat,
        lon: tripLon,
        accuracyM: validNumber(lastTrackPoint.accuracy_m),
        deviceTimeIso: lastTrackPoint.device_time,
        telemetry: {
          power_kw: validNumber(lastTrackPoint.power_kw),
          speed_kmh: validNumber(lastTrackPoint.speed_kmh),
          soc: validNumber(lastTrackPoint.soc),
        },
      },
      isLoading: false,
    };
  }

  return { location: null, isLoading: isTrackLoading && Boolean(lastTripId) };
}
