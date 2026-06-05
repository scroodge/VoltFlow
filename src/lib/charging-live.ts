import { isTelemetryCharging } from "./bydmate/telemetry-charging.ts";
import {
  costFromGridEnergy,
  energyFromGridKwh,
  energyNeededKwh,
  type ChargingParams,
  type DerivedChargingState,
} from "@/lib/charging-math";
import type { BydmateLiveSnapshotRow } from "@/types/database";

export const LIVE_CHARGING_STALE_MS = 90_000;
/** Speed above this (km/h) treats the vehicle as driving, not finishing a charge. */
export const CHARGING_DRIVE_SPEED_KMH = 5;
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

export function isFreshChargingSnapshot(
  snapshot: BydmateLiveSnapshotRow | null | undefined,
  nowMs: number,
  staleMs = LIVE_CHARGING_STALE_MS,
) {
  if (!snapshot) return false;
  if (!isFreshLiveSnapshot(snapshot, nowMs, staleMs)) return false;
  if (isFreshSnapshotDriving(snapshot, nowMs)) return false;
  return isTelemetryCharging(snapshot.telemetry);
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
  return !isTelemetryCharging(snapshot?.telemetry ?? {});
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
