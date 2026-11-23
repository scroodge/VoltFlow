import type { ChargingSessionRow } from "../../../types/database.ts";
import { deriveSessionProgressFromSoc } from "../_domain/charging-math.ts";
import {
  AUTO_CHARGING_DRIVE_STOP_SPEED_KMH,
  chargeGunStateIndicatesCharging,
  finiteTelemetryNumber,
  TELEMETRY_CHARGE_POWER_THRESHOLD_KW,
} from "../_domain/telemetry-charging.ts";
import { recoveredSessionStopMs, type TelemetrySampleRow } from "./charging-session-reconcile-logic.ts";

export const CONTINUATION_PAUSE_MS = 5 * 60_000;
const MAX_SAMPLE_GAP_MS = 90_000;

export type ContinuationSample = TelemetrySampleRow & { diplus_charge_gun_state: number | string | null };

function isUneditedClosedSession(row: ChargingSessionRow) {
  return (row.status === "stopped" || row.status === "completed") &&
    !row.manual_entry && !row.energy_overridden && !row.tariff_manual &&
    row.energy_corrected_at == null && row.tariff_selected_at == null;
}

export function chargingContinuationBounds(first: ChargingSessionRow, next: ChargingSessionRow) {
  if (!isUneditedClosedSession(first) || !isUneditedClosedSession(next) ||
      (next.session_origin !== "legacy" && next.session_origin !== "telemetry_recovered") ||
      first.user_id !== next.user_id || first.car_id !== next.car_id ||
      first.battery_capacity_kwh !== next.battery_capacity_kwh ||
      first.efficiency_percent !== next.efficiency_percent ||
      first.price_per_kwh !== next.price_per_kwh ||
      first.target_percent !== next.target_percent ||
      first.tariff_type !== next.tariff_type || first.provider_type !== next.provider_type ||
      first.user_provider_id !== next.user_provider_id) return null;

  const firstStopMs = recoveredSessionStopMs(first);
  const nextStartMs = Date.parse(next.started_at ?? "");
  const nextStopMs = recoveredSessionStopMs(next) ?? Date.parse(next.stopped_at ?? "");
  if (firstStopMs == null || nextStartMs < firstStopMs ||
      nextStartMs - firstStopMs > CONTINUATION_PAUSE_MS || !(nextStopMs > nextStartMs)) return null;
  return { firstStopMs, nextStartMs, nextStopMs };
}

function isPowered(sample: ContinuationSample) {
  const power = finiteTelemetryNumber(sample.telemetry?.charge_power_kw);
  const speed = finiteTelemetryNumber(sample.telemetry?.speed_kmh);
  return power != null && power > TELEMETRY_CHARGE_POWER_THRESHOLD_KW &&
    speed != null && speed <= AUTO_CHARGING_DRIVE_STOP_SPEED_KMH;
}

export function planChargingContinuation(
  first: ChargingSessionRow,
  next: ChargingSessionRow,
  bridgeSamples: readonly ContinuationSample[],
  endSamples: readonly ContinuationSample[],
) {
  const bounds = chargingContinuationBounds(first, next);
  if (!bounds) return null;
  const { firstStopMs, nextStartMs, nextStopMs } = bounds;
  const bridge = [...bridgeSamples].sort((a, b) => Date.parse(a.device_time) - Date.parse(b.device_time));
  const beforePause = bridge.findLast((sample) => Date.parse(sample.device_time) <= firstStopMs && isPowered(sample));
  const resumed = bridge.find((sample) => Date.parse(sample.device_time) === nextStartMs && isPowered(sample));
  if (!beforePause || !resumed || firstStopMs - Date.parse(beforePause.device_time) > MAX_SAMPLE_GAP_MS) return null;

  const pauseSoc = finiteTelemetryNumber(beforePause.telemetry?.soc);
  const resumedSoc = finiteTelemetryNumber(resumed.telemetry?.soc);
  if (pauseSoc == null || pauseSoc <= first.start_percent || resumedSoc !== next.start_percent) return null;

  let previousMs = Date.parse(beforePause.device_time);
  let previousSoc = pauseSoc;
  let confirmedPause = false;
  for (const sample of bridge) {
    const measuredMs = Date.parse(sample.device_time);
    if (measuredMs <= previousMs || measuredMs > nextStartMs) continue;
    const speed = finiteTelemetryNumber(sample.telemetry?.speed_kmh);
    const power = finiteTelemetryNumber(sample.telemetry?.charge_power_kw);
    const soc = finiteTelemetryNumber(sample.telemetry?.soc);
    const powered = isPowered(sample);
    if (measuredMs - previousMs > MAX_SAMPLE_GAP_MS || speed == null ||
        speed > AUTO_CHARGING_DRIVE_STOP_SPEED_KMH ||
        soc == null || soc < previousSoc ||
        (!powered && (!chargeGunStateIndicatesCharging(sample.diplus_charge_gun_state) || soc !== previousSoc))) return null;
    confirmedPause ||= power === 0;
    previousMs = measuredMs;
    previousSoc = soc;
  }
  if (!confirmedPause) return null;

  const end = [...endSamples]
    .filter((sample) => {
      const measuredMs = Date.parse(sample.device_time);
      return measuredMs > nextStartMs && measuredMs <= nextStopMs && isPowered(sample);
    })
    .sort((a, b) => Date.parse(b.device_time) - Date.parse(a.device_time))[0];
  const endSoc = finiteTelemetryNumber(end?.telemetry?.soc);
  if (!end || endSoc == null || endSoc <= next.start_percent || endSoc > first.target_percent ||
      nextStopMs - Date.parse(end.device_time) > CONTINUATION_PAUSE_MS) return null;

  // SOC is stable during the evidenced pauses, so end minus start counts the
  // measured gains once, including a short powered run between the stored rows.
  const progress = deriveSessionProgressFromSoc({
    startPercent: first.start_percent, targetPercent: first.target_percent,
    batteryCapacityKwh: first.battery_capacity_kwh, chargerPowerKw: first.charger_power_kw,
    efficiencyPercent: first.efficiency_percent, pricePerKwh: first.price_per_kwh,
  }, endSoc);
  const stoppedAt = end.device_time;
  return {
    current_percent: progress.currentPercent,
    charged_energy_kwh: progress.chargedEnergyKwh,
    estimated_cost: progress.estimatedCost,
    stopped_at: stoppedAt,
    status: endSoc === first.target_percent ? "completed" : "stopped",
    recovery_key: `${first.started_at}:${stoppedAt}`,
  };
}
