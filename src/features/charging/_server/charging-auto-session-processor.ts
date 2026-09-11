import { deriveSessionProgressFromSoc } from "../_domain/charging-math.ts";
import { measurementIsRecent, MAX_MEASUREMENT_FUTURE_SKEW_MS } from "../_domain/measurement-freshness.ts";
import { finiteTelemetryNumber, isMateAutoSessionCharging, isMateAutoSessionChargingSustained, telemetrySpeedKmh } from "../_domain/telemetry-charging.ts";
import { nextAutoChargingSessionStep, type AutoChargingSessionState, type AutoChargingSessionAction } from "./charging-auto-session-step.ts";
import type { Car, ChargingSessionRow } from "@/types/database";
import type { TelemetryPayload } from "@/lib/voltflowmate/ingest-payload";

export const AUTO_START_WINDOW_MS = 3 * 60_000;
const CHARGING_RESUME_GAP_MS = 5 * 60_000;

export type AutoChargingStateRow = {
  state_version: number;
  last_device_time: string | null;
  consecutive_charging_samples: number;
  consecutive_unplug_samples: number;
  last_is_charging: boolean;
  streak_start_percent: number | null;
  streak_start_device_time: string | null;
  last_idle_percent: number | null;
  last_idle_device_time: string | null;
  frozen_soc: number | null;
  frozen_charge_power_kw: number | null;
  frozen_since_device_time: string | null;
  zero_power_since_device_time: string | null;
};

export type ChargingProcessingSnapshot = {
  car: Car | null;
  state: AutoChargingStateRow | null;
  sessions: ChargingSessionRow[];
  samples: TelemetryPayload[];
};
export type SessionInsert = Pick<ChargingSessionRow,
  "id" | "user_id" | "car_id" | "start_percent" | "current_percent" | "target_percent" |
  "battery_capacity_kwh" | "charger_power_kw" | "efficiency_percent" | "tariff_type" |
  "provider_type" | "user_provider_id" | "tariff_manual" | "price_per_kwh" |
  "charged_energy_kwh" | "estimated_cost" | "status" | "started_at">;
export type SessionOperation =
  | { kind: "start"; row: SessionInsert }
  | { kind: "stop"; id: string; patch: Partial<ChargingSessionRow> };
type StartAction = Extract<AutoChargingSessionAction, { type: "start" }>;
type PrepareStart = (car: Car, sample: TelemetryPayload, action: StartAction) => Promise<SessionInsert>;

function stateFromRow(row: AutoChargingStateRow | null): AutoChargingSessionState | null {
  if (!row) return null;
  return {
    consecutiveChargingSamples: row.consecutive_charging_samples,
    consecutiveUnplugSamples: row.consecutive_unplug_samples,
    lastIsCharging: row.last_is_charging,
    streakStartPercent: finiteTelemetryNumber(row.streak_start_percent),
    streakStartDeviceTime: row.streak_start_device_time,
    lastIdlePercent: finiteTelemetryNumber(row.last_idle_percent),
    lastIdleDeviceTime: row.last_idle_device_time,
    frozenSoc: finiteTelemetryNumber(row.frozen_soc),
    frozenChargePowerKw: finiteTelemetryNumber(row.frozen_charge_power_kw),
    frozenSinceDeviceTime: row.frozen_since_device_time,
    zeroPowerSinceDeviceTime: row.zero_power_since_device_time,
  };
}

function stateToRow(state: AutoChargingSessionState | null, lastTime: string | null) {
  return {
    last_device_time: lastTime,
    consecutive_charging_samples: state?.consecutiveChargingSamples ?? 0,
    consecutive_unplug_samples: state?.consecutiveUnplugSamples ?? 0,
    last_is_charging: state?.lastIsCharging ?? false,
    streak_start_percent: state?.streakStartPercent ?? null,
    streak_start_device_time: state?.streakStartDeviceTime ?? null,
    last_idle_percent: state?.lastIdlePercent ?? null,
    last_idle_device_time: state?.lastIdleDeviceTime ?? null,
    frozen_soc: state?.frozenSoc ?? null,
    frozen_charge_power_kw: state?.frozenChargePowerKw ?? null,
    frozen_since_device_time: state?.frozenSinceDeviceTime ?? null,
    zero_power_since_device_time: state?.zeroPowerSinceDeviceTime ?? null,
  };
}

