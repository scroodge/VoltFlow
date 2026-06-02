/**
 * Live vs wall-clock charging state for active sessions.
 * See AGENTS.md (Active charging session sync) and SKILLS.md (Charging Skill).
 */
import {
  deriveChargingState,
  type ChargingParams,
  type DerivedChargingState,
} from "@/lib/charging-math";
import {
  deriveLiveChargingState,
  findFreshChargingSnapshot,
  findFreshSocSnapshot,
  LIVE_SOC_RECONCILE_TOLERANCE_PERCENT,
} from "@/lib/charging-live";
import type { BydmateLiveSnapshotRow, ChargingSessionRow } from "@/types/database";

export function chargingParamsFromSession(row: ChargingSessionRow): ChargingParams {
  return {
    startPercent: row.start_percent,
    targetPercent: row.target_percent,
    batteryCapacityKwh: row.battery_capacity_kwh,
    chargerPowerKw: row.charger_power_kw,
    efficiencyPercent: row.efficiency_percent,
    pricePerKwh: row.price_per_kwh,
  };
}

export function filterLiveSnapshotsForVehicle(
  snapshots: BydmateLiveSnapshotRow[],
  vehicleId: string | null | undefined,
): BydmateLiveSnapshotRow[] {
  if (!vehicleId) return snapshots;
  const scoped = snapshots.filter((row) => row.vehicle_id === vehicleId);
  return scoped.length > 0 ? scoped : snapshots;
}

export type ChargingSessionLiveBundle = {
  display: DerivedChargingState;
  liveChargingState: DerivedChargingState | null;
  liveCompletionState: DerivedChargingState | null;
  mathState: DerivedChargingState;
  hasFreshLiveSocSource: boolean;
  /** Auto-complete only from fresh live SOC when Mate is available. */
  completionState: DerivedChargingState | null;
  /** Progress written to charging_sessions (prefers live, falls back to math). */
  stateToPersist: DerivedChargingState;
};

export function deriveChargingSessionLiveBundle({
  snapshots,
  params,
  startedAtMs,
  nowMs,
}: {
  snapshots: BydmateLiveSnapshotRow[];
  params: ChargingParams;
  startedAtMs: number;
  nowMs: number;
}): ChargingSessionLiveBundle {
  const hasFreshLiveSocSource = findFreshSocSnapshot(snapshots, nowMs) != null;
  const liveChargingState = deriveLiveChargingState({
    snapshot: findFreshChargingSnapshot(snapshots, nowMs),
    params,
    startedAtMs,
    nowMs,
  });
  const liveCompletionState = hasFreshLiveSocSource
    ? deriveLiveChargingState({
        snapshot: findFreshSocSnapshot(snapshots, nowMs),
        params,
        startedAtMs,
        nowMs,
        requireCharging: false,
      })
    : null;
  const mathState = deriveChargingState(params, startedAtMs, nowMs);
  const display = liveChargingState ?? liveCompletionState ?? mathState;
  const completionState =
    hasFreshLiveSocSource && liveCompletionState?.isComplete
      ? liveCompletionState
      : null;
  const stateToPersist = liveChargingState ?? liveCompletionState ?? mathState;

  return {
    display,
    liveChargingState,
    liveCompletionState,
    mathState,
    hasFreshLiveSocSource,
    completionState,
    stateToPersist,
  };
}
/** Prefer live SOC over math when Mate wakes up with a material drift. */
export function resolveStateToPersist(bundle: ChargingSessionLiveBundle): DerivedChargingState {
  const liveSoc = bundle.liveCompletionState;
  if (!bundle.hasFreshLiveSocSource || !liveSoc) {
    return bundle.stateToPersist;
  }
  if (
    Math.abs(liveSoc.currentPercent - bundle.stateToPersist.currentPercent) >
    LIVE_SOC_RECONCILE_TOLERANCE_PERCENT
  ) {
    return liveSoc;
  }
  return bundle.stateToPersist;
}

export function staticDerivedFromSession(
  session: ChargingSessionRow,
): DerivedChargingState {
  const startedMs = session.started_at ? Date.parse(session.started_at) : null;
  const stoppedMs = session.stopped_at ? Date.parse(session.stopped_at) : null;
  const elapsedSeconds =
    startedMs != null && stoppedMs != null ? (stoppedMs - startedMs) / 1000 : 0;

  return {
    currentPercent: session.current_percent,
    chargedEnergyKwh: session.charged_energy_kwh,
    estimatedCost: session.estimated_cost,
    elapsedSeconds,
    remainingSeconds: 0,
    isComplete: session.status === "completed",
  };
}
