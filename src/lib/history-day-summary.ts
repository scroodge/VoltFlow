import type { BydmateTripRow, ChargingSessionRow } from "@/types/database";

const BALANCE_THRESHOLD_KWH = 0.5;

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

function sessionOnDate(session: ChargingSessionRow, dateKey: string) {
  return Boolean(session.started_at && localDateKeyFromIso(session.started_at) === dateKey);
}

function tripOnDate(trip: BydmateTripRow, dateKey: string) {
  return localDateKeyFromIso(trip.started_at) === dateKey;
}

function sessionDurationSec(session: ChargingSessionRow) {
  const started = session.started_at ? Date.parse(session.started_at) : NaN;
  const ended = session.stopped_at ? Date.parse(session.stopped_at) : NaN;
  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended <= started) return 0;
  return (ended - started) / 1000;
}

function tripDriveKwh(trip: BydmateTripRow) {
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

function verdictFromDelta(deltaKwh: number): HistoryDayVerdict {
  if (deltaKwh > BALANCE_THRESHOLD_KWH) return "surplus";
  if (deltaKwh < -BALANCE_THRESHOLD_KWH) return "deficit";
  return "balanced";
}

export function computeHistoryDaySummary(
  sessions: ChargingSessionRow[],
  trips: BydmateTripRow[],
  dateKey: string,
): HistoryDaySummary {
  const daySessions = sessions.filter((s) => sessionOnDate(s, dateKey));
  const dayTrips = trips.filter((t) => tripOnDate(t, dateKey));

  const finishedSessions = daySessions.filter(
    (s) => s.status === "completed" || s.status === "stopped",
  );

  let chargingCost = 0;
  let chargingDurationSec = 0;
  let chargedKwh = 0;
  let hasPricedSessions = false;

  for (const session of daySessions) {
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

  for (const trip of dayTrips) {
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
    sessionCount: daySessions.length,
    tripCount: dayTrips.length,
    deltaKwh,
    verdict: verdictFromDelta(deltaKwh),
    hasCharging: daySessions.length > 0,
    hasTrips: dayTrips.length > 0,
    hasPricedSessions,
  };
}
