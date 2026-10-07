import type { SupabaseClient } from "@supabase/supabase-js";

import { isMissingDatabaseFunction } from "@/lib/database-function-compatibility";

import { enrichTripsWithEnergy } from "@/lib/voltflowmate/attach-trip-energy";
import {
  cleanTrips,
  dedupeTripsBySource,
} from "@/lib/voltflowmate/hero-drive-metrics";
import {
  calculatePhantomDrainDays,
  type PhantomDrainDay,
  type PhantomDrainSample,
} from "@/lib/voltflowmate/phantom-drain";
import { chargingSessionAnalyticsScope } from "@/features/charging/domain";
import {
  gradeRangePredictionCycles,
  type RangePredictionReport,
} from "@/lib/voltflowmate/range-prediction-grading";
import { collectPagedRows } from "@/lib/voltflowmate/paged-query";
import { weightedAvgConsumptionKwh100 } from "@/lib/voltflowmate/trip-metrics";
import { pickWalkBackSessionPrice } from "@/lib/history-day-summary";
import type {
  VoltflowMateTelemetry,
  ChargingSessionRow,
  VoltflowMateTripRow,
} from "@/types/database";

/** How many recent finished sessions to walk back through when estimating a
 * no-charge day's cost. Bounded by battery capacity vs. daily consumption in
 * practice — most accounts never need more than 1-2. */
const NO_CHARGE_WALKBACK_SESSION_LIMIT = 10;

export type MonthlyStats = {
  month: string;
  tripCount: number;
  distanceKm: number;
  regenKwh: number;
  tractionKwh: number;
  chargedKwh: number;
  chargingCost: number;
  sessionCount: number;
  avgConsumptionKwh100: number | null;
};

export type { PhantomDrainDay } from "@/lib/voltflowmate/phantom-drain";

export type CostPerKmSummary = {
  from: string;
  to: string;
  distanceKm: number;
  chargingCost: number;
  costPerKm: number | null;
};

