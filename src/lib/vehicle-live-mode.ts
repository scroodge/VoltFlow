import {
  DRIVING_SPEED_THRESHOLD_KMH,
  isDriveTelemetry,
  isParkStateTelemetry,
} from "./bydmate/gear.ts";
import { isTelemetryCharging } from "../features/charging/domain.ts";
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

function chargingCheckSpeedKmh(
  snapshot: Pick<BydmateLiveSnapshotRow, "telemetry" | "diplus">,
): number | null {
  const fromTelemetry = finiteNumber(snapshot.telemetry.speed_kmh);
  if (fromTelemetry != null) return fromTelemetry;
  return finiteNumber(snapshot.diplus?.speed_kmh);
}

/**
 * Gear is not a reliable "parked" gate here: some cars' DiPlus gear signal does not
 * reset to "P" while parked and charging (observed on car `way` — gear reads "D" for
 * the whole charge). Use speed instead, matching the auto-session engine's
 * `isVehicleParkedForCharging`, so a real charge signal at ~0 km/h isn't discarded just
 * because gear still reads D/R/N. Actual movement (speed above threshold) still wins —
 * a stray charge_power_kw reading must not turn a moving car into "charging".
 */
export function isChargingTelemetry(
  snapshot: Pick<BydmateLiveSnapshotRow, "telemetry" | "diplus"> | null | undefined,
) {
  if (!snapshot) return false;
  const speedKmh = chargingCheckSpeedKmh(snapshot);
  if (speedKmh != null && speedKmh > DRIVING_SPEED_THRESHOLD_KMH) return false;
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
  // No snapshot at all means the car has never reported — that is "no contact", not
  // "parked". Claiming "parked" here invented a state we have no evidence for.
  if (!snapshot) return hasActiveSession ? "app_charging" : "stale";

  const fresh = isFreshLiveSnapshot(snapshot, nowMs, staleMs);
  if (fresh && isDrivingTelemetry(snapshot)) return "driving";
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

/** Tailwind text colour for the dashboard status badge. */
export function dashboardStatusBadgeClass(mode: DashboardVehicleMode) {
  switch (mode) {
    case "app_charging":
    case "live_charging":
      return "text-[var(--voltflow-green)]";
    case "driving":
      return "text-[var(--voltflow-cyan)]";
    case "stale":
      return "text-muted-foreground";
    default:
      return "text-[var(--voltflow-green)]";
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
