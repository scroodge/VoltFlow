"use client";

import { useQuery } from "@tanstack/react-query";

import { devFetch, isDevAppRoute } from "@/lib/dev/dev-fetch";
import type { TelemetryHistoryPoint } from "@/lib/bydmate/telemetry-history";
import { queryKeys } from "@/lib/query-keys";

async function fetchSohHistory(
  anchorDate: string,
  vehicleId: string | null,
): Promise<TelemetryHistoryPoint[]> {
  const params = new URLSearchParams({ date: anchorDate });
  if (vehicleId) params.set("vehicle_id", vehicleId);

  const path = `/api/vehicle/telemetry/soh?${params.toString()}`;
  const response = isDevAppRoute()
    ? await devFetch(path)
    : await fetch(path, { cache: "no-store" });

  if (!response.ok) throw new Error("Failed to load SOH history");

  const payload = (await response.json()) as { points: TelemetryHistoryPoint[] };
  return payload.points ?? [];
}

export function useBydmateSohHistoryQuery({
  anchorDate,
  vehicleId,
  enabled = true,
}: {
  anchorDate: string;
  vehicleId: string | null;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: queryKeys.bydmateSohHistory(anchorDate, vehicleId),
    queryFn: () => fetchSohHistory(anchorDate, vehicleId),
    enabled,
    staleTime: 60_000,
  });
}
