"use client";

import { useMemo } from "react";

import { useLatestBydmateTripsQuery } from "@/hooks/use-bydmate-trips-query";
import {
  estimateRangeFromSoc,
  estimateVehicleRangeKm,
  type RangeEstimate,
} from "@/lib/bydmate/range-estimate";
import type { BydmateLiveSnapshotRow, BydmateTripRow } from "@/types/database";

export function useVehicleRangeEstimate({
  baseSnapshot,
  scopedVehicleId,
  batteryCapacityKwh,
  recentTripsOverride,
  enabled = true,
  fallbackSoc,
}: {
  baseSnapshot: BydmateLiveSnapshotRow | null;
  scopedVehicleId: string | null;
  batteryCapacityKwh?: number | null;
  recentTripsOverride?: BydmateTripRow[] | null;
  enabled?: boolean;
  fallbackSoc?: number | null;
}): RangeEstimate {
  const tripVehicleId = baseSnapshot?.vehicle_id ?? scopedVehicleId;
  const { data: latestTrips = [] } = useLatestBydmateTripsQuery(
    tripVehicleId,
    1,
    enabled && Boolean(tripVehicleId) && recentTripsOverride === undefined,
    false,
  );
  const recentTrips = recentTripsOverride ?? latestTrips;

  return useMemo(() => {
    if (baseSnapshot) {
      return estimateVehicleRangeKm(baseSnapshot, recentTrips, { batteryCapacityKwh });
    }
    return estimateRangeFromSoc({
      soc: fallbackSoc,
      batteryCapacityKwh,
      recentTrips,
    });
  }, [baseSnapshot, recentTrips, fallbackSoc, batteryCapacityKwh]);
}
