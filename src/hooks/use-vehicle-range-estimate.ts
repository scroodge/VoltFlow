"use client";

import { useMemo } from "react";

import { useLatestVoltflowMateTripsQuery } from "@/hooks/use-voltflowmate-trips-query";
import {
  estimateRangeFromSoc,
  estimateVehicleRangeKm,
  type RangeEstimate,
} from "@/lib/voltflowmate/range-estimate";
import type { VoltflowMateLiveSnapshotRow, VoltflowMateTripRow } from "@/types/database";

export function useVehicleRangeEstimate({
  baseSnapshot,
  scopedVehicleId,
  batteryCapacityKwh,
  reserveSocPercent,
  recentTripsOverride,
  enabled = true,
  fallbackSoc,
}: {
  baseSnapshot: VoltflowMateLiveSnapshotRow | null;
  scopedVehicleId: string | null;
  batteryCapacityKwh?: number | null;
  reserveSocPercent?: number | null;
  recentTripsOverride?: VoltflowMateTripRow[] | null;
  enabled?: boolean;
  fallbackSoc?: number | null;
}): RangeEstimate {
  const tripVehicleId = baseSnapshot?.vehicle_id ?? scopedVehicleId;
  const { data: latestTrips = [] } = useLatestVoltflowMateTripsQuery(
    tripVehicleId,
    1,
    enabled && Boolean(tripVehicleId) && recentTripsOverride === undefined,
    false,
  );
  const recentTrips = recentTripsOverride ?? latestTrips;

  return useMemo(() => {
    if (baseSnapshot) {
      return estimateVehicleRangeKm(baseSnapshot, recentTrips, {
        batteryCapacityKwh,
        reserveSocPercent,
      });
    }
    return estimateRangeFromSoc({
      soc: fallbackSoc,
      batteryCapacityKwh,
      recentTrips,
      reserveSocPercent,
    });
  }, [baseSnapshot, recentTrips, fallbackSoc, batteryCapacityKwh, reserveSocPercent]);
}
