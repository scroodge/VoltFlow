import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { isStationaryChargingLikeTrip } from "@/lib/bydmate/trip-filter";
import { calculateTripEnergy } from "@/lib/bydmate/trip-energy";
import { createClient } from "@/lib/supabase/server";
import type { BydmateTelemetry, BydmateTripRow } from "@/types/database";

type TripSampleRow = {
  vehicle_id: string;
  device_time: string;
  telemetry: BydmateTelemetry;
};

function tripEndTime(trip: Pick<BydmateTripRow, "ended_at" | "last_device_time">) {
  return trip.ended_at ?? trip.last_device_time;
}

async function attachTripEnergy({
  supabase,
  userId,
  trips,
  vehicleId,
}: {
  supabase: SupabaseClient;
  userId: string;
  trips: BydmateTripRow[];
  vehicleId?: string;
}) {
  if (trips.length === 0) return trips;

  const from = trips.reduce((min, trip) => (
    Date.parse(trip.started_at) < Date.parse(min) ? trip.started_at : min
  ), trips[0].started_at);
  const to = trips.reduce((max, trip) => (
    Date.parse(tripEndTime(trip)) > Date.parse(max) ? tripEndTime(trip) : max
  ), tripEndTime(trips[0]));

  let query = supabase
    .from("bydmate_telemetry_samples")
    .select("vehicle_id, device_time, telemetry")
    .eq("user_id", userId)
    .gte("device_time", from)
    .lte("device_time", to)
    .order("device_time", { ascending: true })
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

  return trips.flatMap((trip) => {
    const points = (samplesByTrip.get(trip.id) ?? []).map((sample) => ({
      device_time: sample.device_time,
      power_kw: sample.telemetry?.power_kw,
      speed_kmh: sample.telemetry?.speed_kmh,
      current_trip_distance_km: sample.telemetry?.current_trip_distance_km,
    }));

    if (isStationaryChargingLikeTrip(trip, points)) {
      return [];
    }

    const energy = calculateTripEnergy(points);
    return [{ ...trip, ...energy }];
  });
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const date = params.get("date");
  const vehicleId = params.get("vehicle_id")?.trim();
  const limit = Math.min(Math.max(Number(params.get("limit") ?? 1) || 1, 1), 20);

  if (!date) {
    const queryLimit = Math.min(limit * 4, 80);
    let latestQuery = supabase
      .from("bydmate_trips")
      .select("*")
      .eq("user_id", userData.user.id)
      .order("started_at", { ascending: false })
      .limit(queryLimit);

    if (vehicleId) {
      latestQuery = latestQuery.eq("vehicle_id", vehicleId);
    }

    const { data, error } = await latestQuery;
    if (error) {
      return NextResponse.json({ error: "Failed to load trips" }, { status: 500 });
    }

    const trips = await attachTripEnergy({
      supabase,
      userId: userData.user.id,
      trips: (data ?? []) as BydmateTripRow[],
      vehicleId,
    });

    return NextResponse.json({ trips: trips.slice(0, limit) });
  }

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  const dayStart = `${date}T00:00:00.000Z`;
  const dayEnd = `${date}T23:59:59.999Z`;

  let query = supabase
    .from("bydmate_trips")
    .select("*")
    .eq("user_id", userData.user.id)
    .lte("started_at", dayEnd)
    .or(`ended_at.is.null,ended_at.gte.${dayStart}`)
    .order("started_at", { ascending: false });

  if (vehicleId) {
    query = query.eq("vehicle_id", vehicleId);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: "Failed to load trips" }, { status: 500 });
  }

  const trips = await attachTripEnergy({
    supabase,
    userId: userData.user.id,
    trips: (data ?? []) as BydmateTripRow[],
    vehicleId,
  });

  return NextResponse.json({ date, trips });
}