function monthWindow(monthKey: string) {
  const start = new Date(`${monthKey}-01T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCMilliseconds(-1);
  return { from: start.toISOString(), to: end.toISOString() };
}

function periodWindow(fromDate: string, toDate: string) {
  return {
    from: new Date(`${fromDate}T00:00:00.000Z`).toISOString(),
    to: new Date(`${toDate}T23:59:59.999Z`).toISOString(),
  };
}

async function resolveVehicleCarId({
  supabase,
  userId,
  vehicleId,
}: {
  supabase: SupabaseClient;
  userId: string;
  vehicleId: string | null;
}): Promise<string | null> {
  if (!vehicleId) return null;

  const { data, error } = await supabase
    .from("cars")
    .select("id")
    .eq("user_id", userId)
    .eq("vehicle_alias", vehicleId)
    .maybeSingle();

  if (error) throw error;
  return typeof data?.id === "string" ? data.id : null;
}

export async function fetchMonthlyStats({
  supabase,
  userId,
  vehicleId,
  monthKey,
}: {
  supabase: SupabaseClient;
  userId: string;
  vehicleId: string | null;
  monthKey: string;
}): Promise<MonthlyStats> {
  const { from, to } = monthWindow(monthKey);
  const vehicleFilter = vehicleId ? { vehicle_id: vehicleId } : {};
  const carId = await resolveVehicleCarId({ supabase, userId, vehicleId });
  const sessionScope = chargingSessionAnalyticsScope(vehicleId, carId);

  const [{ data: trips }, { data: sessions }] = await Promise.all([
    supabase
      .from("bydmate_trips")
      .select("*")
      .eq("user_id", userId)
      .match(vehicleFilter)
      .gte("started_at", from)
      .lte("started_at", to),
    sessionScope == null
      ? Promise.resolve({ data: [] })
      : supabase
          .from("charging_sessions")
          .select("*")
          .eq("user_id", userId)
          .match(sessionScope)
          .gte("started_at", from)
          .lte("started_at", to)
          .in("status", ["completed", "stopped"]),
  ]);

  let tripRows = cleanTrips((trips ?? []) as VoltflowMateTripRow[]);
  const sessionRows = (sessions ?? []) as ChargingSessionRow[];

  if (tripRows.length > 0) {
    tripRows = await enrichTripsWithEnergy({
      supabase,
      userId,
      trips: tripRows,
      vehicleId: vehicleId ?? undefined,
    });
  }

  let regenKwh = tripRows.reduce(
    (sum, trip) => sum + (trip.regen_energy_kwh ?? 0),
    0,
  );
  let tractionKwh = tripRows.reduce(
    (sum, trip) => sum + (trip.traction_energy_kwh ?? 0),
    0,
  );

  if (vehicleId && (regenKwh === 0 || tractionKwh === 0)) {
    const { data: hourlyRows } = await supabase
      .from("bydmate_telemetry_hourly")
      .select("regen_kwh_sum, traction_kwh_sum")
      .eq("user_id", userId)
      .eq("vehicle_id", vehicleId)
      .gte("hour_start", from)
      .lte("hour_start", to);

    let hourlyRegen = 0;
    let hourlyTraction = 0;
    for (const row of hourlyRows ?? []) {
      hourlyRegen += Number(row.regen_kwh_sum) || 0;
      hourlyTraction += Number(row.traction_kwh_sum) || 0;
    }
    if (regenKwh === 0) regenKwh = hourlyRegen;
    if (tractionKwh === 0) tractionKwh = hourlyTraction;
  }

  return {
    month: monthKey,
    tripCount: tripRows.length,
    distanceKm: tripRows.reduce(
      (sum, trip) => sum + (trip.distance_km ?? 0),
      0,
    ),
    regenKwh,
    tractionKwh,
    chargedKwh: sessionRows.reduce(
      (sum, session) => sum + session.charged_energy_kwh,
      0,
    ),
    chargingCost: sessionRows.reduce(
      (sum, session) => sum + session.estimated_cost,
      0,
    ),
    sessionCount: sessionRows.length,
    avgConsumptionKwh100: weightedAvgConsumptionKwh100(tripRows),
  };
}

export async function fetchPeriodChargingSessions({
  supabase,
  userId,
  vehicleId,
  from,
  to,
}: {
  supabase: SupabaseClient;
  userId: string;
  vehicleId: string | null;
  from: string;
  to: string;
}): Promise<ChargingSessionRow[]> {
  const carId = await resolveVehicleCarId({ supabase, userId, vehicleId });
  const sessionScope = chargingSessionAnalyticsScope(vehicleId, carId);
  if (sessionScope == null) return [];

  // Supabase returns at most 1000 rows per select and does not error — paginate
  // or long windows would silently lose data.
  const PAGE = 1000;
  const rows: ChargingSessionRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("charging_sessions")
      .select("*")
      .eq("user_id", userId)
      .match(sessionScope)
      .gte("started_at", from)
      .lte("started_at", to)
      .order("started_at", { ascending: true })
      .range(offset, offset + PAGE - 1);

    if (error) throw error;
    const page = (data ?? []) as ChargingSessionRow[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows.sort(
    (a, b) =>
      Date.parse(String(b.started_at)) - Date.parse(String(a.started_at)),
  );
}

/**
 * Range prediction ledger (phase 2, live-graded): pair each closed session carrying an
 * end-of-charge promise with the next charge, measure reality from summed trip distance
 * in the discharge gap, and report the error. Trips are persistent aggregates, so no
 * raw-telemetry rescan is needed — cycles are graded on demand, nothing is stored yet.
 * The session window is widened 46 d back so the governing promise of the first
 * in-window cycle is found even when that charge itself predates the window, and up to a
 * trailing 90 d for the learned trust factor.
 */
export async function fetchRangePredictionReport({
  supabase,
  userId,
  vehicleId,
  from,
  to,
}: {
  supabase: SupabaseClient;
  userId: string;
  vehicleId: string;
  from: string;
  to: string;
}): Promise<RangePredictionReport> {
  const DAY_MS = 86_400_000;
  const TRUST_WINDOW_DAYS = 90;
  // Trust is learned from a trailing 90-day window even when the display window
  // is narrower (day/week views), so grading data must reach that far back too.
  const trustFromMs = Math.min(
    Date.parse(from),
    Date.parse(to) - TRUST_WINDOW_DAYS * DAY_MS,
  );
  const wideFrom = new Date(trustFromMs - 46 * DAY_MS).toISOString();

  const sessions = await fetchPeriodChargingSessions({
    supabase,
    userId,
    vehicleId,
    from: wideFrom,
    to,
  });

  const PAGE = 1000;
  const tripRows: VoltflowMateTripRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("bydmate_trips")
      .select("started_at,ended_at,last_device_time,distance_km,source")
      .eq("user_id", userId)
      .eq("vehicle_id", vehicleId)
      .gte("started_at", wideFrom)
      .lte("started_at", to)
      .order("started_at", { ascending: true })
      .range(offset, offset + PAGE - 1);

    if (error) throw error;
    const page = (data ?? []) as VoltflowMateTripRow[];
    tripRows.push(...page);
    if (page.length < PAGE) break;
  }

  // Dedupe only, NOT cleanTrips: the grader needs the raw distance so it can skip a whole
  // cycle that contains an odometer-scale trip; a nulled distance would silently under-count.
  const trips = dedupeTripsBySource(tripRows).map((trip) => ({
    started_at: trip.started_at,
    distance_km: trip.distance_km,
    // Open trips have no ended_at yet; last_device_time bounds their duration.
    ended_at: trip.ended_at ?? trip.last_device_time ?? null,
  }));

  const gradingSessions = sessions.map((session) => ({
    id: session.id,
    status: session.status,
    start_percent: session.start_percent,
    started_at: session.started_at,
    stopped_at: session.stopped_at,
    end_range_est_km: session.end_range_est_km,
    end_range_soc: session.end_range_soc,
  }));

  const report = gradeRangePredictionCycles(gradingSessions, trips, {
    from,
    to,
  });

  if (trustFromMs === Date.parse(from)) return report;

  const trustReport = gradeRangePredictionCycles(gradingSessions, trips, {
    from: new Date(trustFromMs).toISOString(),
    to,
  });
  return { ...report, trust: trustReport.trust };
}

/**
 * Estimated $/kWh for a no-charge day (BACKLOG.md "Attribute cost to no-charge
 * driving days", option 5). Walks backward through recent finished sessions
 * looking for the most recent one whose `charged_energy_kwh` still covers all
 * driving between its `stopped_at` and `dayToIso` — i.e. the charge this day's
 * driving is most plausibly still coming from. Returns null when no session
 * covers it (caller falls back to the user's default price, same as the
 * existing charged-but-unpriced-session fallback).
 */
export async function estimateNoChargeDayPrice({
  supabase,
  userId,
  vehicleId,
  dayFromIso,
  dayToIso,
}: {
  supabase: SupabaseClient;
  userId: string;
  vehicleId: string | null;
  dayFromIso: string;
  dayToIso: string;
}): Promise<number | null> {
  const carId = await resolveVehicleCarId({ supabase, userId, vehicleId });
  const sessionScope = chargingSessionAnalyticsScope(vehicleId, carId);
  if (sessionScope == null) return null;

  const { data: candidateRows, error: sessionsError } = await supabase
    .from("charging_sessions")
    .select("stopped_at, charged_energy_kwh, price_per_kwh")
    .eq("user_id", userId)
    .match(sessionScope)
    .in("status", ["completed", "stopped"])
    .not("stopped_at", "is", null)
    .lte("stopped_at", dayFromIso)
    .order("stopped_at", { ascending: false })
    .limit(NO_CHARGE_WALKBACK_SESSION_LIMIT);

  if (sessionsError) throw sessionsError;
  const candidates = (candidateRows ?? []) as Pick<
    ChargingSessionRow,
    "stopped_at" | "charged_energy_kwh" | "price_per_kwh"
  >[];
  if (candidates.length === 0) return null;

  const lowerBoundIso = candidates[candidates.length - 1].stopped_at as string;
  const vehicleFilter = vehicleId ? { vehicle_id: vehicleId } : {};
  const { data: tripRows, error: tripsError } = await supabase
    .from("bydmate_trips")
    .select(
      "distance_km, traction_energy_kwh, avg_consumption_kwh_100km, started_at",
    )
    .eq("user_id", userId)
    .match(vehicleFilter)
    .gt("started_at", lowerBoundIso)
    .lte("started_at", dayToIso);

  if (tripsError) throw tripsError;
  const trips = (tripRows ?? []) as Pick<
    VoltflowMateTripRow,
    | "distance_km"
    | "traction_energy_kwh"
    | "avg_consumption_kwh_100km"
    | "started_at"
  >[];

  return pickWalkBackSessionPrice(candidates, trips);
}

export async function fetchPhantomDrain({
  supabase,
  userId,
  vehicleId,
  days = 14,
  from,
  to,
}: {
  supabase: SupabaseClient;
  userId: string;
  vehicleId: string;
  days?: number;
  from?: string | null;
  to?: string | null;
}): Promise<PhantomDrainDay[]> {
  const parsedFrom = from != null ? Date.parse(from) : Number.NaN;
  const parsedTo = to != null ? Date.parse(to) : Number.NaN;
  const useExplicitWindow =
    Number.isFinite(parsedFrom) &&
    Number.isFinite(parsedTo) &&
    parsedFrom <= parsedTo;
  const windowTo = new Date(useExplicitWindow ? parsedTo : Date.now());
  const windowFrom = useExplicitWindow
    ? new Date(parsedFrom)
    : new Date(windowTo.getTime() - days * 24 * 60 * 60 * 1000);

  const { data, error } = await supabase.rpc("bydmate_phantom_drain_daily", {
    p_user_id: userId,
    p_vehicle_id: vehicleId,
    p_from: windowFrom.toISOString(),
    p_to: windowTo.toISOString(),
  });

  // Keep the deployment-order compatibility path, but never amplify a timeout or
  // database failure into a paginated raw scan.
  if (
    error &&
    isMissingDatabaseFunction(error, "bydmate_phantom_drain_daily")
  ) {
    return fetchPhantomDrainFallback({
      supabase,
      userId,
      vehicleId,
      from: windowFrom,
      to: windowTo,
    });
  }
  if (error) throw error;

  return (
    (data ?? []) as {
      date: string;
      soc_start: number | string;
      soc_end: number | string;
      drain_percent: number | string;
      idle_hours: number | string;
    }[]
  )
    .map((row) => ({
      date: row.date,
      socStart: Number(row.soc_start),
      socEnd: Number(row.soc_end),
      drainPercent: Number(row.drain_percent),
      idleHours: Number(row.idle_hours),
    }))
    .filter(
      (row) =>
        Number.isFinite(row.socStart) &&
        Number.isFinite(row.socEnd) &&
        Number.isFinite(row.drainPercent) &&
        Number.isFinite(row.idleHours),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
}

async function fetchPhantomDrainFallback({
  supabase,
  userId,
  vehicleId,
  from,
  to,
}: {
  supabase: SupabaseClient;
  userId: string;
  vehicleId: string;
  from: Date;
  to: Date;
}): Promise<PhantomDrainDay[]> {
  type Sample = {
    device_time: string;
    telemetry: VoltflowMateTelemetry;
    diplus_charge_gun_state?: string | null;
  };

  const samples: Sample[] = [];
  const pageSize = 1000;
  for (let fromIndex = 0; ; fromIndex += pageSize) {
    const { data, error } = await supabase
      .from("bydmate_telemetry_samples")
      .select("device_time, telemetry, diplus_charge_gun_state")
      .eq("user_id", userId)
      .eq("vehicle_id", vehicleId)
      .gte("device_time", from.toISOString())
      .lte("device_time", to.toISOString())
      .order("device_time", { ascending: true })
      .range(fromIndex, fromIndex + pageSize - 1);

    if (error) throw error;
    const page = (data ?? []) as Sample[];
    samples.push(...page);
    if (page.length < pageSize) break;
  }

  return calculatePhantomDrainDays(
    samples.map((sample): PhantomDrainSample => ({
      deviceTime: sample.device_time,
      soc: sample.telemetry.soc,
      speedKmh: sample.telemetry.speed_kmh,
      powerKw: sample.telemetry.power_kw,
      chargePowerKw: sample.telemetry.charge_power_kw,
      isCharging: sample.telemetry.is_charging,
      chargeGunState: sample.diplus_charge_gun_state,
    })),
  );
}

export async function fetchCostPerKm({
  supabase,
  userId,
  vehicleId,
  fromDate,
  toDate,
}: {
  supabase: SupabaseClient;
  userId: string;
  vehicleId: string | null;
  fromDate: string;
  toDate: string;
}): Promise<CostPerKmSummary> {
  const { from, to } = periodWindow(fromDate, toDate);
  const vehicleFilter = vehicleId ? { vehicle_id: vehicleId } : {};
  const carId = await resolveVehicleCarId({ supabase, userId, vehicleId });
  const sessionScope = chargingSessionAnalyticsScope(vehicleId, carId);

  const [{ data: trips }, { data: sessions }] = await Promise.all([
    supabase
      .from("bydmate_trips")
      .select("distance_km")
      .eq("user_id", userId)
      .match(vehicleFilter)
      .gte("started_at", from)
      .lte("started_at", to),
    sessionScope == null
      ? Promise.resolve({ data: [] })
      : supabase
          .from("charging_sessions")
          .select("estimated_cost")
          .eq("user_id", userId)
          .match(sessionScope)
          .gte("started_at", from)
          .lte("started_at", to)
          .in("status", ["completed", "stopped"]),
  ]);

  const distanceKm = (
    (trips ?? []) as Pick<VoltflowMateTripRow, "distance_km">[]
  ).reduce((sum, trip) => sum + (trip.distance_km ?? 0), 0);
  const chargingCost = (
    (sessions ?? []) as Pick<ChargingSessionRow, "estimated_cost">[]
  ).reduce((sum, session) => sum + session.estimated_cost, 0);

  return {
    from: fromDate,
    to: toDate,
    distanceKm,
    chargingCost,
    costPerKm: distanceKm > 0 ? chargingCost / distanceKm : null,
  };
}

export async function fetchLifetimeTrackPoints({
  supabase,
  userId,
  vehicleId,
  limit = 5000,
}: {
  supabase: SupabaseClient;
  userId: string;
  vehicleId: string;
  limit?: number;
}) {
  const rows = await collectPagedRows({
    limit,
    fetchPage: async (from, to) => {
      const { data, error } = await supabase
        .from("bydmate_trip_track_points")
        .select(
          "lat, lon, device_time, trip_id, bydmate_trips!inner(vehicle_id)",
        )
        .eq("user_id", userId)
        .eq("bydmate_trips.vehicle_id", vehicleId)
        .order("device_time", { ascending: false })
        .range(from, to);

      if (error) throw error;
      return data ?? [];
    },
  });

  return rows.reverse().map((row) => ({
    lat: row.lat,
    lon: row.lon,
    device_time: row.device_time,
    trip_id: row.trip_id,
  }));
}

export type ConsumptionBaselineResult = {
  medianKwh100: number | null;
  sampleTripCount: number;
  days: number;
};

export async function fetchConsumptionBaseline({
  supabase,
  userId,
  vehicleId,
  days = 30,
}: {
  supabase: SupabaseClient;
  userId: string;
  vehicleId: string;
  days?: number;
}): Promise<ConsumptionBaselineResult> {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

  const { data, error } = await supabase
    .from("bydmate_trips")
    .select("avg_consumption_kwh_100km, distance_km")
    .eq("user_id", userId)
    .eq("vehicle_id", vehicleId)
    .gte("started_at", from.toISOString())
    .lte("started_at", to.toISOString());

  if (error) throw error;

  const consumptions = (
    (data ?? []) as Pick<
      VoltflowMateTripRow,
      "avg_consumption_kwh_100km" | "distance_km"
    >[]
  )
    .filter(
      (trip) =>
        (trip.distance_km ?? 0) >= 2 &&
        trip.avg_consumption_kwh_100km != null &&
        trip.avg_consumption_kwh_100km > 0,
    )
    .map((trip) => trip.avg_consumption_kwh_100km as number)
    .sort((a, b) => a - b);

  const medianKwh100 =
    consumptions.length > 0
      ? (consumptions[Math.floor(consumptions.length / 2)] ?? null)
      : null;

  return {
    medianKwh100,
    sampleTripCount: consumptions.length,
    days,
  };
}
