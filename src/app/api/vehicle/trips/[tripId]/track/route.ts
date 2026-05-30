import { NextRequest, NextResponse } from "next/server";

import { sanitizeTripTrackPoints } from "@/lib/bydmate/telemetry-sanitizer";
import { resolveVehicleApiAccess } from "@/lib/dev/dev-api-auth";

type RouteContext = {
  params: Promise<{ tripId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const access = await resolveVehicleApiAccess(request);
  if (!access) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { tripId } = await context.params;

  const { data: trip, error: tripError } = await access.supabase
    .from("bydmate_trips")
    .select("id")
    .eq("id", tripId)
    .eq("user_id", access.userId)
    .maybeSingle();

  if (tripError || !trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  const { data, error } = await access.supabase
    .from("bydmate_trip_track_points")
    .select("device_time, lat, lon, accuracy_m, bearing_deg, speed_kmh, power_kw, soc")
    .eq("trip_id", tripId)
    .eq("user_id", access.userId)
    .order("device_time", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "Failed to load trip track" }, { status: 500 });
  }

  const track = sanitizeTripTrackPoints(data ?? []);

  return NextResponse.json({
    tripId,
    points: track.points,
    droppedPointCount: track.droppedPointCount,
  });
}
