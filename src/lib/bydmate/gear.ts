import type { BydmateLiveSnapshotRow, BydmateTelemetryPointRow } from "@/types/database";

/** Align with Mate ingest / charging-live drive-away threshold. */
export const DRIVING_SPEED_THRESHOLD_KMH = 5;

export type NormalizedDiplusGear = "P" | "R" | "N" | "D" | null;

type GearSnapshot = Pick<BydmateLiveSnapshotRow, "telemetry" | "diplus" | "diplus_gear">;

export function normalizeDiplusGear(value: string | number | null | undefined): NormalizedDiplusGear {
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

export function readGear(snapshot: GearSnapshot | BydmateTelemetryPointRow | null | undefined) {
  if (!snapshot) return null;
  const fromDiplus = snapshot.diplus?.gear;
  if (fromDiplus != null) return fromDiplus;
  const fromColumn = snapshot.diplus_gear;
  if (fromColumn != null) return fromColumn;
  return null;
}

export function gearIsPark(gear: unknown) {
  if (gear === 1 || gear === "1" || gear === "P" || gear === "p") return true;
  return normalizeDiplusGear(gear as string | number | null | undefined) === "P";
}

export function gearIsDrive(gear: unknown) {
  const normalized = normalizeDiplusGear(gear as string | number | null | undefined);
  return normalized === "D" || normalized === "R" || normalized === "N";
}

function finiteSpeedKmh(snapshot: GearSnapshot | null | undefined) {
  const fromTelemetry = snapshot?.telemetry.speed_kmh;
  if (typeof fromTelemetry === "number" && Number.isFinite(fromTelemetry)) return fromTelemetry;
  const fromDiplus = snapshot?.diplus?.speed_kmh;
  if (typeof fromDiplus === "number" && Number.isFinite(fromDiplus)) return fromDiplus;
  return null;
}

/** D/R/N, or unknown gear with speed above threshold. */
export function isDriveTelemetry(snapshot: GearSnapshot | null | undefined) {
  if (!snapshot) return false;

  const gear = readGear(snapshot);
  if (gearIsDrive(gear)) return true;
  if (gear != null && gearIsPark(gear)) return false;

  const speedKmh = finiteSpeedKmh(snapshot);
  return speedKmh != null && speedKmh > DRIVING_SPEED_THRESHOLD_KMH;
}

/** Explicit P, or unknown gear with speed at/below threshold. */
export function isParkStateTelemetry(snapshot: GearSnapshot | null | undefined) {
  if (!snapshot) return false;

  const gear = readGear(snapshot);
  if (gearIsPark(gear)) return true;
  if (gear != null && gearIsDrive(gear)) return false;

  const speedKmh = finiteSpeedKmh(snapshot);
  return speedKmh == null || speedKmh <= DRIVING_SPEED_THRESHOLD_KMH;
}
