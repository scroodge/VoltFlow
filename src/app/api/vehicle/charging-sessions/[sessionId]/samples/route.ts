import { NextRequest, NextResponse } from "next/server";

import { fetchChargingSessionSamples } from "@/lib/bydmate/telemetry-history";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { sessionId } = await context.params;
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const vehicleId = request.nextUrl.searchParams.get("vehicle_id")?.trim() || "way";

  try {
    const points = await fetchChargingSessionSamples({
      supabase,
      userId: userData.user.id,
      sessionId,
      vehicleId,
    });

    return NextResponse.json(
      { sessionId, vehicleId, points },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Failed to load charging samples" },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
