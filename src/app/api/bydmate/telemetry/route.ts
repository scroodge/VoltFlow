import { normalizePayloads } from "@/lib/bydmate/ingest-payload";
import {
  acceptedLocationFromSnapshot,
  acceptedTelemetryFromSnapshot,
  sanitizePayloadLocations,
  sanitizePayloadTelemetry,
  type AcceptedLocation,
  type AcceptedTelemetry,
} from "@/lib/bydmate/telemetry-sanitizer";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const apiKey = request.headers.get("x-api-key") ?? "";
  const headerVehicleId = request.headers.get("x-vehicle-id")?.trim();
  if (!headerVehicleId) {
    return Response.json({ ok: false, error: "Missing X-Vehicle-Id" }, { status: 400 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const normalized = normalizePayloads(json);
  if (!normalized.success) {
    return Response.json(
      { ok: false, error: "Invalid payload", issues: normalized.issues },
      { status: 400 },
    );
  }

  const payloads = normalized.payloads;
  const mismatchedPayload = payloads.find((payload) => payload.vehicle_id !== headerVehicleId);
  if (mismatchedPayload) {
    return Response.json({ ok: false, error: "Vehicle ID mismatch" }, { status: 400 });
  }

  const receivedAt = new Date().toISOString();
  const parsedSamples = payloads.map((payload) => ({
    payload,
    deviceTime: new Date(payload.device_time),
  }));

  if (parsedSamples.some((sample) => Number.isNaN(sample.deviceTime.getTime()))) {
    return Response.json({ ok: false, error: "Invalid device_time" }, { status: 400 });
  }

  const normalizedSamples = parsedSamples.map(({ payload, deviceTime }) => ({
    ...payload,
    device_time: deviceTime.toISOString(),
  }));

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

    const vehicleIds = Array.from(new Set(normalizedSamples.map((sample) => sample.vehicle_id)));
    const { data: previousRows, error: previousError } = await supabase
      .from("bydmate_live_snapshots")
      .select("vehicle_id, device_time, telemetry, location")
      .eq("user_id", profile.id)
      .in("vehicle_id", vehicleIds);

    if (previousError) {
      return Response.json({ ok: false, error: "Previous telemetry lookup failed" }, { status: 500 });
    }

    const previousLocations = new Map<string, AcceptedLocation>();
    const previousTelemetry = new Map<string, AcceptedTelemetry>();
    for (const row of previousRows ?? []) {
      const accepted = acceptedLocationFromSnapshot(row);
      if (accepted) previousLocations.set(accepted.vehicleId, accepted.location);

      const telemetry = acceptedTelemetryFromSnapshot(row);
      if (telemetry) previousTelemetry.set(telemetry.vehicleId, telemetry.telemetry);
    }

    const { payloads: locationSanitizedSamples, droppedLocations } = sanitizePayloadLocations(
      normalizedSamples,
      previousLocations,
    );
    const { payloads: samples, droppedTelemetryFields } = sanitizePayloadTelemetry(
      locationSanitizedSamples,
      previousTelemetry,
    );

    const { data: ingestResult, error: ingestError } =
      samples.length === 1
        ? await supabase.rpc("bydmate_ingest_telemetry", {
            p_user_id: profile.id,
            p_vehicle_id: samples[0].vehicle_id,
            p_source: samples[0].source,
            p_schema_version: samples[0].schema_version,
            p_device_time: samples[0].device_time,
            p_received_at: receivedAt,
            p_telemetry: samples[0].telemetry,
            p_diplus: samples[0].diplus ?? {},
            p_location: samples[0].location ?? {},
            p_raw_payload: samples[0],
          })
        : await supabase.rpc("bydmate_ingest_telemetry_batch", {
            p_user_id: profile.id,
            p_received_at: receivedAt,
            p_samples: samples,
          });

    if (ingestError) {
      return Response.json({ ok: false, error: "Telemetry ingest failed" }, { status: 500 });
    }

    return Response.json({
      ok: true,
      vehicle_id: headerVehicleId,
      sample_count: samples.length,
      dropped_location_count: droppedLocations,
      dropped_telemetry_field_count: droppedTelemetryFields,
      received_at: receivedAt,
      ingest: ingestResult,
    });
  } catch {
    return Response.json({ ok: false, error: "Receiver failed" }, { status: 500 });
  }
}
