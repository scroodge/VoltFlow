import { NextRequest, NextResponse } from "next/server";

import { saveRoutePreference } from "@/lib/voltflowmate/route-insights";
import { devVehicleId, resolveVehicleApiAccess } from "@/lib/dev/dev-api-auth";

export async function PUT(request: NextRequest) {
  const access = await resolveVehicleApiAccess(request);
  if (!access) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { vehicle_id?: string; route_id?: string; name?: string; is_park?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const vehicleId = body.vehicle_id?.trim() || devVehicleId(request);
  const routeId = body.route_id?.trim();

  if (!vehicleId || !routeId) {
    return NextResponse.json({ error: "Missing vehicle_id or route_id" }, { status: 400 });
  }

  if (body.name === undefined && body.is_park === undefined) {
    return NextResponse.json({ error: "Missing name or is_park" }, { status: 400 });
  }

  try {
    const saved = await saveRoutePreference({
      supabase: access.supabase,
      userId: access.userId,
      vehicleId,
      routeId,
      name: body.name,
      isPark: body.is_park,
    });
    return NextResponse.json(saved);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save route preference";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
