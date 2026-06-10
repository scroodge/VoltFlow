import type { SupabaseClient } from "@supabase/supabase-js";

import { enrichTripsWithEnergy } from "@/lib/bydmate/attach-trip-energy";
import {
  haversineMeters,
  trackPathDistanceKm,
  tripDistanceSourcesAgree,
} from "@/lib/bydmate/trip-distance";
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

export type RouteInsightTrackPoint = {
  lat: number;
  lon: number;
  device_time: string;
  power_kw?: number | null;
  speed_kmh?: number | null;
  soc?: number | null;
};

export type RouteInsight = {
  routeId: string;
  /** Coordinate fallback label when no user name is saved. */
  label: string;
  /** User-defined route name, if saved. */
  name: string | null;
  tripCount: number;
  tripsNeeded: number;
  unlocked: boolean;
  trackPoints: RouteInsightTrackPoint[];
  medianConsumptionKwh100: number | null;
  minConsumptionKwh100: number | null;
  maxConsumptionKwh100: number | null;
  tempBuckets: { tempC: number; label: string; avgConsumptionKwh100: number; count: number }[];
  predictedConsumptionKwh100: { low: number; high: number } | null;
  currentOutsideTempC: number | null;
};

export type ParkedRouteInsight = {
  routeId: string;
  label: string;
  name: string | null;
};

export type RouteInsightsResult = {
  routes: RouteInsight[];
  parkedRoutes: ParkedRouteInsight[];
};

