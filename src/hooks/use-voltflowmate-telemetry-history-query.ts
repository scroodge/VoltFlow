"use client";

import { useQuery } from "@tanstack/react-query";

import { devFetch, isDevAppRoute } from "@/lib/dev/dev-fetch";
import { queryKeys } from "@/lib/query-keys";
import type { TelemetryHistoryPoint } from "@/lib/voltflowmate/telemetry-history";
import type { TelemetryHistoryRange } from "@/lib/voltflowmate/telemetry-ranges";

async function fetchTelemetryHistory(
  range: TelemetryHistoryRange,
  anchorDate: string,
  vehicleId: string | null,
): Promise<TelemetryHistoryPoint[]> {
  const params = new URLSearchParams({ range, date: anchorDate });
  if (vehicleId) params.set("vehicle_id", vehicleId);

  const path = `/api/vehicle/telemetry?${params.toString()}`;
  const response = isDevAppRoute()
    ? await devFetch(path)
    : await fetch(path, { cache: "no-store" });

  if (!response.ok) throw new Error("Failed to load telemetry history");

  const payload = (await response.json()) as { points: TelemetryHistoryPoint[] };
  return payload.points ?? [];
}

export function useVoltflowMateTelemetryHistoryQuery({
  range,
  anchorDate,
  vehicleId,
  enabled = true,
}: {
  range: TelemetryHistoryRange;
  anchorDate: string;
  vehicleId: string | null;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: queryKeys.voltflowMateTelemetryHistory(range, anchorDate, vehicleId),
    queryFn: () => fetchTelemetryHistory(range, anchorDate, vehicleId),
    enabled,
    staleTime: 60_000,
  });
}
