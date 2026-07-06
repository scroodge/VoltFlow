import { parseTripSummaryBatch } from "@/lib/bydmate/trip-summary-payload";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

// Per-trip aggregates from a BYD model's own energydata trip log (no ADB,
// no telemetry samples, no GPS track). See supabase/TELEMETRY.md and
// BACKLOG "energydata trip-summary cloud sync". Auth mirrors
// /api/bydmate/telemetry: X-Api-Key -> profiles.bydmate_cloud_api_key.
export async function POST(request: Request) {
  const apiKey = request.headers.get("x-api-key") ?? "";
  const vehicleId = request.headers.get("x-vehicle-id")?.trim();
  if (!vehicleId) {
    return Response.json({ ok: false, error: "Missing X-Vehicle-Id" }, { status: 400 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = parseTripSummaryBatch(json);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: "Invalid payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const supabase = createServiceClient();
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id")
      .eq("bydmate_cloud_api_key", apiKey)
      .maybeSingle();

    if (profileError) {
      return Response.json({ ok: false, error: "Key lookup failed" }, { status: 500 });
    }
    if (!profile?.id) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { data: result, error: ingestError } = await supabase.rpc(
      "bydmate_ingest_trip_summaries",
      {
        p_user_id: profile.id,
        p_vehicle_id: vehicleId,
        p_trips: parsed.data,
      },
    );

    if (ingestError) {
      return Response.json({ ok: false, error: "Ingest failed" }, { status: 500 });
    }

    return Response.json({
      ok: true,
      vehicle_id: vehicleId,
      ...(result as { inserted: number; updated: number }),
    });
  } catch {
    return Response.json({ ok: false, error: "Receiver failed" }, { status: 500 });
  }
}
