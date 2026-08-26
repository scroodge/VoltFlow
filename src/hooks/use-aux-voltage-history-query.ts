"use client";

import { useQuery } from "@tanstack/react-query";
import { devFetch, isDevAppRoute } from "@/lib/dev/dev-fetch";
import { queryKeys } from "@/lib/query-keys";
import type { AuxVoltageDailyPoint } from "@/lib/voltflowmate/aux-voltage-history";

async function fetchAuxVoltageHistory(vehicleId: string, from: string, to: string) {
  const params = new URLSearchParams({ vehicle_id: vehicleId, from, to });
  const path = `/api/vehicle/aux-voltage?${params}`;
  const response = isDevAppRoute() ? await devFetch(path) : await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error("Failed to load auxiliary voltage history");
  const payload = (await response.json()) as { rows: AuxVoltageDailyPoint[] };
  return payload.rows ?? [];
}

export function useAuxVoltageHistoryQuery({ vehicleId, from, to, enabled = true }: { vehicleId: string; from: string; to: string; enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.voltflowMateAuxVoltageHistory(vehicleId, from, to),
    queryFn: () => fetchAuxVoltageHistory(vehicleId, from, to),
    enabled,
    staleTime: 60_000,
  });
}
