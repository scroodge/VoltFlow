"use client";

import { useQuery } from "@tanstack/react-query";

import { devFetch } from "@/lib/dev/dev-fetch";
import { queryKeys } from "@/lib/query-keys";
import type { VoltflowMateDiplus, VoltflowMateTelemetry } from "@/types/database";

export type TripTelemetrySample = {
  device_time: string;
  telemetry: VoltflowMateTelemetry;
  diplus?: VoltflowMateDiplus;
  diplus_min_cell_voltage_v?: number | null;
  diplus_max_cell_voltage_v?: number | null;
  diplus_cell_delta_v?: number | null;
};

async function fetchTripSamples(tripId: string): Promise<TripTelemetrySample[]> {
  const response = await devFetch(`/api/vehicle/trips/${tripId}/samples`);
  if (!response.ok) throw new Error("Failed to load trip samples");

  const payload = (await response.json()) as { points: TripTelemetrySample[] };
  return payload.points ?? [];
}

export function useVoltflowMateTripSamplesQuery(tripId: string | null) {
  return useQuery({
    queryKey: queryKeys.voltflowMateTripSamples(tripId ?? ""),
    queryFn: () => fetchTripSamples(tripId!),
    enabled: Boolean(tripId),
    staleTime: 60_000,
  });
}
