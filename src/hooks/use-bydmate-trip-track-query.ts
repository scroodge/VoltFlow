"use client";

import { useQuery } from "@tanstack/react-query";

import { devFetch } from "@/lib/dev/dev-fetch";
import { queryKeys } from "@/lib/query-keys";
import type { BydmateTripTrackPointRow } from "@/types/database";

async function fetchTripTrack(tripId: string): Promise<BydmateTripTrackPointRow[]> {
  const response = await devFetch(`/api/vehicle/trips/${tripId}/track`);
  if (!response.ok) throw new Error("Failed to load trip track");

  const payload = (await response.json()) as { points: BydmateTripTrackPointRow[] };
  return payload.points ?? [];
}

export function useBydmateTripTrackQuery(tripId: string | null) {
  return useQuery({
    queryKey: queryKeys.bydmateTripTrack(tripId ?? ""),
    queryFn: () => fetchTripTrack(tripId!),
    enabled: Boolean(tripId),
    staleTime: 60_000,
  });
}
