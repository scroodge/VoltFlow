import type { TelemetryHistoryPoint } from "@/lib/bydmate/telemetry-history";
import type { ChargingSessionRow } from "@/types/database";

/**
 * A charge counts as "full" once it reaches the balance tail — that is where the
 * BMS actually equalises cells, and it is the distinction this trend exists to
 * show (partial charges let delta grow, full charges bring it back down).
 */
export const FULL_CHARGE_SOC_THRESHOLD = 99;

const DAY_MS = 86_400_000;
/** Beyond this, the nearest daily SOH reading says nothing about this session. */
const SOH_MATCH_MAX_AGE_MS = 14 * DAY_MS;

export type ChargeDeltaTrendPoint = {
  sessionId: string;
  time: number;
  deltaV: number;
  /** SOC at which the max delta was measured. */
  deltaSoc: number | null;
  endSoc: number;
  isFullCharge: boolean;
  sohPercent: number | null;
};

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

/**
 * Build the cross-session end-of-charge delta trend: one point per session that
 * has a captured delta, oldest first, each annotated with the SOH reading closest
 * to that charge.
 */
export function buildChargeDeltaTrend(
  sessions: ChargingSessionRow[],
  sohPoints: TelemetryHistoryPoint[] = [],
): ChargeDeltaTrendPoint[] {
  const points: ChargeDeltaTrendPoint[] = [];

  for (const session of sessions) {
    const deltaV = session.end_max_cell_delta_v;
    if (typeof deltaV !== "number" || !Number.isFinite(deltaV) || deltaV <= 0) continue;

    const time = Date.parse(session.stopped_at ?? session.started_at ?? "");
    if (!Number.isFinite(time)) continue;

    const endSoc = session.current_percent;

    points.push({
      sessionId: session.id,
      time,
      deltaV,
      deltaSoc: session.end_delta_soc,
      endSoc,
      isFullCharge: endSoc >= FULL_CHARGE_SOC_THRESHOLD,
      sohPercent: nearestSohPercent(time, sohPoints),
    });
  }

  return points.sort((a, b) => a.time - b.time);
}
