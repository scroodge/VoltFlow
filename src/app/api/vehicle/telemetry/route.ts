import { NextRequest, NextResponse } from "next/server";

import { fetchTelemetryHistory } from "@/lib/bydmate/telemetry-history";
import { parseTelemetryRange } from "@/lib/bydmate/telemetry-ranges";
import { resolveVehicleApiAccess } from "@/lib/dev/dev-api-auth";

export async function GET(request: NextRequest) {
  const access = await resolveVehicleApiAccess(request);
  if (!access) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const range = parseTelemetryRange(params.get("range"));
  const anchorDate = params.get("date") ?? new Date().toISOString().slice(0, 10);
  const vehicleId = params.get("vehicle_id")?.trim() || null;

  try {
    const points = await fetchTelemetryHistory({
      supabase: access.supabase,
      userId: access.userId,
      vehicleId,
      range,
      anchorDate,
    });

    return NextResponse.json({ range, anchorDate, points });
  } catch {
    return NextResponse.json({ error: "Failed to load telemetry history" }, { status: 500 });
  }
}
