import { NextRequest, NextResponse } from "next/server";

import { fetchTripSamples } from "@/lib/bydmate/telemetry-history";
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

  try {
    const points = await fetchTripSamples({
      supabase: access.supabase,
      userId: access.userId,
      tripId,
    });

    return NextResponse.json({ tripId, points });
  } catch {
    return NextResponse.json({ error: "Failed to load trip samples" }, { status: 500 });
  }
}
