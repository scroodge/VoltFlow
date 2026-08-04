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

/**
 * How long after the last contact a car still counts as merely **asleep** rather than out of
 * contact.
 *
 * A locked car's head unit is suspended by the platform and only reports on its own wake rhythm —
 * measured at ~900 s per wake across the fleet on 2026-08-03, with most cars showing 80%+ of their
 * long gaps in a 14-16 min band. Everything inside that window is a car reporting *normally for a
 * suspended device*, so calling it "offline" is what made a healthy car look broken. 20 minutes is
 * the measured rhythm plus headroom for jitter.
 *
 * Deliberately separate from [LIVE_SNAPSHOT_STALE_MS]: that 90 s threshold still decides whether a
 * reading may be *trusted as live* (comfort controls, charging priority) and must not be relaxed to
 * paper over a sleep window. This one only decides how the gap is *explained* to the user.
 */
export const LIVE_SNAPSHOT_ASLEEP_MS = 20 * 60_000;

export type DashboardVehicleMode =
  | "app_charging"
  | "live_charging"
  | "driving"
  | "parked"
  | "asleep"
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

/**
 * When the server last heard from this car, or null if it never has. This is `received_at`, not
 * `device_time`: the question the UI answers is "when did contact last happen", and a batch flushed
 * late carries old device times but is still real contact at flush time.
 */
export function lastContactAtMs(snapshot: BydmateLiveSnapshotRow | null | undefined): number | null {
  if (!snapshot) return null;
  const receivedMs = Date.parse(snapshot.received_at);
  return Number.isFinite(receivedMs) ? receivedMs : null;
}

/**
 * Past the live threshold but still within the platform's sleep rhythm — the car is suspended, not
 * lost. A future-dated snapshot (clock skew) counts as asleep rather than out of contact: it is
 * evidence of contact, just not usable as a live reading.
 */
export function isAsleepLiveSnapshot(
  snapshot: BydmateLiveSnapshotRow | null | undefined,
  nowMs: number,
  asleepMs = LIVE_SNAPSHOT_ASLEEP_MS,
) {
  const receivedMs = lastContactAtMs(snapshot);
  if (receivedMs == null) return false;
  return nowMs - receivedMs <= asleepMs;
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
  asleepMs = LIVE_SNAPSHOT_ASLEEP_MS,
}: {
  snapshot: BydmateLiveSnapshotRow | null | undefined;
  nowMs: number;
  hasActiveSession: boolean;
  staleMs?: number;
  asleepMs?: number;
}): DashboardVehicleMode {
  // No snapshot at all means the car has never reported — that is "no contact", not
  // "parked". Claiming "parked" here invented a state we have no evidence for.
  if (!snapshot) return hasActiveSession ? "app_charging" : "stale";

  const fresh = isFreshLiveSnapshot(snapshot, nowMs, staleMs);
  if (fresh && isDrivingTelemetry(snapshot)) return "driving";
  if (hasActiveSession) return "app_charging";
  // Past the live threshold. A car on the platform's ~15 min suspend rhythm is asleep, not lost —
  // reporting it as "no contact" is what made a healthy locked car look broken to the owner.
  if (!fresh) return isAsleepLiveSnapshot(snapshot, nowMs, asleepMs) ? "asleep" : "stale";
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
    case "asleep":
      return "dashboard.statusAsleep";
    case "stale":
      return "dashboard.statusStale";
    case "parked":
    default:
      return "dashboard.statusParking";
  }
}

export function vehicleStatusLabelKey(mode: DashboardVehicleMode): TranslationKey {
  switch (mode) {
    case "asleep":
      return "vehicle.status.asleep";
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
    // Asleep is a normal resting state, not a fault: muted like stale, but the label and the
    // last-contact line are what tell the two apart.
    case "asleep":
    case "stale":
      return "text-muted-foreground";
    default:
      return "text-[var(--voltflow-green)]";
  }
}

export function canStartChargingSession(mode: DashboardVehicleMode) {
  return (
    mode === "parked" || mode === "asleep" || mode === "stale" || mode === "live_charging"
  );
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
