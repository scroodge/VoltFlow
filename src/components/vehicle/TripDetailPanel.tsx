"use client";

import { useBydmateTripSamplesQuery } from "@/hooks/use-bydmate-trip-samples-query";
import { useBydmateTripTrackQuery } from "@/hooks/use-bydmate-trip-track-query";
import { isRouteTrackDisplayable } from "@/lib/bydmate/route-insights";
import { odometerDeltaFromSamples } from "@/lib/bydmate/trip-distance";
import type { BydmateTripRow } from "@/types/database";
import { RouteMap } from "@/components/vehicle/vehicle-route-map";
import { TelemetryHistoryCharts } from "@/components/vehicle/vehicle-telemetry-visualizations";

export function TripDetailPanel({ tripId, trip }: { tripId: string; trip?: BydmateTripRow }) {
  const {
    data: samples = [],
    isLoading: isSamplesLoading,
    error: samplesError,
  } = useBydmateTripSamplesQuery(tripId);
  const {
    data: track = [],
    isLoading: isTrackLoading,
    error: trackError,
  } = useBydmateTripTrackQuery(tripId);
  const odometerDistanceKm = odometerDeltaFromSamples(samples) ?? trip?.distance_km ?? null;
  const showRouteMap = isRouteTrackDisplayable(track, 2, 75, { odometerDistanceKm });

  return (
    <>
      <TelemetryHistoryCharts
        points={samples}
        isLoading={isSamplesLoading}
        hasError={Boolean(samplesError)}
        embedded
      />
      {!trip || showRouteMap || isTrackLoading || trackError || track.length === 0 ? (
        <RouteMap
          trackPoints={track}
          isLoading={isTrackLoading}
          hasError={Boolean(trackError)}
          embedded
        />
      ) : null}
    </>
  );
}
