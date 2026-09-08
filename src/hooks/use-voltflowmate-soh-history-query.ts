"use client";

import { useQuery } from "@tanstack/react-query";

import { devFetch, isDevAppRoute } from "@/lib/dev/dev-fetch";
import { buildSohHistoryPath, readSohHistoryResponse } from "@/lib/soh-history-request";
import type { TelemetryHistoryPoint } from "@/lib/voltflowmate/telemetry-history";
import type { TelemetryHistoryRange } from "@/lib/voltflowmate/telemetry-ranges";
import { queryKeys } from "@/lib/query-keys";

async function fetchSohHistory(
  range: TelemetryHistoryRange,
  anchorDate: string,
  vehicleId: string | null,
): Promise<TelemetryHistoryPoint[]> {
  const path = buildSohHistoryPath({ range, anchorDate, vehicleId });
  const response = isDevAppRoute()
    ? await devFetch(path)
    : await fetch(path, { cache: "no-store" });

  return readSohHistoryResponse<TelemetryHistoryPoint>(response);
}

export function useVoltflowMateSohHistoryQuery({
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
    queryKey: queryKeys.voltflowMateSohHistory(range, anchorDate, vehicleId),
    queryFn: () => fetchSohHistory(range, anchorDate, vehicleId),
    enabled,
    staleTime: 60_000,
  });
}