/** Plan a whole pending page without writing sessions or advancing durable state. */
export async function planChargingBatch(snapshot: ChargingProcessingSnapshot, nowMs: number, prepareStart: PrepareStart) {
  let state = stateFromRow(snapshot.state);
  let lastTime = snapshot.state?.last_device_time ?? null;
  let sessions: (ChargingSessionRow | SessionInsert)[] = [...snapshot.sessions];
  const operations: SessionOperation[] = [];
  const sessionIds: string[] = [];
  const closedIds: string[] = [];
  let lastLocation: TelemetryPayload["location"] | null = null;
  const car = snapshot.car;
  const ordered = [...snapshot.samples].sort((a, b) => Date.parse(a.device_time) - Date.parse(b.device_time));
  for (const sample of ordered) {
    const measuredMs = Date.parse(sample.device_time);
    if (!car || sample.live_only || sample.vehicle_id !== car.vehicle_alias) continue;
    if (!Number.isFinite(measuredMs) || measuredMs > nowMs + MAX_MEASUREMENT_FUTURE_SKEW_MS) continue;
    if (lastTime && measuredMs <= Date.parse(lastTime)) continue;
    let active = sessions.find((session) => session.car_id === car.id);
    // A delayed sample from before a manually started session cannot affect that session.
    if (active?.started_at && measuredMs < Date.parse(active.started_at)) {
      lastTime = sample.device_time;
      continue;
    }
    const speed = telemetrySpeedKmh(sample.telemetry);
    const soc = finiteTelemetryNumber(sample.telemetry.soc);
    const power = finiteTelemetryNumber(sample.telemetry.charge_power_kw);
    const canStart = isMateAutoSessionCharging(sample.telemetry, speed, sample);
    const recent = measurementIsRecent(sample.device_time, nowMs, AUTO_START_WINDOW_MS);
    if (typeof sample.location?.lat === "number" && typeof sample.location?.lon === "number") lastLocation = sample.location;

    const stop = (session: ChargingSessionRow | SessionInsert) => {
      const progress = deriveSessionProgressFromSoc({
        startPercent: session.start_percent, targetPercent: session.target_percent,
        batteryCapacityKwh: car.battery_capacity_kwh, chargerPowerKw: session.charger_power_kw,
        efficiencyPercent: session.efficiency_percent, pricePerKwh: session.price_per_kwh,
      }, soc!);
      operations.push({ kind: "stop", id: session.id, patch: {
        status: "stopped", stopped_at: new Date(Math.max(Date.parse(session.started_at ?? sample.device_time), measuredMs)).toISOString(),
        current_percent: progress.currentPercent, charged_energy_kwh: progress.chargedEnergyKwh, estimated_cost: progress.estimatedCost,
      } });
      closedIds.push(session.id);
      sessions = sessions.filter((row) => row.id !== session.id);
    };
    if (active && canStart && recent && soc != null && lastTime && measuredMs - Date.parse(lastTime) > CHARGING_RESUME_GAP_MS) {
      stop(active);
      active = undefined;
      state = null;
    }
    // Count only distinct measurements within the documented start window.
    if (!active && state?.streakStartDeviceTime && measuredMs - Date.parse(state.streakStartDeviceTime) > AUTO_START_WINDOW_MS) {
      state = { ...state, consecutiveChargingSamples: 0, streakStartPercent: null, streakStartDeviceTime: null };
    }
    const step = nextAutoChargingSessionStep({
      state, isCharging: isMateAutoSessionChargingSustained(sample.telemetry, speed, sample),
      canStartSession: canStart && recent, soc, speedKmh: speed, hasActiveSession: Boolean(active),
      chargerPowerKw: power ?? car.default_charger_power_kw, rawChargePowerKw: power, deviceTime: sample.device_time,
    });
    state = step.state;
    lastTime = sample.device_time;
    if (step.action.type === "stop" && active) stop(active);
    if (step.action.type === "start") {
      // Preserve the existing account-wide replacement policy; cardinality is a separate change.
      for (const session of sessions) {
        operations.push({ kind: "stop", id: session.id, patch: {
          status: "stopped", stopped_at: new Date(Math.max(Date.parse(session.started_at ?? step.action.startedAt), Date.parse(step.action.startedAt))).toISOString(),
        } });
        closedIds.push(session.id);
      }
      const row = await prepareStart(car, { ...sample, location: lastLocation ?? sample.location }, step.action);
      operations.push({ kind: "start", row });
      sessions = [row];
      sessionIds.push(row.id);
    }
  }
  return {
    state: stateToRow(state, lastTime), operations,
    consumedTimes: ordered.map((sample) => sample.device_time),
    started: sessionIds.length, stopped: closedIds.length, sessionIds, closedIds,
  };
}

export type ChargingBatchPlan = Awaited<ReturnType<typeof planChargingBatch>>;
export type ChargingProcessingStore = {
  read(): Promise<ChargingProcessingSnapshot>;
  commit(snapshot: ChargingProcessingSnapshot, plan: ChargingBatchPlan): Promise<boolean>;
};

/** Conflicts reload and recompute; failures leave pending inputs available for retry. */
export async function drainChargingQueue(store: ChargingProcessingStore, prepareStart: PrepareStart, now: () => number = Date.now) {
  const result = { started: 0, stopped: 0, sessionIds: [] as string[], closedIds: [] as string[] };
  let conflicts = 0;
  for (let page = 0; page < 8; ) {
    const snapshot = await store.read();
    if (!snapshot.samples.length) return result;
    const plan = await planChargingBatch(snapshot, now(), prepareStart);
    if (!await store.commit(snapshot, plan)) {
      if (++conflicts >= 4) throw new Error("Charging state contention; retry delivery");
      continue;
    }
    conflicts = 0;
    page += 1;
    result.started += plan.started;
    result.stopped += plan.stopped;
    result.sessionIds.push(...plan.sessionIds);
    result.closedIds.push(...plan.closedIds);
    if (snapshot.samples.length < 300) return result;
  }
  throw new Error("Charging backlog remains; retry delivery");
}
