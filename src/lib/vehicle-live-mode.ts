import {
  DRIVING_SPEED_THRESHOLD_KMH,
  isDriveTelemetry,
  isParkStateTelemetry,
} from "./bydmate/gear.ts";
import { isTelemetryCharging } from "./bydmate/telemetry-charging.ts";
import type { TranslationKey } from "@/lib/i18n";
import type { BydmateLiveSnapshotRow } from "@/types/database";

export { DRIVING_SPEED_THRESHOLD_KMH };

export const LIVE_SNAPSHOT_STALE_MS = 90_000;

export type DashboardVehicleMode =
  | "app_charging"
  | "live_charging"
  | "driving"
  | "parked"
  | "stale";

export function isFreshLiveSnapshot(
  snapshot: BydmateLiveSnapshotRow | null | undefined,
  nowMs: number,
  staleMs = LIVE_SNAPSHOT_STALE_MS,
) {
  if (!snapshot) return false;
  const receivedMs = Date.parse(snapshot.received_at);
  return Number.isFinite(receivedMs) && nowMs - receivedMs <= staleMs;
}

/** @deprecated Use isDriveTelemetry from bydmate/gear */
export function isRawDrivingTelemetry(snapshot: BydmateLiveSnapshotRow | null | undefined) {
  return isDriveTelemetry(snapshot);
}

export function isChargingTelemetry(snapshot: BydmateLiveSnapshotRow | null | undefined) {
  if (!snapshot || isDriveTelemetry(snapshot)) return false;
  if (!isParkStateTelemetry(snapshot)) return false;
  return isTelemetryCharging(snapshot.telemetry, snapshot);
}

export function isParkedTelemetry(snapshot: BydmateLiveSnapshotRow | null | undefined) {
  if (!snapshot || isChargingTelemetry(snapshot)) return false;
  return isParkStateTelemetry(snapshot);
}

export function isDrivingTelemetry(snapshot: BydmateLiveSnapshotRow | null | undefined) {
  if (!snapshot || isChargingTelemetry(snapshot)) return false;
  return isDriveTelemetry(snapshot);
}

export function deriveDashboardVehicleMode({
  snapshot,
  nowMs,
  hasActiveSession,
  staleMs = LIVE_SNAPSHOT_STALE_MS,
}: {
  snapshot: BydmateLiveSnapshotRow | null | undefined;
  nowMs: number;
  hasActiveSession: boolean;
  staleMs?: number;
}): DashboardVehicleMode {
  if (!snapshot) return hasActiveSession ? "app_charging" : "parked";

  const fresh = isFreshLiveSnapshot(snapshot, nowMs, staleMs);
  if (fresh && isDriveTelemetry(snapshot)) return "driving";
  if (hasActiveSession) return "app_charging";
  if (!fresh) return "stale";
  if (isChargingTelemetry(snapshot)) return "live_charging";
  if (isParkStateTelemetry(snapshot)) return "parked";
  return "stale";
}

export function dashboardVehicleStatusLabelKey(mode: DashboardVehicleMode): TranslationKey {
  switch (mode) {
    case "app_charging":
      return "dashboard.statusCharging";
    case "live_charging":
      return "dashboard.statusLiveCharging";
    case "driving":
      return "dashboard.statusDriving";
    case "stale":
      return "dashboard.statusStale";
    case "parked":
    default:
      return "dashboard.statusParking";
  }
}

export function vehicleStatusLabelKey(mode: DashboardVehicleMode): TranslationKey {
  switch (mode) {
    case "stale":
      return "vehicle.status.stale";
    case "app_charging":
    case "live_charging":
      return "vehicle.status.charging";
    case "driving":
      return "vehicle.status.driving";
    case "parked":
    default:
      return "vehicle.status.parking";
  }
}

export function canStartChargingSession(mode: DashboardVehicleMode) {
  return mode === "parked" || mode === "stale" || mode === "live_charging";
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function snapshotSpeedDetail(
  snapshot: BydmateLiveSnapshotRow | null | undefined,
): string | null {
  const speedKmh = finiteNumber(snapshot?.telemetry.speed_kmh);
  if (speedKmh == null) return null;
  return `${Math.round(speedKmh)} km/h`;
}

export function resolveLiveSnapshotForVehicle(
  snapshots: BydmateLiveSnapshotRow[],
  vehicleId: string | null | undefined,
): BydmateLiveSnapshotRow | null {
  if (!snapshots.length) return null;
  if (!vehicleId) return snapshots[0] ?? null;
  return snapshots.find((row) => row.vehicle_id === vehicleId) ?? snapshots[0] ?? null;
}
