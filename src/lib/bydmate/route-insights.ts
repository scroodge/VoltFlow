import type { SupabaseClient } from "@supabase/supabase-js";

import type { BydmateTripRow } from "@/types/database";

const MIN_ROUTE_TRIPS = 3;
const GEO_PRECISION = 0.01; // ~1 km grid

export type RouteTripRef = {
  tripId: string;
  startedAt: string;
  distanceKm: number | null;
  avgConsumptionKwh100: number | null;
  outsideTempAvg: number | null;
  batteryTempAvg: number | null;
  avgSpeedKmh: number | null;
  regenKwh: number | null;
};

export type RouteInsight = {
  routeId: string;
  label: string;
  tripCount: number;
  tripsNeeded: number;
  unlocked: boolean;
  medianConsumptionKwh100: number | null;
  minConsumptionKwh100: number | null;
  maxConsumptionKwh100: number | null;
  tempBuckets: { tempC: number; label: string; avgConsumptionKwh100: number; count: number }[];
  predictedConsumptionKwh100: { low: number; high: number } | null;
  currentOutsideTempC: number | null;
};

function roundGrid(value: number) {
  return Math.round(value / GEO_PRECISION) * GEO_PRECISION;
}

function routeKey(startLat: number, startLon: number, endLat: number, endLon: number) {
  return [
    roundGrid(startLat),
    roundGrid(startLon),
    roundGrid(endLat),
    roundGrid(endLon),
  ].join(":");
}

function routeLabel(startLat: number, startLon: number, endLat: number, endLon: number) {
  return `${startLat.toFixed(2)},${startLon.toFixed(2)} → ${endLat.toFixed(2)},${endLon.toFixed(2)}`;
}

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function predictFromTemp(
  buckets: RouteInsight["tempBuckets"],
  currentTemp: number | null,
  fallback: number | null,
) {
  if (currentTemp == null || buckets.length === 0) {
    if (fallback == null) return null;
    return { low: fallback * 0.92, high: fallback * 1.08 };
  }
  const bin = Math.round(currentTemp / 5) * 5;
  const match = buckets.find((b) => b.tempC === bin);
  const base = match?.avgConsumptionKwh100 ?? fallback;
  if (base == null) return null;
  return { low: base * 0.95, high: base * 1.05 };
}

async function tripOutsideTempAvg(
  supabase: SupabaseClient,
  userId: string,
  vehicleId: string,
  trip: BydmateTripRow,
) {
  const endAt = trip.ended_at ?? trip.last_device_time;
  const { data, error } = await supabase
    .from("bydmate_telemetry_samples")
    .select("telemetry")
    .eq("user_id", userId)
    .eq("vehicle_id", vehicleId)
    .gte("device_time", trip.started_at)
    .lte("device_time", endAt)
    .limit(200);

  if (error || !data?.length) return null;

  let sum = 0;
  let count = 0;
  let batterySum = 0;
  let batteryCount = 0;

  for (const row of data) {
    const telemetry = row.telemetry as { outside_temp_c?: number; battery_temp_c?: number };
    const outside = telemetry.outside_temp_c;
    const battery = telemetry.battery_temp_c;
    if (typeof outside === "number" && Number.isFinite(outside)) {
      sum += outside;
      count += 1;
    }
    if (typeof battery === "number" && Number.isFinite(battery)) {
      batterySum += battery;
      batteryCount += 1;
    }
  }

  return {
    outsideTempAvg: count > 0 ? sum / count : null,
    batteryTempAvg: batteryCount > 0 ? batterySum / batteryCount : null,
  };
}

