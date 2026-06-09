import { NextRequest, NextResponse } from "next/server";

import { fetchSohTelemetryHistory } from "@/lib/bydmate/telemetry-history";
import { resolveVehicleApiAccess } from "@/lib/dev/dev-api-auth";

export async function GET(request: NextRequest) {
  const access = await resolveVehicleApiAccess(request);
  if (!access) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const anchorDate = params.get("date") ?? new Date().toISOString().slice(0, 10);
  const vehicleId = params.get("vehicle_id")?.trim() || null;

  try {
    const points = await fetchSohTelemetryHistory({
      supabase: access.supabase,
      userId: access.userId,
      vehicleId,
      anchorDate,
    });

    return NextResponse.json({ anchorDate, points });
  } catch {
    return NextResponse.json({ error: "Failed to load SOH history" }, { status: 500 });
  }
}
