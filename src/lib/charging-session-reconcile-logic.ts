import {
  costFromGridEnergy,
  deriveSessionProgressFromSoc,
  energyFromGridKwh,
  type ChargingParams,
} from "./charging-math.ts";

const CHARGE_POWER_THRESHOLD_KW = 0.1;

function isAcWallboxCharging(telemetry: Record<string, unknown>) {
  const chargePowerKw =
    finiteTelemetryNumber(telemetry.charge_power_kw) ?? finiteTelemetryNumber(telemetry.power_kw);
  if (chargePowerKw != null && chargePowerKw > CHARGE_POWER_THRESHOLD_KW) {
    return true;
  }
  if (telemetry.is_charging !== true) return false;
  const soc = finiteTelemetryNumber(telemetry.soc);
  if (soc != null && soc >= 100) return false;
  return chargePowerKw != null && chargePowerKw > CHARGE_POWER_THRESHOLD_KW;
}

export type ReconcileChargingSession = {
  start_percent: number;
  current_percent: number;
  target_percent: number;
  battery_capacity_kwh: number;
  charger_power_kw: number;
  efficiency_percent: number;
  price_per_kwh: number;
  energy_overridden: boolean;
  charged_energy_kwh: number;
  estimated_cost: number;
  status: string;
  started_at: string | null;
  stopped_at: string | null;
};

const RECONCILE_LOOKBACK_DAYS = 14;
const TELEMETRY_SOC_TOLERANCE = 0.5;

export { RECONCILE_LOOKBACK_DAYS, TELEMETRY_SOC_TOLERANCE };

/** Mate telemetry/live SOC is truth; persisted wall-clock fields are not used here. */
export function measuredSocFromMate(
  session: Pick<ReconcileChargingSession, "start_percent" | "target_percent">,
  summary: Pick<ReturnType<typeof summarizeSessionTelemetry>, "maxSoc">,
  liveSoc: number | null,
): number {
  return Math.max(session.start_percent, liveSoc ?? 0, summary.maxSoc);
}

function storedProgressMismatch(session: ReconcileChargingSession): boolean {
  const soc = Math.min(
    session.target_percent,
    Math.max(session.start_percent, session.current_percent),
  );
  const expected = deriveSessionProgressFromSoc(chargingParamsFromSession(session), soc);
  return (
    Math.abs(session.charged_energy_kwh - expected.chargedEnergyKwh) > 0.05 ||
    Math.abs(session.estimated_cost - expected.estimatedCost) > 0.05
  );
}

export type TelemetrySampleRow = {
  device_time: string;
  telemetry: Record<string, unknown> | null;
};

function chargingParamsFromSession(row: ReconcileChargingSession): ChargingParams {
  return {
    startPercent: row.start_percent,
    targetPercent: row.target_percent,
    batteryCapacityKwh: row.battery_capacity_kwh,
    chargerPowerKw: row.charger_power_kw,
    efficiencyPercent: row.efficiency_percent,
    pricePerKwh: row.price_per_kwh,
  };
}

function finiteTelemetryNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function socFromTelemetry(telemetry: Record<string, unknown> | null | undefined) {
  const soc = finiteTelemetryNumber(telemetry?.soc);
  return soc != null && soc >= 0 && soc <= 100 ? soc : null;
}

export function sessionNeedsReconcile(session: ReconcileChargingSession, nowMs: number): boolean {
  if (session.energy_overridden) return false;
  if (!session.started_at) return false;
  const startMs = Date.parse(session.started_at);
  if (!Number.isFinite(startMs)) return false;
  if (nowMs - startMs > RECONCILE_LOOKBACK_DAYS * 86_400_000) return false;

  const stoppedMs = session.stopped_at ? Date.parse(session.stopped_at) : null;
  if (stoppedMs != null && Number.isFinite(stoppedMs) && stoppedMs < startMs) {
    return true;
  }

  if (session.status === "charging") return false;

  if (session.charged_energy_kwh <= 0) return true;
  if (storedProgressMismatch(session)) return true;

  if (
    session.status === "completed" &&
    session.current_percent + TELEMETRY_SOC_TOLERANCE >= session.target_percent
  ) {
    return false;
  }

  const noEnergy =
    session.charged_energy_kwh <= 0 &&
    session.current_percent <= session.start_percent + TELEMETRY_SOC_TOLERANCE;
  const belowTarget = session.current_percent + TELEMETRY_SOC_TOLERANCE < session.target_percent;

  return noEnergy || belowTarget;
}

