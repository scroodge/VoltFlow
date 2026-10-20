import type { LateRecoveryWindow } from "../_domain/late-delivery-window.ts";
import {
  findTelemetryRecoveryCandidates,
  startsMidCharge,
  withoutLeadingChargingRun,
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

// A car offline while parked uploads a whole overnight charge hours later, in batches. The
// batch that finally closes it scans only the window's lookback, so a long charge used to be
// cut at the range start (observed: 26 % → 100 % over 19 h stored as 52 % → 100 % over 12 h).
// Step back until a non-charging reading bounds the run; 2 × 12 h covers the detector's 24 h cap.
const EXTEND_STEP_MS = 12 * 60 * 60_000;
const MAX_EXTEND_STEPS = 2;

/** The window's samples, extended back so a charge never starts at the range boundary. */
async function loadFromChargeStart(
  window: LateRecoveryWindow,
  ports: LateChargeRecoveryPorts,
): Promise<RecoveryTelemetrySample[] | null> {
  let samples = await ports.loadSamples(
    window.vehicleId,
    window.fromIso,
    window.toIso,
  );
  let fromMs = Date.parse(window.fromIso);
  for (
    let step = 0;
    samples && startsMidCharge(samples) && step < MAX_EXTEND_STEPS;
    step += 1
  ) {
    const earlierFromMs = fromMs - EXTEND_STEP_MS;
    const earlier = await ports.loadSamples(
      window.vehicleId,
      new Date(earlierFromMs).toISOString(),
      new Date(fromMs).toISOString(),
    );
    if (!earlier) return null;
    // Both reads include the shared boundary instant; keep it once.
    samples = [
      ...earlier.filter((sample) => Date.parse(sample.device_time) < fromMs),
      ...samples,
    ];
    fromMs = earlierFromMs;
  }
  return samples && withoutLeadingChargingRun(samples);
}

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
    const samples = await loadFromChargeStart(window, ports);
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
