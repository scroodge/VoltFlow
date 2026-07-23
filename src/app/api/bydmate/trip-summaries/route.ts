import { parseTripSummaryBatch } from "@/lib/bydmate/trip-summary-payload";
import { resolveBydmateApiKeyProfile } from "@/lib/bydmate/api-auth";
import { createServiceClient } from "@/lib/supabase/service";
import {
  readBodyWithLimit,
  RequestBodyTooLargeError,
} from "@/lib/api/read-body";

export const runtime = "nodejs";
const MAX_TRIP_SUMMARIES_BODY_BYTES = 1_000_000;

// Per-trip aggregates from a BYD model's own energydata trip log (no ADB,
// no telemetry samples, no GPS track). See supabase/TELEMETRY.md and
// BACKLOG "energydata trip-summary cloud sync". Auth mirrors
// Uses the same hashed API-key lookup as /api/bydmate/telemetry.
export async function POST(request: Request) {
  const apiKey = request.headers.get("x-api-key") ?? "";
  const vehicleId = request.headers.get("x-vehicle-id")?.trim();
  if (!vehicleId) {
    return Response.json({ ok: false, error: "Missing X-Vehicle-Id" }, { status: 400 });
  }

  let supabase: ReturnType<typeof createServiceClient>;
  let profile: Awaited<ReturnType<typeof resolveBydmateApiKeyProfile>>;
  try {
    supabase = createServiceClient();
    profile = await resolveBydmateApiKeyProfile(supabase, apiKey);
  } catch {
    return Response.json({ ok: false, error: "Key lookup failed" }, { status: 500 });
  }
  if (!profile) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let json: unknown;
  try {
    const body = await readBodyWithLimit(request, MAX_TRIP_SUMMARIES_BODY_BYTES);
    json = JSON.parse(new TextDecoder().decode(body));
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return Response.json({ ok: false, error: "Payload too large" }, { status: 413 });
    }
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
