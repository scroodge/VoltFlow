"use client";

import { useVoltflowMateTripSamplesQuery } from "@/hooks/use-voltflowmate-trip-samples-query";
import { useVoltflowMateTripTrackQuery } from "@/hooks/use-voltflowmate-trip-track-query";
import { isRouteTrackDisplayable } from "@/lib/voltflowmate/route-insights";
import { odometerDeltaFromSamples } from "@/lib/voltflowmate/trip-distance";
import type { VoltflowMateTripRow } from "@/types/database";
import { RouteMap } from "@/components/vehicle/vehicle-route-map";
import { TelemetryHistoryCharts } from "@/components/vehicle/vehicle-telemetry-visualizations";

export function TripDetailPanel({ tripId, trip }: { tripId: string; trip?: VoltflowMateTripRow }) {
  const {
    data: samples = [],
    isLoading: isSamplesLoading,
    error: samplesError,
  } = useVoltflowMateTripSamplesQuery(tripId);
  const {
    data: track = [],
    isLoading: isTrackLoading,
    error: trackError,
  } = useVoltflowMateTripTrackQuery(tripId);
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
