import {
  costFromGridEnergy,
  deriveSessionProgressFromSoc,
  energyFromGridKwh,
  type ChargingParams,
} from "./charging-math.ts";
import { AUTO_CHARGING_DRIVE_STOP_SPEED_KMH, TELEMETRY_CHARGE_POWER_THRESHOLD_KW } from "./bydmate/telemetry-charging.ts";

const CHARGE_POWER_THRESHOLD_KW = TELEMETRY_CHARGE_POWER_THRESHOLD_KW;

/**
 * Charging evidence for reconcile windows only — never falls back to `power_kw` (that's
 * positive traction draw while *driving*, not charging) and requires the vehicle parked.
 * Without the speed guard, a highway sample was mistaken for "still charging" and dragged
 * `stopped_at` forward through an entire drive (car `way`, 2026-07-06).
 */
function isChargingEvidence(telemetry: Record<string, unknown>) {
  const chargePowerKw = finiteTelemetryNumber(telemetry.charge_power_kw);
  if (chargePowerKw == null || chargePowerKw <= CHARGE_POWER_THRESHOLD_KW) return false;
  const speedKmh = finiteTelemetryNumber(telemetry.speed_kmh);
  return speedKmh == null || speedKmh <= AUTO_CHARGING_DRIVE_STOP_SPEED_KMH;
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
/**
 * An open ("charging") session with no telemetry for this long has really ended: the car
 * slept, di+ HTTP stopped responding, the Mate daemon went silent — so the
 * 2-consecutive-unplug auto-stop never received its samples and the session sits open
 * forever (observed: a 58 h "charging" session on car `way`). Close it at the last real SOC.
 */
const OPEN_SESSION_SILENCE_MS = 15 * 60_000;

export { RECONCILE_LOOKBACK_DAYS, TELEMETRY_SOC_TOLERANCE, OPEN_SESSION_SILENCE_MS };

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
    if (row.telemetry && isChargingEvidence(row.telemetry)) {
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

/**
 * Close an open session whose telemetry has gone silent (see OPEN_SESSION_SILENCE_MS).
 * The final state is the last real SOC seen — never a wall-clock projection past the last
 * sample. Returns null when the session is not open, telemetry is still fresh (let the
 * normal auto-stop handle it), or live SOC is still fresh (car is present/awake).
 */
export function buildSilenceClosePatch({
  session,
  summary,
  lastSampleMs,
  liveSocFresh,
  liveSoc,
  nowMs,
}: {
  session: ReconcileChargingSession;
  summary: ReturnType<typeof summarizeSessionTelemetry>;
  lastSampleMs: number | null;
  liveSocFresh: boolean;
  liveSoc: number | null;
  nowMs: number;
}) {
  if (session.status !== "charging" || !session.started_at) return null;
  if (liveSocFresh) return null; // car still reporting → not silent
  if (lastSampleMs != null && nowMs - lastSampleMs < OPEN_SESSION_SILENCE_MS) return null;

  const startMs = Date.parse(session.started_at);
  if (!Number.isFinite(startMs)) return null;

  const measuredSoc = measuredSocFromMate(session, summary, liveSoc);
  const reachedTarget = measuredSoc + TELEMETRY_SOC_TOLERANCE >= session.target_percent;
  const finalSoc = reachedTarget
    ? session.target_percent
    : Math.min(session.target_percent, measuredSoc);
  const progress = deriveSessionProgressFromSoc(chargingParamsFromSession(session), finalSoc);
  const stopMs = Math.max(startMs, lastSampleMs ?? startMs);

  return {
    current_percent: progress.currentPercent,
    ...(session.energy_overridden
      ? {}
      : {
          charged_energy_kwh: progress.chargedEnergyKwh,
          estimated_cost: progress.estimatedCost,
        }),
    status: reachedTarget ? ("completed" as const) : ("stopped" as const),
    stopped_at: new Date(stopMs).toISOString(),
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
  // No SOC evidence in the session's window (telemetry pruned/missing) and no live SOC to
  // anchor to — measuredSocFromMate would fall back to start_percent and wipe a legit,
  // already-recorded session. Leave it alone rather than guess.
  if (summary.lastSocAt == null && liveSoc == null) return null;

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

  // lastSocAt is deliberately excluded here: any sample with a SOC reading counts (including
  // driving), so it kept dragging stopped_at through drives between charges (car `way`,
  // 2026-07-06). It's only trustworthy as a last-resort anchor when the stored stopped_at
  // itself is missing/invalid.
  const storedStoppedMs = session.stopped_at ? Date.parse(session.stopped_at) : NaN;
  const storedStoppedValid = Number.isFinite(storedStoppedMs) && storedStoppedMs >= startMs;

  const stopCandidates = [
    ...[summary.firstTargetSocAt, summary.lastAcChargeAt, session.stopped_at]
      .map((value) => (value ? Date.parse(value) : NaN))
      .filter((ms) => Number.isFinite(ms) && ms >= startMs),
    ...(storedStoppedValid
      ? []
      : [summary.lastSocAt]
          .map((value) => (value ? Date.parse(value) : NaN))
          .filter((ms) => Number.isFinite(ms) && ms >= startMs)),
  ];

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
