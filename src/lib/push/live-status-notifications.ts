import type { SupabaseClient } from "@supabase/supabase-js";

import type { TelemetryPayload } from "@/lib/bydmate/ingest-payload";
import { DRIVING_SPEED_THRESHOLD_KMH, gearIsDrive, gearIsPark } from "../bydmate/gear.ts";
import {
  finiteTelemetryNumber,
  isTelemetryCharging,
  telemetrySpeedKmh,
} from "../bydmate/telemetry-charging.ts";
import { isAppleWebPushEndpoint, sendPushToUser } from "./web-push.ts";

/**
 * Android "live" lock-screen status: a web push re-sent with a constant tag replaces
 * the previous notification in place, so a silent update per charging batch behaves
 * like a live widget. Apple endpoints are excluded (iOS shows every push audibly and
 * never replaces silently); iPhones keep the milestone notifications only.
 */

export type LiveStatusMode = "off" | "charging" | "charging_parked";
export type LiveStatusPhase = "charging" | "parked" | "driving";
export type LiveStatusAction = "update" | "final" | "clear" | "none";

export type LiveStatusState = {
  lastState: string | null;
  lastSentAt: string | null;
  lastSoc: number | null;
  chargeStartedAt: string | null;
  chargeStartSoc: number | null;
};

/** Charging batches arrive every ~60s; slack keeps one send per batch despite jitter. */
export const LIVE_STATUS_CHARGING_UPDATE_MS = 60_000;
export const LIVE_STATUS_UPDATE_SLACK_MS = 5_000;
/** Parked SOC barely moves — refresh on ≥1% drift or a 30 min heartbeat. */
export const LIVE_STATUS_PARKED_REFRESH_MS = 30 * 60_000;
export const LIVE_STATUS_PARKED_SOC_DELTA_PERCENT = 1;
/** ETA needs a stable average rate: ≥5 min of charging and ≥0.02 %/min. */
const ETA_MIN_ELAPSED_MS = 5 * 60_000;
const ETA_MIN_RATE_PERCENT_PER_MIN = 0.02;

export function liveStatusTag(vehicleId: string) {
  return `voltflow-live:${vehicleId}`;
}

export function normalizeLiveStatusMode(value: string | null | undefined): LiveStatusMode {
  return value === "off" || value === "charging_parked" ? value : "charging";
}

function finiteSoc(value: unknown) {
  const soc = finiteTelemetryNumber(value);
  return soc != null && soc >= 0 && soc <= 100 ? soc : null;
}

function elapsedMs(fromIso: string | null, toIso: string) {
  if (!fromIso) return null;
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  return Number.isFinite(from) && Number.isFinite(to) ? to - from : null;
}

/** Mirrors vehicle-live-mode ordering: driving wins over charging wins over parked. */
export function liveStatusPhaseForSample(sample: TelemetryPayload): LiveStatusPhase {
  const gear = sample.diplus?.gear ?? null;
  if (gearIsDrive(gear)) return "driving";
  if (gear == null || !gearIsPark(gear)) {
    const speedKmh = telemetrySpeedKmh(sample.telemetry);
    if (speedKmh != null && speedKmh > DRIVING_SPEED_THRESHOLD_KMH) return "driving";
  }
  if (isTelemetryCharging(sample.telemetry, sample)) return "charging";
  return "parked";
}

export function nextLiveStatusState({
  previousState,
  phase,
  soc,
  deviceTime,
  mode,
}: {
  previousState: LiveStatusState | null;
  phase: LiveStatusPhase;
  soc: number | null;
  deviceTime: string;
  mode: LiveStatusMode;
}): { action: LiveStatusAction; nextState: LiveStatusState } {
  const prev: LiveStatusState = previousState ?? {
    lastState: null,
    lastSentAt: null,
    lastSoc: null,
    chargeStartedAt: null,
    chargeStartSoc: null,
  };
  const wasCharging = prev.lastState === "charging";
  const wasParked = prev.lastState === "parked";
  const sinceSent = elapsedMs(prev.lastSentAt, deviceTime);

  const resolved = (action: LiveStatusAction, overrides?: Partial<LiveStatusState>): {
    action: LiveStatusAction;
    nextState: LiveStatusState;
  } => ({
    action,
    nextState: {
      lastState: phase,
      lastSentAt: action === "none" ? prev.lastSentAt : deviceTime,
      lastSoc: action === "none" ? prev.lastSoc : soc ?? prev.lastSoc,
      chargeStartedAt: null,
      chargeStartSoc: null,
      ...overrides,
    },
  });

  if (phase === "charging") {
    const chargeStartedAt = wasCharging ? prev.chargeStartedAt ?? deviceTime : deviceTime;
    const chargeStartSoc = wasCharging ? prev.chargeStartSoc ?? soc : soc;
    const due =
      sinceSent == null ||
      sinceSent >= LIVE_STATUS_CHARGING_UPDATE_MS - LIVE_STATUS_UPDATE_SLACK_MS;
    return resolved(!wasCharging || due ? "update" : "none", {
      chargeStartedAt,
      chargeStartSoc,
    });
  }

  // Leaving charging buzzes once with the outcome, whatever the next phase is.
  if (wasCharging) return resolved("final");

  if (phase === "parked") {
    if (mode !== "charging_parked") return resolved("none");
    const socDrifted =
      soc != null &&
      prev.lastSoc != null &&
      Math.abs(soc - prev.lastSoc) >= LIVE_STATUS_PARKED_SOC_DELTA_PERCENT;
    const due = sinceSent == null || sinceSent >= LIVE_STATUS_PARKED_REFRESH_MS;
    return resolved(!wasParked || socDrifted || due ? "update" : "none");
  }

  // Driving: the parked card is stale the moment the car moves — remove it.
  return resolved(wasParked && mode === "charging_parked" ? "clear" : "none");
}