type RoutePreference = {
  name: string | null;
  isPark: boolean;
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

export function formatRouteIdLabel(routeId: string) {
  const parts = routeId.split(":").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return routeId;
  return routeLabel(parts[0], parts[1], parts[2], parts[3]);
}

const MAX_ROUTE_INSIGHT_TRACK_POINTS = 150;

function downsampleTrackPoints<T>(points: T[], maxPoints: number): T[] {
  if (points.length <= maxPoints) return points;
  const out: T[] = [];
  const step = (points.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i += 1) {
    out.push(points[Math.round(i * step)]);
  }
  return out;
}

function toRouteTrackPoints(
  track: { lat: number; lon: number; device_time?: string | null; power_kw?: number | null; speed_kmh?: number | null; soc?: number | null }[],
  fallbackTime: string,
): RouteInsightTrackPoint[] {
  return track.map((point) => ({
    lat: point.lat,
    lon: point.lon,
    device_time: point.device_time ?? fallbackTime,
    power_kw: point.power_kw ?? null,
    speed_kmh: point.speed_kmh ?? null,
    soc: point.soc ?? null,
  }));
}

/** True when GPS track has enough spread to render a meaningful route map. */
export function isRouteTrackDisplayable(
  points: { lat: number; lon: number }[],
  minPoints = 2,
  minSpanMeters = 75,
  options?: { odometerDistanceKm?: number | null },
) {
  const valid = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (valid.length < minPoints) return false;

  let minLat = valid[0].lat;
  let maxLat = valid[0].lat;
  let minLon = valid[0].lon;
  let maxLon = valid[0].lon;
  let pathMeters = 0;

  for (let i = 0; i < valid.length; i += 1) {
    const point = valid[i];
    minLat = Math.min(minLat, point.lat);
    maxLat = Math.max(maxLat, point.lat);
    minLon = Math.min(minLon, point.lon);
    maxLon = Math.max(maxLon, point.lon);
    if (i > 0) {
      const prev = valid[i - 1];
      pathMeters += haversineMeters(prev.lat, prev.lon, point.lat, point.lon);
    }
  }

  const latSpanM = haversineMeters(minLat, minLon, maxLat, minLon);
  const lonSpanM = haversineMeters(minLat, minLon, minLat, maxLon);

  const geometricOk =
    pathMeters >= minSpanMeters || latSpanM >= minSpanMeters || lonSpanM >= minSpanMeters;
  if (geometricOk) return true;

  const odometerKm = options?.odometerDistanceKm;
  const pathKm = trackPathDistanceKm(valid);
  if (
    pathKm != null &&
    pathKm > 0 &&
    typeof odometerKm === "number" &&
    Number.isFinite(odometerKm) &&
    odometerKm > 0 &&
    tripDistanceSourcesAgree(pathKm, odometerKm)
  ) {
    return true;
  }

  return false;
}

async function fetchRoutePreferences(
  supabase: SupabaseClient,
  userId: string,
  vehicleId: string,
) {
  const { data, error } = await supabase
    .from("bydmate_route_labels")
    .select("route_id, name, is_park")
    .eq("user_id", userId)
    .eq("vehicle_id", vehicleId);

  if (error) throw error;

  const map = new Map<string, RoutePreference>();
  for (const row of data ?? []) {
    const name = typeof row.name === "string" ? row.name.trim() : "";
    map.set(row.route_id, {
      name: name || null,
      isPark: Boolean(row.is_park),
    });
  }
  return map;
}

export async function saveRoutePreference({
  supabase,
  userId,
  vehicleId,
  routeId,
  name,
  isPark,
}: {
  supabase: SupabaseClient;
  userId: string;
  vehicleId: string;
  routeId: string;
  name?: string;
  isPark?: boolean;
}) {
  const { data: existing, error: readError } = await supabase
    .from("bydmate_route_labels")
    .select("name, is_park")
    .eq("user_id", userId)
    .eq("vehicle_id", vehicleId)
    .eq("route_id", routeId)
    .maybeSingle();

  if (readError) throw readError;

  let nextName = typeof existing?.name === "string" ? existing.name.trim() || null : null;
  let nextPark = Boolean(existing?.is_park);

  if (name !== undefined) {
    const trimmed = name.trim();
    nextName = trimmed || null;
  }
  if (isPark !== undefined) {
    nextPark = isPark;
  }

  if (!nextName && !nextPark) {
    const { error } = await supabase
      .from("bydmate_route_labels")
      .delete()
      .eq("user_id", userId)
      .eq("vehicle_id", vehicleId)
      .eq("route_id", routeId);
    if (error) throw error;
    return { name: null, isPark: false };
  }

  if (nextName && nextName.length > 80) {
    throw new Error("Route name too long");
  }

  const { data, error } = await supabase
    .from("bydmate_route_labels")
    .upsert(
      {
        user_id: userId,
        vehicle_id: vehicleId,
        route_id: routeId,
        name: nextName,
        is_park: nextPark,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,vehicle_id,route_id" },
    )
    .select("name, is_park")
    .single();

  if (error) throw error;

  const savedName = typeof data?.name === "string" ? data.name.trim() || null : null;
  return { name: savedName, isPark: Boolean(data?.is_park) };
}

/** @deprecated Use saveRoutePreference */
export async function saveRouteLabel({
  supabase,
  userId,
  vehicleId,
  routeId,
  name,
}: {
  supabase: SupabaseClient;
  userId: string;
  vehicleId: string;
  routeId: string;
  name: string;
}) {
  return saveRoutePreference({ supabase, userId, vehicleId, routeId, name });
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
}): Promise<RouteInsightsResult> {
  const { data: trips, error: tripsError } = await supabase
    .from("bydmate_trips")
    .select("*")
    .eq("user_id", userId)
    .eq("vehicle_id", vehicleId)
    .gt("track_point_count", 1)
    .order("started_at", { ascending: false })
    .limit(tripLimit);

  if (tripsError) throw tripsError;

  const routePreferences = await fetchRoutePreferences(supabase, userId, vehicleId);
  const parkRouteIds = new Set(
    [...routePreferences.entries()]
      .filter(([, pref]) => pref.isPark)
      .map(([routeId]) => routeId),
  );

  const tripRows = (trips ?? []) as BydmateTripRow[];
  const clusters = new Map<string, { label: string; trips: RouteTripRef[]; trackPoints: RouteInsightTrackPoint[] }>();

  for (const trip of tripRows) {
    const { data: track, error: trackError } = await supabase
      .from("bydmate_trip_track_points")
      .select("lat, lon, device_time, power_kw, speed_kmh, soc")
      .eq("user_id", userId)
      .eq("trip_id", trip.id)
      .order("device_time", { ascending: true })
      .limit(500);

    if (trackError || !track || track.length < 2) continue;

    const first = track[0];
    const last = track[track.length - 1];
    const key = routeKey(first.lat, first.lon, last.lat, last.lon);
    if (parkRouteIds.has(key)) continue;

    const label = routeLabel(first.lat, first.lon, last.lat, last.lon);
    const mappedTrack = downsampleTrackPoints(
      toRouteTrackPoints(track, trip.started_at),
      MAX_ROUTE_INSIGHT_TRACK_POINTS,
    );

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

    const cluster = clusters.get(key) ?? { label, trips: [], trackPoints: [] };
    cluster.trips.push(ref);
    if (
      isRouteTrackDisplayable(mappedTrack, 2, 75, { odometerDistanceKm: trip.distance_km }) &&
      mappedTrack.length > cluster.trackPoints.length
    ) {
      cluster.trackPoints = mappedTrack;
    }
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
    if (cluster.trips.length < MIN_ROUTE_TRIPS) continue;

    insights.push({
      routeId,
      label: cluster.label,
      name: routePreferences.get(routeId)?.name ?? null,
      tripCount: cluster.trips.length,
      tripsNeeded: 0,
      unlocked: true,
      trackPoints: isRouteTrackDisplayable(cluster.trackPoints, 2, 75, {
        odometerDistanceKm: median(
          cluster.trips
            .map((trip) => trip.distanceKm)
            .filter((value): value is number => value != null && value >= 0),
        ),
      })
        ? cluster.trackPoints
        : [],
      medianConsumptionKwh100: med,
      minConsumptionKwh100: consumptions.length ? Math.min(...consumptions) : null,
      maxConsumptionKwh100: consumptions.length ? Math.max(...consumptions) : null,
      tempBuckets,
      predictedConsumptionKwh100: predictFromTemp(tempBuckets, currentOutsideTempC, med),
      currentOutsideTempC,
    });
  }

  const parkedRoutes: ParkedRouteInsight[] = [...routePreferences.entries()]
    .filter(([, pref]) => pref.isPark)
    .map(([routeId, pref]) => ({
      routeId,
      label: formatRouteIdLabel(routeId),
      name: pref.name,
    }))
    .sort((a, b) => (a.name ?? a.label).localeCompare(b.name ?? b.label));

  return {
    routes: insights.sort((a, b) => b.tripCount - a.tripCount),
    parkedRoutes,
  };
}

export async function fetchPeriodTrips({
  supabase,
  userId,
  vehicleId,
  from,
  to,
  overlapWindow = false,
}: {
  supabase: SupabaseClient;
  userId: string;
  vehicleId: string;
  from: string;
  to: string;
  /** Include trips that overlap [from, to], not only those starting inside it. */
  overlapWindow?: boolean;
}): Promise<BydmateTripRow[]> {
  let query = supabase
    .from("bydmate_trips")
    .select("*")
    .eq("user_id", userId)
    .eq("vehicle_id", vehicleId);

  if (overlapWindow) {
    query = query.lte("started_at", to).or(`ended_at.is.null,ended_at.gte.${from}`);
  } else {
    query = query.gte("started_at", from).lte("started_at", to);
  }

  const { data, error } = await query.order("started_at", { ascending: false });

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
  overlapWindow = false,
}: {
  supabase: SupabaseClient;
  userId: string;
  vehicleId: string;
  from: string;
  to: string;
  enrichLimit?: number;
  overlapWindow?: boolean;
}): Promise<(BydmateTripRow & { outside_temp_avg?: number | null })[]> {
  const trips = await fetchPeriodTrips({
    supabase,
    userId,
    vehicleId,
    from,
    to,
    overlapWindow,
  });
  const withEnergy = await enrichTripsWithEnergy({
    supabase,
    userId,
    trips,
    vehicleId,
  });
  const enriched = await Promise.all(
    withEnergy.slice(0, enrichLimit).map(async (trip) => {
      const temps = await tripOutsideTempAvg(supabase, userId, vehicleId, trip);
      return { ...trip, outside_temp_avg: temps?.outsideTempAvg ?? null };
    }),
  );
  return [...enriched, ...withEnergy.slice(enrichLimit)];
}
