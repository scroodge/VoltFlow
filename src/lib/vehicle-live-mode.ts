import { isTelemetryCharging } from "./bydmate/telemetry-charging.ts";
import type { TranslationKey } from "@/lib/i18n";
import type { BydmateLiveSnapshotRow } from "@/types/database";

type NormalizedDiplusGear = "P" | "R" | "N" | "D" | null;

function normalizeDiplusGear(value: string | number | null | undefined): NormalizedDiplusGear {
  if (value == null) return null;
  if (typeof value === "string") {
    const letter = value.trim().toUpperCase();
    if (letter === "P" || letter === "R" || letter === "N" || letter === "D") return letter;
    const n = Number(letter);
    if (!Number.isFinite(n)) return null;
    return normalizeDiplusGear(n);
  }
  switch (value) {
    case 1:
      return "P";
    case 2:
      return "R";
    case 3:
      return "N";
    case 4:
      return "D";
    default:
      return null;
  }
}

export const LIVE_SNAPSHOT_STALE_MS = 90_000;
/** Align with Mate ingest / charging-live drive-away threshold. */
export const DRIVING_SPEED_THRESHOLD_KMH = 5;

export type DashboardVehicleMode =
  | "app_charging"
  | "live_charging"
  | "driving"
  | "parked"
  | "stale";

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** D/R/N in drive, or speed above threshold — never treat as charging. */
export function isRawDrivingTelemetry(snapshot: BydmateLiveSnapshotRow | null | undefined) {
  if (!snapshot) return false;

  const gear = normalizeDiplusGear(snapshot.diplus?.gear);
  if (gear === "D" || gear === "R" || gear === "N") return true;

  const speedKmh = finiteNumber(snapshot.telemetry.speed_kmh);
  return speedKmh != null && speedKmh > DRIVING_SPEED_THRESHOLD_KMH;
}

export function isFreshLiveSnapshot(
  snapshot: BydmateLiveSnapshotRow | null | undefined,
  nowMs: number,
  staleMs = LIVE_SNAPSHOT_STALE_MS,
) {
  if (!snapshot) return false;
  const receivedMs = Date.parse(snapshot.received_at);
  return Number.isFinite(receivedMs) && nowMs - receivedMs <= staleMs;
}

export function isChargingTelemetry(snapshot: BydmateLiveSnapshotRow | null | undefined) {
  if (!snapshot || isRawDrivingTelemetry(snapshot)) return false;
  return isTelemetryCharging(snapshot.telemetry);
}

export function isParkedTelemetry(snapshot: BydmateLiveSnapshotRow | null | undefined) {
  if (!snapshot || isChargingTelemetry(snapshot)) return false;

  const gear = normalizeDiplusGear(snapshot.diplus?.gear);
  if (gear === "P") return true;
  if (gear === "D") return false;

  const speedKmh = finiteNumber(snapshot.telemetry.speed_kmh);
  return speedKmh == null || speedKmh <= DRIVING_SPEED_THRESHOLD_KMH;
}

export function isDrivingTelemetry(snapshot: BydmateLiveSnapshotRow | null | undefined) {
  if (!snapshot || isChargingTelemetry(snapshot)) return false;
  return !isParkedTelemetry(snapshot);
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
  if (!snapshot) return hasActiveSession ? "app_charging" : "stale";
  const fresh = isFreshLiveSnapshot(snapshot, nowMs, staleMs);
  if (fresh && isRawDrivingTelemetry(snapshot)) return "driving";
  if (hasActiveSession) return "app_charging";
  if (!fresh) return "stale";
  if (isChargingTelemetry(snapshot)) return "live_charging";
  if (isDrivingTelemetry(snapshot)) return "driving";
  return "parked";
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
      return "dashboard.statusOnline";
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
      return "vehicle.status.online";
  }
}

export function canStartChargingSession(mode: DashboardVehicleMode) {
  return mode === "parked" || mode === "stale" || mode === "live_charging";
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