export function summarizeSessionTelemetry(
  samples: TelemetrySampleRow[],
  session: ReconcileChargingSession,
) {
  let maxSoc = session.start_percent;
  let minSoc = session.start_percent;
  let firstAcChargeAt: string | null = null;
  let firstTargetSocAt: string | null = null;
  let lastAcChargeAt: string | null = null;
  let lastSocAt: string | null = null;
  // BMS-measured per-session energy (battery-side kWh) seen across the window. The
  // counter is monotonic within a charging session, so its max is the energy added —
  // robust to its intermittency (only ~10% of samples carry it). null = never seen.
  let maxKwhCharged: number | null = null;

  for (const row of samples) {
    const soc = socFromTelemetry(row.telemetry);
    if (soc != null) {
      maxSoc = Math.max(maxSoc, soc);
      minSoc = Math.min(minSoc, soc);
      lastSocAt = row.device_time;
      if (soc + TELEMETRY_SOC_TOLERANCE >= session.target_percent && !firstTargetSocAt) {
        firstTargetSocAt = row.device_time;
      }
    }
    const kwhCharged = finiteTelemetryNumber(row.telemetry?.kwh_charged);
    if (kwhCharged != null && kwhCharged > 0) {
      maxKwhCharged = Math.max(maxKwhCharged ?? 0, kwhCharged);
    }
    if (row.telemetry && isAcWallboxCharging(row.telemetry)) {
      if (!firstAcChargeAt) firstAcChargeAt = row.device_time;
      lastAcChargeAt = row.device_time;
    }
  }

  return {
    maxSoc,
    minSoc,
    firstAcChargeAt,
    firstTargetSocAt,
    lastAcChargeAt,
    lastSocAt,
    maxKwhCharged,
  };
}

export function buildReconciledSessionPatch({
  session,
  summary,
  liveSoc,
  nowMs,
}: {
  session: ReconcileChargingSession;
  summary: ReturnType<typeof summarizeSessionTelemetry>;
  liveSoc: number | null;
  nowMs: number;
}) {
  const startMs = Date.parse(session.started_at!);
  const measuredSoc = measuredSocFromMate(session, summary, liveSoc);
  const reachedTarget = measuredSoc + TELEMETRY_SOC_TOLERANCE >= session.target_percent;
  const finalSoc = reachedTarget
    ? session.target_percent
    : Math.min(session.target_percent, measuredSoc);

  const params = chargingParamsFromSession(session);
  const progress = deriveSessionProgressFromSoc(params, finalSoc);

  // Energy/cost: always use SOC×capacity (the user's configured battery size), never
  // the BMS kwh_charged counter — BYD BMS only measures cell energy, missing thermal
  // management load (~1.7 kW during DC charging). SOC×capacity matches grid truth
  // within 2% on AC and DC (BYD calibrates SOC against charger input). The BMS
  // counter is display-only (see AGENTS.md §FINDING 2026-06-30).
  const measuredKwh = null;
  const chargedEnergyKwh = progress.chargedEnergyKwh;
  const estimatedCost = progress.estimatedCost;

  const socMatches =
    Math.abs(session.current_percent - progress.currentPercent) <= TELEMETRY_SOC_TOLERANCE;
  const energyMatches =
    session.energy_overridden || Math.abs(session.charged_energy_kwh - chargedEnergyKwh) <= 0.05;
  const costMatches =
    session.energy_overridden || Math.abs(session.estimated_cost - estimatedCost) <= 0.05;

  if (
    socMatches &&
    energyMatches &&
    costMatches &&
    session.stopped_at &&
    Date.parse(session.stopped_at) >= startMs
  ) {
    return null;
  }

  const stopCandidates = [
    summary.firstTargetSocAt,
    summary.lastAcChargeAt,
    summary.lastSocAt,
    session.stopped_at,
  ]
    .map((value) => (value ? Date.parse(value) : NaN))
    .filter((ms) => Number.isFinite(ms) && ms >= startMs);

  const stoppedAtMs =
    stopCandidates.length > 0 ? Math.max(...stopCandidates) : Math.min(nowMs, startMs + 60_000);

  return {
    current_percent: progress.currentPercent,
    ...(session.energy_overridden
      ? {}
      : { charged_energy_kwh: chargedEnergyKwh, estimated_cost: estimatedCost }),
    status: reachedTarget ? ("completed" as const) : ("stopped" as const),
    stopped_at: new Date(stoppedAtMs).toISOString(),
  };
}