export async function fetchRouteInsights({
  supabase,
  userId,
  vehicleId,
  currentOutsideTempC = null,
  tripLimit = 80,
}: {
  supabase: SupabaseClient;
  userId: string;
  vehicleId: string;
  currentOutsideTempC?: number | null;
  tripLimit?: number;
}): Promise<RouteInsight[]> {
  const { data: trips, error: tripsError } = await supabase
    .from("bydmate_trips")
    .select("*")
    .eq("user_id", userId)
    .eq("vehicle_id", vehicleId)
    .gt("track_point_count", 1)
    .order("started_at", { ascending: false })
    .limit(tripLimit);

  if (tripsError) throw tripsError;

  const tripRows = (trips ?? []) as BydmateTripRow[];
  const clusters = new Map<string, { label: string; trips: RouteTripRef[] }>();

  for (const trip of tripRows) {
    const { data: track, error: trackError } = await supabase
      .from("bydmate_trip_track_points")
      .select("lat, lon")
      .eq("user_id", userId)
      .eq("trip_id", trip.id)
      .order("device_time", { ascending: true })
      .limit(500);

    if (trackError || !track || track.length < 2) continue;

    const first = track[0];
    const last = track[track.length - 1];
    const key = routeKey(first.lat, first.lon, last.lat, last.lon);
    const label = routeLabel(first.lat, first.lon, last.lat, last.lon);

    const temps = await tripOutsideTempAvg(supabase, userId, vehicleId, trip);

    const ref: RouteTripRef = {
      tripId: trip.id,
      startedAt: trip.started_at,
      distanceKm: trip.distance_km,
      avgConsumptionKwh100: trip.avg_consumption_kwh_100km,
      outsideTempAvg: temps?.outsideTempAvg ?? null,
      batteryTempAvg: temps?.batteryTempAvg ?? null,
      avgSpeedKmh: trip.avg_speed_kmh,
      regenKwh: trip.regen_energy_kwh ?? null,
    };

    const cluster = clusters.get(key) ?? { label, trips: [] };
    cluster.trips.push(ref);
    clusters.set(key, cluster);
  }

  const insights: RouteInsight[] = [];

  for (const [routeId, cluster] of clusters) {
    const consumptions = cluster.trips
      .map((t) => t.avgConsumptionKwh100)
      .filter((v): v is number => v != null && v > 0);

    const tempMap = new Map<number, { sum: number; count: number }>();
    for (const trip of cluster.trips) {
      if (trip.outsideTempAvg == null || trip.avgConsumptionKwh100 == null) continue;
      const bin = Math.round(trip.outsideTempAvg / 5) * 5;
      const row = tempMap.get(bin) ?? { sum: 0, count: 0 };
      row.sum += trip.avgConsumptionKwh100;
      row.count += 1;
      tempMap.set(bin, row);
    }

    const tempBuckets = Array.from(tempMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([tempC, row]) => ({
        tempC,
        label: `${tempC}°C`,
        avgConsumptionKwh100: row.sum / row.count,
        count: row.count,
      }));

    const med = median(consumptions);
    const unlocked = cluster.trips.length >= MIN_ROUTE_TRIPS;

    insights.push({
      routeId,
      label: cluster.label,
      tripCount: cluster.trips.length,
      tripsNeeded: Math.max(0, MIN_ROUTE_TRIPS - cluster.trips.length),
      unlocked,
      medianConsumptionKwh100: med,
      minConsumptionKwh100: consumptions.length ? Math.min(...consumptions) : null,
      maxConsumptionKwh100: consumptions.length ? Math.max(...consumptions) : null,
      tempBuckets,
      predictedConsumptionKwh100: unlocked
        ? predictFromTemp(tempBuckets, currentOutsideTempC, med)
        : null,
      currentOutsideTempC,
    });
  }

  return insights.sort((a, b) => b.tripCount - a.tripCount);
}

export async function fetchPeriodTrips({
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
}): Promise<BydmateTripRow[]> {
  const { data, error } = await supabase
    .from("bydmate_trips")
    .select("*")
    .eq("user_id", userId)
    .eq("vehicle_id", vehicleId)
    .gte("started_at", from)
    .lte("started_at", to)
    .order("started_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as BydmateTripRow[];
}

export async function fetchPeriodTripsEnriched({
  supabase,
  userId,
  vehicleId,
  from,
  to,
  enrichLimit = 40,
}: {
  supabase: SupabaseClient;
  userId: string;
  vehicleId: string;
  from: string;
  to: string;
  enrichLimit?: number;
}): Promise<(BydmateTripRow & { outside_temp_avg?: number | null })[]> {
  const trips = await fetchPeriodTrips({ supabase, userId, vehicleId, from, to });
  const enriched = await Promise.all(
    trips.slice(0, enrichLimit).map(async (trip) => {
      const temps = await tripOutsideTempAvg(supabase, userId, vehicleId, trip);
      return { ...trip, outside_temp_avg: temps?.outsideTempAvg ?? null };
    }),
  );
  return [...enriched, ...trips.slice(enrichLimit)];
}
