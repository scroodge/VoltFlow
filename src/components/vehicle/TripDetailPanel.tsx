"use client";

import { useBydmateTripSamplesQuery } from "@/hooks/use-bydmate-trip-samples-query";
import { useBydmateTripTrackQuery } from "@/hooks/use-bydmate-trip-track-query";
import { TelemetryHistoryCharts, RouteMap, TripSummaryCard } from "@/components/vehicle/vehicle-live-view";
import type { BydmateTripRow } from "@/types/database";

export function TripDetailPanel({
  tripId,
  trip,
}: {
  tripId: string;
  trip?: BydmateTripRow;
}) {
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
      {trip ? <TripSummaryCard trip={trip} /> : null}
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
