import type { TelemetryHistoryPoint } from "@/lib/bydmate/telemetry-history";
import type { ChargingSessionRow } from "@/types/database";

/**
 * Only a charge that reaches the balance tail produces a comparable delta.
 *
 * This is not a display preference, it is the pack's physics: on the flat part of
 * the LFP curve the cells sit within a few mV of each other no matter how far the
 * pack has drifted, and the spread only opens up on the steep knee at the top.
 * Measured on this car: partial charges land at 4-12 mV (avg 7), charges into the
 * tail at 10-347 mV (avg 260). Plotting both on one axis would flatten every real
 * movement of the tail delta into the bottom pixel row.
 *
 * So partial charges are not points on the delta axis — they are the *cause* of
 * drift, and are carried as context marks instead.
 */
export const FULL_CHARGE_SOC_THRESHOLD = 99;

const DAY_MS = 86_400_000;
/** Beyond this, the nearest daily SOH reading says nothing about this session. */
const SOH_MATCH_MAX_AGE_MS = 14 * DAY_MS;

export type ChargeDeltaTrendPoint = {
  sessionId: string;
  time: number;
  deltaV: number;
  /** SOC the max was actually measured at (from telemetry, not the session row). */
  deltaSoc: number;
  sohPercent: number | null;
  /** Partial charges since the previous full charge — the driver of any rise. */
  partialChargesSincePrevious: number;
};

export type PartialChargeMark = {
  sessionId: string;
  time: number;
  endSoc: number;
};

export type ChargeDeltaTrend = {
  fullCharges: ChargeDeltaTrendPoint[];
  partialCharges: PartialChargeMark[];
};

/**
 * Only the fields the trend reads. Narrow on purpose: its query selects a handful of
 * columns, so it must not be typed as a full session row that it cannot honestly fill.
 */
export type ChargeDeltaSession = Pick<
  ChargingSessionRow,
  "id" | "status" | "end_max_cell_delta_v" | "end_delta_soc" | "started_at" | "stopped_at"
>;

const EMPTY_TREND: ChargeDeltaTrend = { fullCharges: [], partialCharges: [] };

function nearestSohPercent(timeMs: number, sohPoints: TelemetryHistoryPoint[]): number | null {
  let best: { diff: number; soh: number } | null = null;

  for (const point of sohPoints) {
    const soh = point.telemetry.soh_percent;
    if (typeof soh !== "number" || !Number.isFinite(soh)) continue;

    const pointMs = Date.parse(point.device_time);
    if (!Number.isFinite(pointMs)) continue;

    const diff = Math.abs(pointMs - timeMs);
    if (diff > SOH_MATCH_MAX_AGE_MS) continue;
    if (!best || diff < best.diff) best = { diff, soh };
  }

  return best?.soh ?? null;
}

function sessionTime(session: ChargeDeltaSession): number | null {
  const time = Date.parse(session.stopped_at ?? session.started_at ?? "");
  return Number.isFinite(time) ? time : null;
}

/**
 * Split charge history into the comparable tail-delta series and the partial charges
 * that sit between its points. Both are oldest-first.
 */
export function buildChargeDeltaTrend(
  sessions: ChargeDeltaSession[],
  sohPoints: TelemetryHistoryPoint[] = [],
): ChargeDeltaTrend {
  if (sessions.length === 0) return EMPTY_TREND;

  type Measured = {
    session: ChargeDeltaSession;
    time: number;
    deltaV: number;
    deltaSoc: number;
  };

  const measured: Measured[] = [];

  for (const session of sessions) {
    if (session.status === "charging") continue;

    const time = sessionTime(session);
    if (time == null) continue;

    const deltaV = session.end_max_cell_delta_v;
    const deltaSoc = session.end_delta_soc;
    // No cell telemetry for this charge: it is neither a data point nor a
    // countable partial charge, because we cannot say what SOC it reached.
    if (
      typeof deltaV !== "number" ||
      !Number.isFinite(deltaV) ||
      deltaV <= 0 ||
      typeof deltaSoc !== "number" ||
      !Number.isFinite(deltaSoc)
    ) {
      continue;
    }

    measured.push({ session, time, deltaV, deltaSoc });
  }

  measured.sort((a, b) => a.time - b.time);

  const fullCharges: ChargeDeltaTrendPoint[] = [];
  const partialCharges: PartialChargeMark[] = [];
  let partialRun = 0;

  for (const item of measured) {
    if (item.deltaSoc < FULL_CHARGE_SOC_THRESHOLD) {
      partialCharges.push({
        sessionId: item.session.id,
        time: item.time,
        endSoc: item.deltaSoc,
      });
      partialRun += 1;
      continue;
    }

    fullCharges.push({
      sessionId: item.session.id,
      time: item.time,
      deltaV: item.deltaV,
      deltaSoc: item.deltaSoc,
      sohPercent: nearestSohPercent(item.time, sohPoints),
      partialChargesSincePrevious: partialRun,
    });
    partialRun = 0;
  }

  return { fullCharges, partialCharges };
}
