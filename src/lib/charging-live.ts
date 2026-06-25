import { isTelemetryCharging } from "./bydmate/telemetry-charging.ts";
import {
  costFromGridEnergy,
  energyFromGridKwh,
  energyNeededKwh,
  type ChargingParams,
  type DerivedChargingState,
} from "./charging-math.ts";
import type { BydmateLiveSnapshotRow } from "../types/database.ts";

export const LIVE_CHARGING_STALE_MS = 90_000;
/** Speed above this (km/h) treats the vehicle as driving, not finishing a charge. */
export const CHARGING_DRIVE_SPEED_KMH = 5;

/**
 * How often the foreground live-sync persists steady-state progress
 * (current_percent / energy / cost) back to `charging_sessions`, tiered by SOC.
 *
 * The live UI is recomputed every tick from `onDerived` regardless of this — the
 * persisted row only needs to be fresh enough for when the PWA is closed. So we
 * throttle the write the same way reads are tiered (see chargingSessionsRefetchInterval):
 *   <95%   → 30s (long flat phase, hours — SOC barely moves)
 *   95–98% → 5s  (approaching the tail)
 *   ≥98%   → 1s  (balance tail: fine resolution to catch exact completion)
 * Completion / drive-away writes are NOT throttled — they fire on the tick that
 * detects the event, independent of this interval.
 *
 * This turns a flat ~1Hz write (≈28.8k writes per 8h AC charge) into ~1k, with
 * no visible change. The 50ms slack mirrors the old `>= 950` persist guard so a
 * 1000ms tick still passes its own tier threshold.
 */
export function chargingPersistIntervalMs(currentPercent: number | null | undefined) {
  const pct = typeof currentPercent === "number" && Number.isFinite(currentPercent)
    ? currentPercent
    : 0;
  if (pct >= 98) return 1_000;
  if (pct >= 95) return 5_000;
  return 30_000;
}

/** Persist-cadence slack so a tick landing slightly early still clears its tier. */
export const CHARGING_PERSIST_SLACK_MS = 50;
/** When live SOC diverges from math/persisted progress beyond this, prefer live on persist. */
export const LIVE_SOC_RECONCILE_TOLERANCE_PERCENT = 1;

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function snapshotSoc(snapshot: BydmateLiveSnapshotRow | null | undefined) {
  const soc = finiteNumber(snapshot?.telemetry?.soc) ?? finiteNumber(snapshot?.diplus?.soc);
  return soc != null && soc >= 0 && soc <= 100 ? soc : null;
}

export function snapshotSpeedKmh(snapshot: BydmateLiveSnapshotRow | null | undefined) {
  const speed = finiteNumber(snapshot?.telemetry?.speed_kmh);
  return speed != null && speed >= 0 ? speed : null;
}

export function snapshotChargePowerKw(snapshot: BydmateLiveSnapshotRow | null | undefined) {
  const power = finiteNumber(snapshot?.telemetry?.charge_power_kw);
  return power != null && power > 0 ? power : null;
}

function positiveChargerKw(value: unknown): number | null {
  const power = finiteNumber(value);
  return power != null && power > 0 ? power : null;
}

/** Live Mate kW when > 0, else session/car defaults (Mate may send 0 while gun is connected). */
export function resolveDisplayChargePowerKw({
  snapshot,
  sessionChargerPowerKw,
  defaultChargerPowerKw,
}: {
  snapshot?: BydmateLiveSnapshotRow | null;
  sessionChargerPowerKw?: number | null;
  defaultChargerPowerKw?: number | null;
}): number | null {
  return (
    snapshotChargePowerKw(snapshot) ??
    positiveChargerKw(sessionChargerPowerKw) ??
    positiveChargerKw(defaultChargerPowerKw)
  );
}

export function isFreshChargingSnapshot(
  snapshot: BydmateLiveSnapshotRow | null | undefined,
  nowMs: number,
  staleMs = LIVE_CHARGING_STALE_MS,
) {
  if (!snapshot) return false;
  if (!isFreshLiveSnapshot(snapshot, nowMs, staleMs)) return false;
  if (isFreshSnapshotDriving(snapshot, nowMs)) return false;
  return isTelemetryCharging(snapshot.telemetry, snapshot);
}

