"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-keys";
import { isDevMockChargingSessionId } from "@/lib/dev/build-mock-charging-session";
import type { BydmateDiplus, BydmateTelemetry, SessionStatus } from "@/types/database";

export type ChargingSessionTelemetrySample = {
  device_time: string;
  telemetry: BydmateTelemetry;
  diplus?: BydmateDiplus;
  diplus_min_cell_voltage_v?: number | null;
  diplus_max_cell_voltage_v?: number | null;
  diplus_cell_delta_v?: number | null;
};

async function fetchChargingSessionSamples(
  sessionId: string,
  vehicleId?: string | null,
): Promise<ChargingSessionTelemetrySample[]> {
  const params = new URLSearchParams({ t: String(Date.now()) });
  const normalizedVehicleId = vehicleId?.trim();
  if (normalizedVehicleId) {
    params.set("vehicle_id", normalizedVehicleId);
  }
  const response = await fetch(
    `/api/vehicle/charging-sessions/${sessionId}/samples?${params.toString()}`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error("Failed to load charging samples");

  const payload = (await response.json()) as { points: ChargingSessionTelemetrySample[] };
  return payload.points ?? [];
}

export function useBydmateChargingSessionSamplesQuery(
  sessionId: string,
  vehicleId?: string | null,
  sessionStatus?: SessionStatus,
) {
  const isActiveChargingSession = sessionStatus === "charging";
  const vehicleKey = vehicleId?.trim() || "auto";

  return useQuery({
    queryKey: queryKeys.bydmateChargingSessionSamples(sessionId, vehicleKey),
    queryFn: () => fetchChargingSessionSamples(sessionId, vehicleId),
    enabled: Boolean(sessionId) && !isDevMockChargingSessionId(sessionId),
    staleTime: isActiveChargingSession ? 10_000 : 60_000,
    refetchInterval: isActiveChargingSession ? 15_000 : false,
    refetchIntervalInBackground: isActiveChargingSession,
    refetchOnWindowFocus: "always",
  });
}