function formatDurationMin(totalMinutes: number) {
  const minutes = Math.max(1, Math.round(totalMinutes));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h ${m.toString().padStart(2, "0")} m` : `${m} min`;
}

function chargeRatePercentPerMin(state: LiveStatusState, soc: number | null, deviceTime: string) {
  if (soc == null || state.chargeStartSoc == null) return null;
  const elapsed = elapsedMs(state.chargeStartedAt, deviceTime);
  if (elapsed == null || elapsed < ETA_MIN_ELAPSED_MS) return null;
  const rate = (soc - state.chargeStartSoc) / (elapsed / 60_000);
  return rate >= ETA_MIN_RATE_PERCENT_PER_MIN ? rate : null;
}

export function liveStatusChargingPayload({
  vehicleId,
  soc,
  chargePowerKw,
  state,
  deviceTime,
}: {
  vehicleId: string;
  soc: number | null;
  chargePowerKw: number | null;
  state: LiveStatusState;
  deviceTime: string;
}) {
  const parts: string[] = [];
  if (chargePowerKw != null && chargePowerKw > 0) {
    parts.push(`${chargePowerKw.toFixed(1)} kW`);
  }
  if (soc != null && state.chargeStartSoc != null && soc > state.chargeStartSoc) {
    parts.push(`+${Math.round(soc - state.chargeStartSoc)}% this charge`);
  }
  const rate = chargeRatePercentPerMin(state, soc, deviceTime);
  if (rate != null && soc != null && soc < 100) {
    parts.push(`~${formatDurationMin((100 - soc) / rate)} to 100%`);
  }

  return {
    title: soc != null ? `⚡ Charging · ${Math.round(soc)}%` : "⚡ Charging",
    body: parts.length ? parts.join(" · ") : "Live charging status",
    url: "/vehicle",
    tag: liveStatusTag(vehicleId),
    renotify: false,
    silent: true,
  };
}

export function liveStatusFinalPayload({
  vehicleId,
  soc,
  state,
  deviceTime,
}: {
  vehicleId: string;
  soc: number | null;
  state: LiveStatusState;
  deviceTime: string;
}) {
  const parts: string[] = [];
  if (soc != null && state.chargeStartSoc != null && soc > state.chargeStartSoc) {
    parts.push(`+${Math.round(soc - state.chargeStartSoc)}%`);
  }
  const elapsed = elapsedMs(state.chargeStartedAt, deviceTime);
  if (elapsed != null && elapsed > 0) {
    parts.push(`in ${formatDurationMin(elapsed / 60_000)}`);
  }

  return {
    title: soc != null ? `✅ Charging finished · ${Math.round(soc)}%` : "✅ Charging finished",
    body: parts.length ? parts.join(" ") : "The car is no longer charging.",
    url: "/vehicle",
    tag: liveStatusTag(vehicleId),
    // renotify defaults to true in the SW — the one audible moment of the live flow.
  };
}

export function liveStatusParkedPayload({
  vehicleId,
  soc,
  rangeEstKm,
}: {
  vehicleId: string;
  soc: number | null;
  rangeEstKm: number | null;
}) {
  return {
    title: soc != null ? `🅿️ Parked · ${Math.round(soc)}%` : "🅿️ Parked",
    body:
      rangeEstKm != null && rangeEstKm > 0
        ? `Range ~${Math.round(rangeEstKm)} km`
        : "Live vehicle status",
    url: "/vehicle",
    tag: liveStatusTag(vehicleId),
    renotify: false,
    silent: true,
  };
}

export function liveStatusClearPayload(vehicleId: string) {
  return {
    title: "VoltFlow",
    body: "Drive started",
    url: "/vehicle",
    tag: liveStatusTag(vehicleId),
    silent: true,
    kind: "clear" as const,
  };
}

type LiveStatusStateRow = {
  user_id: string;
  vehicle_id: string;
  last_state: string | null;
  last_sent_at: string | null;
  last_soc: number | string | null;
  charge_started_at: string | null;
  charge_start_soc: number | string | null;
};

function stateFromRow(row: LiveStatusStateRow): LiveStatusState {
  return {
    lastState: row.last_state,
    lastSentAt: row.last_sent_at,
    lastSoc: finiteTelemetryNumber(row.last_soc),
    chargeStartedAt: row.charge_started_at,
    chargeStartSoc: finiteTelemetryNumber(row.charge_start_soc),
  };
}

function stateToRow(userId: string, vehicleId: string, state: LiveStatusState) {
  return {
    user_id: userId,
    vehicle_id: vehicleId,
    last_state: state.lastState,
    last_sent_at: state.lastSentAt,
    last_soc: state.lastSoc,
    charge_started_at: state.chargeStartedAt,
    charge_start_soc: state.chargeStartSoc,
  };
}

function statesEqual(a: LiveStatusState | null, b: LiveStatusState) {
  return (
    a != null &&
    a.lastState === b.lastState &&
    a.lastSentAt === b.lastSentAt &&
    a.lastSoc === b.lastSoc &&
    a.chargeStartedAt === b.chargeStartedAt &&
    a.chargeStartSoc === b.chargeStartSoc
  );
}

const androidEndpointFilter = {
  endpointFilter: (endpoint: string) => !isAppleWebPushEndpoint(endpoint),
};

export async function processBydmateLiveStatusNotifications({
  supabase,
  userId,
  samples,
}: {
  supabase: SupabaseClient;
  userId: string;
  samples: TelemetryPayload[];
}) {
  const vehicleIds = Array.from(new Set(samples.map((sample) => sample.vehicle_id)));
  if (!vehicleIds.length) return { sent: 0 };

  const { data: profileRow, error: profileError } = await supabase
    .from("profiles")
    .select("live_status_mode")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) throw new Error(profileError.message);

  const mode = normalizeLiveStatusMode(
    (profileRow as { live_status_mode?: string | null } | null)?.live_status_mode,
  );
  if (mode === "off") return { sent: 0 };

  const { data: rows, error } = await supabase
    .from("bydmate_live_status_state")
    .select(
      "user_id,vehicle_id,last_state,last_sent_at,last_soc,charge_started_at,charge_start_soc",
    )
    .eq("user_id", userId)
    .in("vehicle_id", vehicleIds);

  if (error) throw new Error(error.message);

  const states = new Map<string, LiveStatusState>();
  const persistedStates = new Map<string, LiveStatusState>();
  for (const row of (rows ?? []) as LiveStatusStateRow[]) {
    states.set(row.vehicle_id, stateFromRow(row));
    persistedStates.set(row.vehicle_id, stateFromRow(row));
  }

  let sent = 0;
  const orderedSamples = [...samples].sort(
    (a, b) => Date.parse(a.device_time) - Date.parse(b.device_time),
  );

  for (const sample of orderedSamples) {
    const previousState = states.get(sample.vehicle_id) ?? null;
    const phase = liveStatusPhaseForSample(sample);
    const soc = finiteSoc(sample.telemetry.soc) ?? finiteSoc(sample.diplus?.soc);
    const { action, nextState } = nextLiveStatusState({
      previousState,
      phase,
      soc,
      deviceTime: sample.device_time,
      mode,
    });

    states.set(sample.vehicle_id, nextState);
    if (action === "none") continue;

    const payload =
      action === "clear"
        ? liveStatusClearPayload(sample.vehicle_id)
        : action === "final"
        ? liveStatusFinalPayload({
            vehicleId: sample.vehicle_id,
            soc,
            state: previousState ?? nextState,
            deviceTime: sample.device_time,
          })
        : phase === "parked"
        ? liveStatusParkedPayload({
            vehicleId: sample.vehicle_id,
            soc,
            rangeEstKm: finiteTelemetryNumber(sample.telemetry.range_est_km),
          })
        : liveStatusChargingPayload({
            vehicleId: sample.vehicle_id,
            soc,
            chargePowerKw: finiteTelemetryNumber(sample.telemetry.charge_power_kw),
            state: nextState,
            deviceTime: sample.device_time,
          });

    const result = await sendPushToUser(supabase, userId, payload, androidEndpointFilter);
    sent += result.sent;
  }

  for (const vehicleId of vehicleIds) {
    const state = states.get(vehicleId);
    if (!state || statesEqual(persistedStates.get(vehicleId) ?? null, state)) continue;
    const { error: upsertError } = await supabase
      .from("bydmate_live_status_state")
      .upsert(stateToRow(userId, vehicleId, state), { onConflict: "user_id,vehicle_id" });

    if (upsertError) throw new Error(upsertError.message);
  }

  return { sent };
}
