import { resolveLocalCalendarDayWindow } from "./bydmate/telemetry-ranges.ts";
import type { BydmateTripRow, ChargingSessionRow } from "@/types/database";

const BALANCE_THRESHOLD_KWH = 0.5;

export type HistorySummaryScope = "day" | "week" | "month" | "quarter" | "year";

export type HistoryDayVerdict = "surplus" | "deficit" | "balanced";

export type HistoryDaySummary = {
  chargingCost: number;
  chargingDurationSec: number;
  chargedKwh: number;
  distanceKm: number;
  driveKwh: number;
  regenKwh: number;
  sessionCount: number;
  tripCount: number;
  deltaKwh: number;
  verdict: HistoryDayVerdict;
  hasCharging: boolean;
  hasTrips: boolean;
  hasPricedSessions: boolean;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function localDateKeyFromIso(isoStr: string) {
  const d = new Date(isoStr);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function inIsoWindow(iso: string, fromMs: number, toMs: number) {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) && ms >= fromMs && ms <= toMs;
}

function sessionDurationSec(session: ChargingSessionRow) {
  const started = session.started_at ? Date.parse(session.started_at) : NaN;
  const ended = session.stopped_at ? Date.parse(session.stopped_at) : NaN;
  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended <= started) return 0;
  return (ended - started) / 1000;
}

export function tripDriveKwh(
  trip: Pick<BydmateTripRow, "traction_energy_kwh" | "distance_km" | "avg_consumption_kwh_100km">,
) {
  const traction = trip.traction_energy_kwh;
  if (typeof traction === "number" && Number.isFinite(traction)) return traction;

  const distance = trip.distance_km;
  const consumption = trip.avg_consumption_kwh_100km;
  if (
    typeof distance === "number" &&
    Number.isFinite(distance) &&
    distance > 0 &&
    typeof consumption === "number" &&
    Number.isFinite(consumption)
  ) {
    return (distance * consumption) / 100;
  }

  return 0;
}

/**
 * Session walk-back (BACKLOG.md "Attribute cost to no-charge driving days",
 * option 5): given recent finished sessions (newest first, already filtered to
 * `stopped_at <= the day being priced`) and the trips that fall after the
 * oldest candidate's `stopped_at`, find the most recent session whose
 * `charged_energy_kwh` still covers all driving since it ended — i.e. the
 * charge today's driving is most plausibly still coming from. Returns null
 * when no candidate covers it.
 */
export function pickWalkBackSessionPrice(
  candidates: readonly {
    stopped_at: string | null;
    charged_energy_kwh: number;
    price_per_kwh: number;
  }[],
  trips: readonly Pick<
    BydmateTripRow,
    "traction_energy_kwh" | "distance_km" | "avg_consumption_kwh_100km" | "started_at"
  >[],
): number | null {
  for (const session of candidates) {
    if (session.stopped_at == null) continue;
    if (session.price_per_kwh <= 0 || session.charged_energy_kwh <= 0) continue;
    const stoppedAt = session.stopped_at;
    const cumulativeDriveKwh = trips
      .filter((trip) => trip.started_at != null && trip.started_at > stoppedAt)
      .reduce((sum, trip) => sum + tripDriveKwh(trip), 0);
    if (cumulativeDriveKwh <= session.charged_energy_kwh) {
      return session.price_per_kwh;
    }
  }
  return null;
}

function verdictFromDelta(deltaKwh: number): HistoryDayVerdict {
  if (deltaKwh > BALANCE_THRESHOLD_KWH) return "surplus";
  if (deltaKwh < -BALANCE_THRESHOLD_KWH) return "deficit";
  return "balanced";
}

function aggregateHistorySummary(
  periodSessions: ChargingSessionRow[],
  periodTrips: BydmateTripRow[],
): HistoryDaySummary {
  const finishedSessions = periodSessions.filter(
    (s) => s.status === "completed" || s.status === "stopped",
  );

  let chargingCost = 0;
  let chargingDurationSec = 0;
  let chargedKwh = 0;
  let hasPricedSessions = false;

  for (const session of periodSessions) {
    chargingDurationSec += sessionDurationSec(session);
    if (session.price_per_kwh > 0) {
      hasPricedSessions = true;
      chargingCost += session.estimated_cost ?? 0;
    }
  }

  for (const session of finishedSessions) {
    chargedKwh += session.charged_energy_kwh ?? 0;
  }

  let distanceKm = 0;
  let driveKwh = 0;
  let regenKwh = 0;

  for (const trip of periodTrips) {
    distanceKm += trip.distance_km ?? 0;
    driveKwh += tripDriveKwh(trip);
    regenKwh += trip.regen_energy_kwh ?? 0;
  }

  const deltaKwh = chargedKwh - driveKwh;

  return {
    chargingCost,
    chargingDurationSec,
    chargedKwh,
    distanceKm,
    driveKwh,
    regenKwh,
    sessionCount: periodSessions.length,
    tripCount: periodTrips.length,
    deltaKwh,
    verdict: verdictFromDelta(deltaKwh),
    hasCharging: periodSessions.length > 0,
    hasTrips: periodTrips.length > 0,
    hasPricedSessions,
  };
}

export function computeHistoryPeriodSummary(
  sessions: ChargingSessionRow[],
  trips: BydmateTripRow[],
  fromIso: string,
  toIso: string,
): HistoryDaySummary {
  const fromMs = Date.parse(fromIso);
  const toMs = Date.parse(toIso);
  const periodSessions = sessions.filter(
    (s) => s.started_at && inIsoWindow(s.started_at, fromMs, toMs),
  );
  const periodTrips = trips.filter((t) => inIsoWindow(t.started_at, fromMs, toMs));
  return aggregateHistorySummary(periodSessions, periodTrips);
}

export function computeHistoryDaySummary(
  sessions: ChargingSessionRow[],
  trips: BydmateTripRow[],
  dateKey: string,
): HistoryDaySummary {
  const { from, to } = resolveLocalCalendarDayWindow(dateKey);
  return computeHistoryPeriodSummary(sessions, trips, from, to);
}