export function isFreshLiveSnapshot(
  snapshot: BydmateLiveSnapshotRow | null | undefined,
  nowMs: number,
  staleMs = LIVE_CHARGING_STALE_MS,
) {
  if (!snapshot) return false;
  const receivedMs = Date.parse(snapshot.received_at);
  return Number.isFinite(receivedMs) && nowMs - receivedMs <= staleMs;
}

export function findFreshChargingSnapshot(
  snapshots: BydmateLiveSnapshotRow[],
  nowMs: number,
) {
  return snapshots.find((snapshot) => isFreshChargingSnapshot(snapshot, nowMs)) ?? null;
}

export function findFreshSocSnapshot(
  snapshots: BydmateLiveSnapshotRow[],
  nowMs: number,
) {
  return snapshots.find(
    (snapshot) => isFreshLiveSnapshot(snapshot, nowMs) && snapshotSoc(snapshot) != null,
  ) ?? null;
}

export function deriveLiveChargingState({
  snapshot,
  params,
  startedAtMs,
  nowMs,
  requireCharging = true,
}: {
  snapshot: BydmateLiveSnapshotRow | null | undefined;
  params: ChargingParams;
  startedAtMs: number;
  nowMs: number;
  requireCharging?: boolean;
}): DerivedChargingState | null {
  if (
    requireCharging
      ? !isFreshChargingSnapshot(snapshot, nowMs)
      : !isFreshLiveSnapshot(snapshot, nowMs)
  ) return null;

  const soc = snapshotSoc(snapshot);
  if (soc == null) return null;

  const currentPercent = Math.min(params.targetPercent, Math.max(params.startPercent, soc));
  const batteryEnergyKwh = energyNeededKwh(
    params.batteryCapacityKwh,
    params.startPercent,
    currentPercent,
  );
  const chargedEnergyKwh = energyFromGridKwh(batteryEnergyKwh, params.efficiencyPercent);
  const estimatedCost = costFromGridEnergy(chargedEnergyKwh, params.pricePerKwh);
  const elapsedSeconds = Math.max(0, (nowMs - startedAtMs) / 1000);
  const isComplete = soc >= params.targetPercent;
  const chargePowerKw = snapshotChargePowerKw(snapshot);
  const remainingGridEnergyKwh = energyFromGridKwh(
    energyNeededKwh(params.batteryCapacityKwh, currentPercent, params.targetPercent),
    params.efficiencyPercent,
  );

  return {
    currentPercent,
    chargedEnergyKwh,
    estimatedCost,
    elapsedSeconds,
    remainingSeconds:
      !isComplete && chargePowerKw != null
        ? (remainingGridEnergyKwh / chargePowerKw) * 3600
        : 0,
    isComplete,
  };
}

export function isFreshSnapshotDriving(
  snapshot: BydmateLiveSnapshotRow | null | undefined,
  nowMs: number,
  speedThresholdKmh = CHARGING_DRIVE_SPEED_KMH,
) {
  if (!isFreshLiveSnapshot(snapshot, nowMs)) return false;
  const speed = snapshotSpeedKmh(snapshot);
  return speed != null && speed > speedThresholdKmh;
}

/** Block live-based auto-complete when the car is moving or no longer on the charger. */
export function shouldBlockAutoComplete(
  snapshot: BydmateLiveSnapshotRow | null | undefined,
  nowMs: number,
) {
  if (!isFreshLiveSnapshot(snapshot, nowMs)) return true;
  if (isFreshSnapshotDriving(snapshot, nowMs)) return true;
  return !isTelemetryCharging(snapshot?.telemetry ?? {}, snapshot ?? undefined);
}

/** Allow math-based auto-complete only while Mate live SOC is stale (>90s) or absent. */
export function shouldAllowMathAutoComplete(
  snapshot: BydmateLiveSnapshotRow | null | undefined,
  nowMs: number,
) {
  return !isFreshLiveSnapshot(snapshot, nowMs);
}

/** Auto-stop when fresh telemetry shows the vehicle left the charger while driving. */
export function shouldAutoStopOnDriveAway(
  snapshot: BydmateLiveSnapshotRow | null | undefined,
  nowMs: number,
) {
  return isFreshSnapshotDriving(snapshot, nowMs);
}
