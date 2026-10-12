"use client";

import { useQuery } from "@tanstack/react-query";

import { devFetch, isDevAppRoute } from "@/lib/dev/dev-fetch";
import { readAnalyticsResponse } from "@/lib/analytics-request";
import type { RangeTrustSummary } from "@/lib/voltflowmate/range-trust-factor";

type RangeTrustPayload = { trust: RangeTrustSummary | null };

async function fetchRangeTrust(vehicleId: string): Promise<RangeTrustPayload> {
  const path = `/api/vehicle/analytics?type=range-trust&vehicle_id=${encodeURIComponent(vehicleId)}`;
  const response = isDevAppRoute()
    ? await devFetch(path)
    : await fetch(path, { cache: "no-store" });
  return readAnalyticsResponse<RangeTrustPayload>(response);
}

/**
 * The learned trust factor for the car's range promise (phase 4b).
 *
 * The factor moves on a days scale (recency-weighted median over discharge cycles),
 * so an hour of freshness is plenty and this stays off the live-query hot path.
 */
export function useRangeTrustQuery(vehicleId: string | null) {
  return useQuery({
    queryKey: ["vehicle-analytics", "range-trust", vehicleId],
    queryFn: () => fetchRangeTrust(vehicleId as string),
    enabled: Boolean(vehicleId),
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
}
