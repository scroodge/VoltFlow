import { NextRequest, NextResponse } from "next/server";

import { fetchChargingSessionSamples } from "@/lib/bydmate/telemetry-history";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

async function resolveVehicleIdForSession({
  supabase,
  userId,
  sessionId,
  queryVehicleId,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  sessionId: string;
  queryVehicleId: string | null;
}): Promise<string> {
  if (queryVehicleId) return queryVehicleId;

  const { data: session, error: sessionError } = await supabase
    .from("charging_sessions")
    .select("car_id")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (sessionError) throw sessionError;

  const carId = session?.car_id as string | undefined;
  if (!carId) return "way";

  const { data: car, error: carError } = await supabase
    .from("cars")
    .select("vehicle_alias")
    .eq("id", carId)
    .eq("user_id", userId)
    .maybeSingle();
  if (carError) throw carError;

  return (car?.vehicle_alias as string | null | undefined)?.trim() || "way";
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { sessionId } = await context.params;
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const vehicleId = await resolveVehicleIdForSession({
      supabase,
      userId: userData.user.id,
      sessionId,
      queryVehicleId: request.nextUrl.searchParams.get("vehicle_id")?.trim() || null,
    });

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
