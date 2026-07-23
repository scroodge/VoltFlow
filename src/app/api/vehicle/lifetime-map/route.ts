import { NextRequest, NextResponse } from "next/server";

import { fetchLifetimeTrackPoints } from "@/lib/vehicle-analytics";
import { devVehicleId, resolveVehicleApiAccess } from "@/lib/dev/dev-api-auth";

export async function GET(request: NextRequest) {
  const access = await resolveVehicleApiAccess(request);
  if (!access) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const vehicleId = request.nextUrl.searchParams.get("vehicle_id")?.trim() || devVehicleId(request);
  if (!vehicleId) {
    return NextResponse.json({ error: "vehicle_id is required" }, { status: 400 });
  }

  try {
    const points = await fetchLifetimeTrackPoints({
      supabase: access.supabase,
      userId: access.userId,
      vehicleId,
    });
    return NextResponse.json({ vehicleId, points });
  } catch {
    return NextResponse.json({ error: "Failed to load lifetime map" }, { status: 500 });
  }
}
