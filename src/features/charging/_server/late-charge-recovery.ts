import type { LateRecoveryWindow } from "../_domain/late-delivery-window.ts";
import {
  findTelemetryRecoveryCandidates,
  type RecoveryTelemetrySample,
  type TelemetryRecoveryCandidate,
} from "../_domain/telemetry-recovery.ts";
import type { Car } from "@/types/database";
import type { InsertRecoveredResult } from "./telemetry-recovery-insert.ts";

export type LateChargeRecoveryPorts = {
  loadCar(vehicleId: string): Promise<Car | null>;
  /** `null` = the range cannot be read completely; a partial read could split a run. */
  loadSamples(
    vehicleId: string,
    fromIso: string,
    toIso: string,
  ): Promise<RecoveryTelemetrySample[] | null>;
  insert(
    car: Car,
    candidate: TelemetryRecoveryCandidate,
  ): Promise<InsertRecoveredResult>;
};

export type LateChargeRecoveryResult = {
  recovered: number;
  sessionIds: string[];
  errors: string[];
};

/**
 * Turns charges that reached the server late into history. The live planner refuses
 * measurements older than its start window by design, so a burst flushed after the car
 * woke can never open a session; the closed-window detector recovers those from the
 * persisted samples instead. A charge still open at the end of the range has no explicit
 * end yet and is never imported here. Idempotent: the insert skips overlaps and known keys.
 */
export async function recoverLateCharges(
  windows: readonly LateRecoveryWindow[],
  ports: LateChargeRecoveryPorts,
): Promise<LateChargeRecoveryResult> {
  const result: LateChargeRecoveryResult = {
    recovered: 0,
    sessionIds: [],
    errors: [],
  };
  for (const window of windows) {
    const car = await ports.loadCar(window.vehicleId);
    if (!car) continue;
    const samples = await ports.loadSamples(
      window.vehicleId,
      window.fromIso,
      window.toIso,
    );
    if (!samples) {
      result.errors.push(
        `telemetry range for ${window.vehicleId} is too large to scan safely`,
      );
      continue;
    }
    for (const candidate of findTelemetryRecoveryCandidates(car, samples)) {
      const inserted = await ports.insert(car, candidate);
      if (inserted.ok) {
        result.recovered += 1;
        result.sessionIds.push(inserted.sessionId);
      } else if (inserted.code !== "overlap" && inserted.code !== "duplicate") {
        result.errors.push(inserted.error);
      }
    }
  }
  return result;
}
