import type { SupabaseClient } from "@supabase/supabase-js";

import { isJunkTrip } from "@/lib/voltflowmate/trip-filter";
import { calculateTripEnergy } from "@/lib/voltflowmate/trip-energy";
import type { VoltflowMateTelemetry, VoltflowMateTripRow } from "@/types/database";

type TripSampleRow = {
  vehicle_id: string;
  device_time: string;
  telemetry: VoltflowMateTelemetry;
};

function tripEndTime(trip: Pick<VoltflowMateTripRow, "ended_at" | "last_device_time">) {
  return trip.ended_at ?? trip.last_device_time;
}

async function loadTripPowerSamples({
  supabase,
  userId,
  trips,
  vehicleId,
}: {
  supabase: SupabaseClient;
  userId: string;
  trips: VoltflowMateTripRow[];
  vehicleId?: string;
}) {
  const from = trips.reduce(
    (min, trip) => (Date.parse(trip.started_at) < Date.parse(min) ? trip.started_at : min),
    trips[0].started_at,
  );
  const to = trips.reduce(
    (max, trip) => (Date.parse(tripEndTime(trip)) > Date.parse(max) ? tripEndTime(trip) : max),
    tripEndTime(trips[0]),
  );

  let query = supabase
    .from("bydmate_telemetry_samples")
    .select("vehicle_id, device_time, telemetry")
    .eq("user_id", userId)
    .gte("device_time", from)
    .lte("device_time", to)
    .order("device_time", { ascending: false })
    .limit(10000);

  if (vehicleId) {
    query = query.eq("vehicle_id", vehicleId);
  }

  const { data, error } = await query;
  if (error) throw error;

  const samples = (data ?? []) as TripSampleRow[];
  const samplesByTrip = new Map<string, TripSampleRow[]>();

  for (const sample of samples) {
    const sampleMs = Date.parse(sample.device_time);
    if (!Number.isFinite(sampleMs)) continue;

    const trip = trips.find((candidate) => {
      if (candidate.vehicle_id !== sample.vehicle_id) return false;
      return (
        sampleMs >= Date.parse(candidate.started_at) &&
        sampleMs <= Date.parse(tripEndTime(candidate))
      );
    });
    if (!trip) continue;

    const rows = samplesByTrip.get(trip.id) ?? [];
    rows.push(sample);
    samplesByTrip.set(trip.id, rows);
  }

  return samplesByTrip;
}

function powerPointsForTrip(samplesByTrip: Map<string, TripSampleRow[]>, tripId: string) {
  return (samplesByTrip.get(tripId) ?? [])
    .slice()
    .reverse()
    .map((sample) => ({
      device_time: sample.device_time,
      power_kw: sample.telemetry?.power_kw,
      speed_kmh: sample.telemetry?.speed_kmh,
      current_trip_distance_km: sample.telemetry?.current_trip_distance_km,
    }));
}

function mergeTripEnergy(trip: VoltflowMateTripRow, samplesByTrip: Map<string, TripSampleRow[]>) {
  if (
    typeof trip.regen_energy_kwh === "number" &&
    typeof trip.traction_energy_kwh === "number"
  ) {
    return trip;
  }

  const points = powerPointsForTrip(samplesByTrip, trip.id);
  const energy = calculateTripEnergy(points);
  return { ...trip, ...energy };
}

/** Enrich all trips with regen/traction from power samples (analytics — no display filtering). */
export async function enrichTripsWithEnergy({
  supabase,
  userId,
  trips,
  vehicleId,
}: {
  supabase: SupabaseClient;
  userId: string;
  trips: VoltflowMateTripRow[];
  vehicleId?: string;
}): Promise<VoltflowMateTripRow[]> {
  if (trips.length === 0) return trips;

  const samplesByTrip = await loadTripPowerSamples({ supabase, userId, trips, vehicleId });
  return trips.map((trip) => mergeTripEnergy(trip, samplesByTrip));
}

/** Enrich trips and drop junk rows (micro stationary / charging-like) for the trip browser. */
export async function attachTripEnergy({
  supabase,
  userId,
  trips,
  vehicleId,
}: {
  supabase: SupabaseClient;
  userId: string;
  trips: VoltflowMateTripRow[];
  vehicleId?: string;
}) {
  if (trips.length === 0) return trips;

  const samplesByTrip = await loadTripPowerSamples({ supabase, userId, trips, vehicleId });

  return trips.flatMap((trip) => {
    if (
      typeof trip.regen_energy_kwh === "number" &&
      typeof trip.traction_energy_kwh === "number"
    ) {
      if (isJunkTrip(trip)) return [];
      return [trip];
    }

    const points = powerPointsForTrip(samplesByTrip, trip.id);

    if (isJunkTrip(trip, points)) {
      return [];
    }

    return [mergeTripEnergy(trip, samplesByTrip)];
  });
}
