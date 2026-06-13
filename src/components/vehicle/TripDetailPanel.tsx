"use client";

import { useBydmateTripSamplesQuery } from "@/hooks/use-bydmate-trip-samples-query";
import { useBydmateTripTrackQuery } from "@/hooks/use-bydmate-trip-track-query";
import { TelemetryHistoryCharts, RouteMap } from "@/components/vehicle/vehicle-live-view";

export function TripDetailPanel({ tripId }: { tripId: string }) {
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

  return (
    <>
      <TelemetryHistoryCharts
        points={samples}
        isLoading={isSamplesLoading}
        hasError={Boolean(samplesError)}
        embedded
      />
      <RouteMap
        trackPoints={track}
        isLoading={isTrackLoading}
        hasError={Boolean(trackError)}
        embedded
      />
    </>
  );
}
