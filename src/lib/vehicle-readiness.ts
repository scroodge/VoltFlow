import { isFreshLiveSnapshot } from "./vehicle-live-mode.ts";
import type { VoltflowMateLiveSnapshotRow } from "@/types/database";

export type VehiclePrimaryReadiness =
  | "loading"
  | "ready"
  | "no_contact"
  | "stale"
  | "error";

/**
 * Page shell and primary cockpit readiness are intentionally separate. A settled
 * no-contact/stale result must not remain indistinguishable from a pending query.
 */
export function deriveVehiclePrimaryReadiness({
  carsReady,
  hasMatchedCar,
  liveLoading,
  liveError,
  snapshot,
  nowMs,
}: {
  carsReady: boolean;
  hasMatchedCar: boolean;
  liveLoading: boolean;
  liveError: boolean;
  snapshot: VoltflowMateLiveSnapshotRow | null | undefined;
  nowMs: number;
}): VehiclePrimaryReadiness {
  if (liveError) return "error";
  if (liveLoading || !carsReady) return "loading";
  if (!hasMatchedCar || !snapshot) return "no_contact";
  return isFreshLiveSnapshot(snapshot, nowMs) ? "ready" : "stale";
}
