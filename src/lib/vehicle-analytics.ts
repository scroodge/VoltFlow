import type { SupabaseClient } from "@supabase/supabase-js";

import { enrichTripsWithEnergy } from "@/lib/bydmate/attach-trip-energy";
import { chargingSessionAnalyticsScope } from "@/lib/charging-session-analytics-scope";
import { collectPagedRows } from "@/lib/bydmate/paged-query";
import type { BydmateTelemetry, ChargingSessionRow, BydmateTripRow } from "@/types/database";

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

export type PhantomDrainDay = {
  date: string;
  socStart: number;
  socEnd: number;
  drainPercent: number;
  idleHours: number;
};

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

  let tripRows = (trips ?? []) as BydmateTripRow[];
  const sessionRows = (sessions ?? []) as ChargingSessionRow[];

  if (tripRows.length > 0) {
    tripRows = await enrichTripsWithEnergy({
      supabase,
      userId,
      trips: tripRows,
      vehicleId: vehicleId ?? undefined,
    });
  }

  let weightedConsumption = 0;
  let weightedDistance = 0;

  for (const trip of tripRows) {
    const distance = trip.distance_km ?? 0;
    const consumption = trip.avg_consumption_kwh_100km;
    if (distance > 0 && consumption != null) {
      weightedConsumption += consumption * distance;
      weightedDistance += distance;
    }
  }

  let regenKwh = tripRows.reduce((sum, trip) => sum + (trip.regen_energy_kwh ?? 0), 0);
  let tractionKwh = tripRows.reduce((sum, trip) => sum + (trip.traction_energy_kwh ?? 0), 0);

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
    distanceKm: tripRows.reduce((sum, trip) => sum + (trip.distance_km ?? 0), 0),
    regenKwh,
    tractionKwh,
    chargedKwh: sessionRows.reduce((sum, session) => sum + session.charged_energy_kwh, 0),
    chargingCost: sessionRows.reduce((sum, session) => sum + session.estimated_cost, 0),
    sessionCount: sessionRows.length,
    avgConsumptionKwh100: weightedDistance > 0 ? weightedConsumption / weightedDistance : null,
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

  const { data, error } = await supabase
    .from("charging_sessions")
    .select("*")
    .eq("user_id", userId)
    .match(sessionScope)
    .gte("started_at", from)
    .lte("started_at", to)
    .order("started_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as ChargingSessionRow[];
}

export async function fetchPhantomDrain({
  supabase,
  userId,
  vehicleId,
  days = 14,
}: {
  supabase: SupabaseClient;
  userId: string;
  vehicleId: string;
  days?: number;
}): Promise<PhantomDrainDay[]> {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

  const { data, error } = await supabase
    .rpc("bydmate_phantom_drain_daily", {
      p_user_id: userId,
      p_vehicle_id: vehicleId,
      p_from: from.toISOString(),
      p_to: to.toISOString(),
    });

  // Keep the result correct if the web deployment arrives shortly before the matching
  // migration. This is deliberately paginated; a one-page fallback reintroduces the
  // production 1,000-row truncation that this RPC removes.
  if (error) {
    return fetchPhantomDrainFallback({ supabase, userId, vehicleId, from, to });
  }

  return ((data ?? []) as {
    date: string;
    soc_start: number | string;
    soc_end: number | string;
    drain_percent: number | string;
    idle_hours: number | string;
  }[])
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
    telemetry: BydmateTelemetry;
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

  const byDay = new Map<string, { first: number | null; last: number | null; idleMs: number }>();

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index]!;
    const soc = sample.telemetry.soc;
    if (typeof soc !== "number") continue;

    const dayKey = sample.device_time.slice(0, 10);
    const bucket = byDay.get(dayKey) ?? { first: null, last: null, idleMs: 0 };
    bucket.first ??= soc;
    bucket.last = soc;

    const speed = sample.telemetry.speed_kmh ?? 0;
    const power = sample.telemetry.power_kw ?? 0;
    const charging =
      (sample.telemetry.charge_power_kw ?? 0) > 0 ||
      (sample.diplus_charge_gun_state !== "1" && sample.telemetry.is_charging === true);
    const moving = speed > 0.5 || Math.abs(power) > 0.1;

    if (!moving && !charging && index > 0) {
      const previous = samples[index - 1]!;
      const elapsedMs = Date.parse(sample.device_time) - Date.parse(previous.device_time);
      if (elapsedMs > 0 && elapsedMs < 6 * 60 * 60 * 1000) {
        bucket.idleMs += elapsedMs;
      }
    }

    byDay.set(dayKey, bucket);
  }

  return [...byDay.entries()]
    .map(([date, bucket]) => ({
      date,
      socStart: bucket.first ?? 0,
      socEnd: bucket.last ?? 0,
      drainPercent: bucket.first != null && bucket.last != null ? bucket.first - bucket.last : 0,
      idleHours: bucket.idleMs / (60 * 60 * 1000),
    }))
    .filter((row) => row.idleHours >= 4 && row.drainPercent > 0)
    .sort((a, b) => b.date.localeCompare(a.date));
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

  const distanceKm = ((trips ?? []) as Pick<BydmateTripRow, "distance_km">[]).reduce(
    (sum, trip) => sum + (trip.distance_km ?? 0),
    0,
  );
  const chargingCost = ((sessions ?? []) as Pick<ChargingSessionRow, "estimated_cost">[]).reduce(
    (sum, session) => sum + session.estimated_cost,
    0,
  );

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
        .select("lat, lon, device_time, trip_id, bydmate_trips!inner(vehicle_id)")
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

  const consumptions = ((data ?? []) as Pick<BydmateTripRow, "avg_consumption_kwh_100km" | "distance_km">[])
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
      ? consumptions[Math.floor(consumptions.length / 2)] ?? null
      : null;

  return {
    medianKwh100,
    sampleTripCount: consumptions.length,
    days,
  };
}
