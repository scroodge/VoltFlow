import { notFound } from "next/navigation";

import { createServiceClient } from "@/lib/supabase/service";
import { mapChargingSession } from "@/lib/db-map";
import { calculateTripEnergy } from "@/lib/bydmate/trip-energy";
import { isStationaryChargingLikeTrip, isSingleSampleTrip } from "@/lib/bydmate/trip-filter";
import { HistoryDevClient } from "./HistoryDevClient";
import type { BydmateTelemetry, BydmateTripRow } from "@/types/database";

export const dynamic = "force-dynamic";

const VEHICLE_ID = "way";

export default async function DevHistoryPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const supabase = createServiceClient();

  // Fetch trips for the "way" vehicle first — user_id comes from these rows
  const [{ data: tripRows }, { data: liveRows }] = await Promise.all([
    supabase
      .from("bydmate_trips")
      .select("*")
      .eq("vehicle_id", VEHICLE_ID)
      .order("started_at", { ascending: false })
      .limit(100),
    supabase
      .from("bydmate_live_snapshots")
      .select("user_id")
      .eq("vehicle_id", VEHICLE_ID)
      .order("received_at", { ascending: false })
      .limit(1),
  ]);

  const rawTrips = (tripRows ?? []) as BydmateTripRow[];
  const wayUserId =
    rawTrips[0]?.user_id ??
    ((liveRows ?? [])[0] as { user_id?: string } | undefined)?.user_id ??
    null;

  // Fetch sessions first (fast/lightweight — doesn't depend on samples)
  const sessionQuery = supabase
    .from("charging_sessions")
    .select("*")
    .not("started_at", "is", null)
    .order("started_at", { ascending: false })
    .limit(100);

  // Kick off sessions + samples in parallel
  const sessionPromise = wayUserId
    ? sessionQuery.eq("user_id", wayUserId)
    : sessionQuery;

  // Compute regen/traction energy from telemetry samples (same as /api/vehicle/trips)
  // Only fetch samples for the 20 most recent trips to keep the payload manageable
  const ENERGY_WINDOW = 20;
  const energyTrips = rawTrips.slice(0, ENERGY_WINDOW);

  const samplePromise =
    energyTrips.length > 0 && wayUserId
      ? (() => {
          const tripEndTime = (t: BydmateTripRow) => t.ended_at ?? t.last_device_time;
          const from = energyTrips.reduce(
            (min, t) => (Date.parse(t.started_at) < Date.parse(min) ? t.started_at : min),
            energyTrips[0].started_at,
          );
          const to = energyTrips.reduce(
            (max, t) => (Date.parse(tripEndTime(t)) > Date.parse(max) ? tripEndTime(t) : max),
            tripEndTime(energyTrips[0]),
          );
          return supabase
            .from("bydmate_telemetry_samples")
            .select("vehicle_id, device_time, telemetry")
            .eq("user_id", wayUserId)
            .eq("vehicle_id", VEHICLE_ID)
            .gte("device_time", from)
            .lte("device_time", to)
            .order("device_time", { ascending: false })
            .limit(5000);
        })()
      : Promise.resolve({ data: null });

  const [{ data: sessionRows }, { data: sampleRows }] = await Promise.all([
    sessionPromise,
    samplePromise,
  ]);

  // Attach energy to the recent trips
  let trips: BydmateTripRow[] = rawTrips;
  if (energyTrips.length > 0 && wayUserId) {
    const tripEndTime = (t: BydmateTripRow) => t.ended_at ?? t.last_device_time;
    const samples = (sampleRows ?? []) as { vehicle_id: string; device_time: string; telemetry: BydmateTelemetry }[];
    const samplesByTrip = new Map<string, typeof samples>();
    for (const sample of samples) {
      const sampleMs = Date.parse(sample.device_time);
      if (!Number.isFinite(sampleMs)) continue;
      const trip = energyTrips.find(
        (c) => c.vehicle_id === sample.vehicle_id &&
          sampleMs >= Date.parse(c.started_at) &&
          sampleMs <= Date.parse(tripEndTime(c)),
      );
      if (!trip) continue;
      const rows = samplesByTrip.get(trip.id) ?? [];
      rows.push(sample);
      samplesByTrip.set(trip.id, rows);
    }

    const recentWithEnergy = energyTrips.flatMap((trip) => {
      const points = (samplesByTrip.get(trip.id) ?? []).slice().reverse().map((s) => ({
        device_time: (s as { device_time: string }).device_time,
        power_kw: (s as { telemetry: BydmateTelemetry }).telemetry?.power_kw,
        speed_kmh: (s as { telemetry: BydmateTelemetry }).telemetry?.speed_kmh,
        current_trip_distance_km: (s as { telemetry: BydmateTelemetry }).telemetry?.current_trip_distance_km,
      }));
      if (isSingleSampleTrip(trip) || isStationaryChargingLikeTrip(trip, points)) return [];
      return [{ ...trip, ...calculateTripEnergy(points) }];
    });

    // Older trips: only apply the cheap single-sample filter (no energy)
    const olderFiltered = rawTrips.slice(ENERGY_WINDOW).filter(
      (trip) => !isSingleSampleTrip(trip),
    );

    trips = [...recentWithEnergy, ...olderFiltered];
  }

  const sessions = (sessionRows ?? []).map((r) =>
    mapChargingSession(r as Record<string, unknown>),
  );

  return (
    <main className="mx-auto max-w-lg">
      <HistoryDevClient sessions={sessions} trips={trips} />
    </main>
  );
}
