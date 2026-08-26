import { gearIsPark, readGear } from "@/lib/voltflowmate/gear";
import { isTelemetryCharging } from "@/features/charging/domain";
import type { VoltflowMateLiveSnapshotRow } from "@/types/database";
import {
  auxCommandBlockVoltage,
  type AuxBatteryChemistry,
} from "@/lib/vehicle/aux-battery-chemistry";

export { gearIsPark, readGear };

export const VEHICLE_CONTROL_STALE_MS = 90_000;
export function isTelemetryFresh(snapshot: VoltflowMateLiveSnapshotRow | undefined) {
  if (!snapshot) return false;
  const receivedAt = new Date(snapshot.received_at).getTime();
  return !Number.isNaN(receivedAt) && Date.now() - receivedAt <= VEHICLE_CONTROL_STALE_MS;
}

export function readSentryProvider(snapshot: VoltflowMateLiveSnapshotRow | undefined) {
  const diplus = snapshot?.diplus as Record<string, unknown> | undefined;
  const provider = diplus?.sentry_provider;
  return typeof provider === "string" ? provider : "diplus";
}

export function isSentryReady(snapshot: VoltflowMateLiveSnapshotRow | undefined) {
  const diplus = snapshot?.diplus as Record<string, unknown> | undefined;
  if (!diplus) return false;
  const provider = readSentryProvider(snapshot);
  if (provider === "overdrive") {
    return diplus.sentry_active === true;
  }
  const stall = diplus.stall_sentry_mode;
  return stall != null && stall !== "关闭" && stall !== "";
}

export function readSpeed(snapshot: VoltflowMateLiveSnapshotRow | undefined) {
  const fromDiplus = snapshot?.diplus?.speed_kmh;
  const fromTelemetry = snapshot?.telemetry?.speed_kmh;
  return Number(fromDiplus ?? fromTelemetry ?? 0);
}

export function readAuxVoltage(snapshot: VoltflowMateLiveSnapshotRow | undefined) {
  const candidates = [
    snapshot?.telemetry?.aux_voltage_v,
    snapshot?.diplus_voltage_12v,
    snapshot?.diplus?.voltage_12v,
  ];
  for (const candidate of candidates) {
    const voltage = typeof candidate === "number" ? candidate : Number(candidate);
    if (Number.isFinite(voltage) && voltage >= 6 && voltage <= 18) return voltage;
  }
  return null;
}

/** Parked (P) or plugged in and stationary — windows/climate OK while charging. */
export function isStationaryForRemoteControl(snapshot: VoltflowMateLiveSnapshotRow | undefined) {
  if (!snapshot) return false;
  if (readSpeed(snapshot) > 0) return false;
  if (gearIsPark(readGear(snapshot))) return true;
  return isTelemetryCharging(snapshot.telemetry, snapshot);
}

export function isControlAllowed(
  snapshot: VoltflowMateLiveSnapshotRow | undefined,
  chemistry: AuxBatteryChemistry = "other",
) {
  if (!snapshot) return false;
  const receivedAt = new Date(snapshot.received_at).getTime();
  if (Number.isNaN(receivedAt) || Date.now() - receivedAt > VEHICLE_CONTROL_STALE_MS) {
    return false;
  }
  if (!isStationaryForRemoteControl(snapshot)) return false;
  const aux = readAuxVoltage(snapshot);
  if (aux != null && aux < auxCommandBlockVoltage(chemistry)) return false;
  return true;
}

export function isRemoteReady(
  snapshot: VoltflowMateLiveSnapshotRow | undefined,
  chemistry: AuxBatteryChemistry = "other",
) {
  if (!isTelemetryFresh(snapshot)) return false;
  if (!isStationaryForRemoteControl(snapshot)) return false;
  const aux = readAuxVoltage(snapshot);
  if (aux != null && aux < auxCommandBlockVoltage(chemistry)) return false;
  return isSentryReady(snapshot);
}
