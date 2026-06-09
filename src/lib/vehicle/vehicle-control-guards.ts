import { isTelemetryCharging } from "@/lib/bydmate/telemetry-charging";
import type { BydmateLiveSnapshotRow } from "@/types/database";

export const VEHICLE_CONTROL_STALE_MS = 90_000;
export const VEHICLE_CONTROL_LOW_AUX_V = 11.8;

export function isTelemetryFresh(snapshot: BydmateLiveSnapshotRow | undefined) {
  if (!snapshot) return false;
  const receivedAt = new Date(snapshot.received_at).getTime();
  return !Number.isNaN(receivedAt) && Date.now() - receivedAt <= VEHICLE_CONTROL_STALE_MS;
}

export function readSentryProvider(snapshot: BydmateLiveSnapshotRow | undefined) {
  const diplus = snapshot?.diplus as Record<string, unknown> | undefined;
  const provider = diplus?.sentry_provider;
  return typeof provider === "string" ? provider : "diplus";
}

export function isSentryReady(snapshot: BydmateLiveSnapshotRow | undefined) {
  const diplus = snapshot?.diplus as Record<string, unknown> | undefined;
  if (!diplus) return false;
  const provider = readSentryProvider(snapshot);
  if (provider === "overdrive") {
    return diplus.sentry_active === true;
  }
  const stall = diplus.stall_sentry_mode;
  return stall != null && stall !== "关闭" && stall !== "";
}

export function gearIsPark(gear: unknown) {
  if (gear === 1 || gear === "1" || gear === "P") return true;
  return false;
}

export function readSpeed(snapshot: BydmateLiveSnapshotRow | undefined) {
  const fromDiplus = snapshot?.diplus?.speed_kmh;
  const fromTelemetry = snapshot?.telemetry?.speed_kmh;
  return Number(fromDiplus ?? fromTelemetry ?? 0);
}

export function readGear(snapshot: BydmateLiveSnapshotRow | undefined) {
  return snapshot?.diplus?.gear ?? null;
}

export function readAuxVoltage(snapshot: BydmateLiveSnapshotRow | undefined) {
  return snapshot?.diplus?.voltage_12v ?? snapshot?.telemetry?.aux_voltage_v ?? null;
}

/** Parked (P) or plugged in and stationary — windows/climate OK while charging. */
export function isStationaryForRemoteControl(snapshot: BydmateLiveSnapshotRow | undefined) {
  if (!snapshot) return false;
  if (readSpeed(snapshot) > 0) return false;
  if (gearIsPark(readGear(snapshot))) return true;
  return isTelemetryCharging(snapshot.telemetry);
}

export function isControlAllowed(snapshot: BydmateLiveSnapshotRow | undefined) {
  if (!snapshot) return false;
  const receivedAt = new Date(snapshot.received_at).getTime();
  if (Number.isNaN(receivedAt) || Date.now() - receivedAt > VEHICLE_CONTROL_STALE_MS) {
    return false;
  }
  if (!isStationaryForRemoteControl(snapshot)) return false;
  const aux = readAuxVoltage(snapshot);
  if (aux != null && aux > 0 && aux < VEHICLE_CONTROL_LOW_AUX_V) return false;
  return true;
}

export function isRemoteReady(snapshot: BydmateLiveSnapshotRow | undefined) {
  if (!isTelemetryFresh(snapshot)) return false;
  if (!isStationaryForRemoteControl(snapshot)) return false;
  const aux = readAuxVoltage(snapshot);
  if (aux != null && aux > 0 && aux < VEHICLE_CONTROL_LOW_AUX_V) return false;
  return isSentryReady(snapshot);
}
