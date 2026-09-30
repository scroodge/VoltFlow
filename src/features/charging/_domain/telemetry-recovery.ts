import { efficiencyPercentForTariff } from "@/lib/charging-efficiency";
import { resolveTariffTypeByPower } from "@/lib/charging-tariffs";
import type { Car, ChargingTariffType, VoltflowMateTelemetry } from "@/types/database";
import {
  finiteTelemetryNumber,
  isMateAutoSessionCharging,
  sanitizeChargerPowerKw,
  telemetrySpeedKmh,
} from "./telemetry-charging";

export type RecoveryTelemetrySample = {
  device_time: string;
  telemetry: VoltflowMateTelemetry;
};

export type TelemetryRecoveryCandidate = {
  key: string;
  startedAt: string;
  stoppedAt: string;
  startPercent: number;
  endPercent: number;
  chargerPowerKw: number;
  tariffType: ChargingTariffType;
  efficiencyPercent: number;
  chargedEnergyKwh: number;
};

const MIN_SAMPLES = 4;
const MAX_DURATION_MS = 24 * 60 * 60_000;
// Match the live auto-start freshness window: retained samples separated by more
// than this cannot safely be considered one continuous charging event.
const MAX_INTER_SAMPLE_GAP_MS = 3 * 60_000;

function median(values: number[]) {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1]! + ordered[middle]!) / 2
    : ordered[middle]!;
}

function candidateFromRun(
  car: Car,
  run: RecoveryTelemetrySample[],
  stoppedAt: string,
): TelemetryRecoveryCandidate | null {
  if (run.length < MIN_SAMPLES) return null;
  const startedAt = run[0]!.device_time;
  const startMs = Date.parse(startedAt);
  const stoppedMs = Date.parse(stoppedAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(stoppedMs) || stoppedMs <= startMs || stoppedMs - startMs > MAX_DURATION_MS) {
    return null;
  }

  const startPercent = finiteTelemetryNumber(run[0]!.telemetry.soc);
  const endPercent = finiteTelemetryNumber(run.at(-1)!.telemetry.soc);
  if (startPercent == null || endPercent == null || endPercent <= startPercent || endPercent > 100) return null;

  const rawPowers = run
    .map((sample) => finiteTelemetryNumber(sample.telemetry.charge_power_kw))
    .filter((power): power is number => power != null && power > 0.1);
  if (!rawPowers.length) return null;
  const medianPower = median(rawPowers);
  const chargeType = run.find((sample) => typeof sample.telemetry.charge_type === "string")?.telemetry.charge_type;
  const chargerPowerKw = sanitizeChargerPowerKw(
    medianPower,
    typeof chargeType === "string" ? chargeType.toUpperCase() : null,
    car.default_charger_power_kw,
  );
  const tariffType = resolveTariffTypeByPower(chargerPowerKw);
  const efficiencyPercent = efficiencyPercentForTariff(car, tariffType);
  const chargedEnergyKwh =
    ((endPercent - startPercent) / 100 * car.battery_capacity_kwh) /
    (efficiencyPercent / 100);
  if (!Number.isFinite(chargedEnergyKwh) || chargedEnergyKwh <= 0) return null;

  return {
    // Inputs are trusted server-side telemetry timestamps. This is an idempotency key, not a secret.
    key: `${startedAt}:${stoppedAt}`,
    startedAt,
    stoppedAt,
    startPercent,
    endPercent,
    chargerPowerKw,
    tariffType,
    efficiencyPercent,
    chargedEnergyKwh,
  };
}

/**
 * Finds closed, conservative historical-charge candidates in already retained telemetry.
 * It deliberately requires an explicit following non-charging sample, so an unplugged
 * telemetry tail or a still-active real session can never be imported as completed history.
 */
export function findTelemetryRecoveryCandidates(
  car: Car,
  samples: readonly RecoveryTelemetrySample[],
): TelemetryRecoveryCandidate[] {
  const ordered = [...samples]
    .filter((sample) => Number.isFinite(Date.parse(sample.device_time)))
    .sort((a, b) => Date.parse(a.device_time) - Date.parse(b.device_time));
  const candidates: TelemetryRecoveryCandidate[] = [];
  let run: RecoveryTelemetrySample[] = [];
  let previousChargingMs: number | null = null;

  for (const sample of ordered) {
    const charging = isMateAutoSessionCharging(
      sample.telemetry,
      telemetrySpeedKmh(sample.telemetry),
    );
    if (charging) {
      const sampleMs = Date.parse(sample.device_time);
      if (
        previousChargingMs != null &&
        sampleMs - previousChargingMs > MAX_INTER_SAMPLE_GAP_MS
      ) {
        // No explicit stop was observed for the preceding run, so discard it
        // rather than invent a completed historical session.
        run = [];
      }
      run.push(sample);
      previousChargingMs = sampleMs;
      continue;
    }

    const candidate = candidateFromRun(car, run, sample.device_time);
    if (candidate) candidates.push(candidate);
    run = [];
    previousChargingMs = null;
  }

  return candidates;
}
