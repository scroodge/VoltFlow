import { z } from "zod";

import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

const telemetrySchema = z
  .object({
    soc: z.number().nullable().optional(),
    speed_kmh: z.number().nullable().optional(),
    power_kw: z.number().nullable().optional(),
    battery_temp_c: z.number().nullable().optional(),
    cabin_temp_c: z.number().nullable().optional(),
    outside_temp_c: z.number().nullable().optional(),
    battery_voltage_v: z.number().nullable().optional(),
    aux_voltage_v: z.number().nullable().optional(),
    odometer_km: z.number().nullable().optional(),
    soh_percent: z.number().nullable().optional(),
    is_charging: z.boolean().nullable().optional(),
    charge_power_kw: z.number().nullable().optional(),
    charge_type: z.string().nullable().optional(),
    kwh_charged: z.number().nullable().optional(),
    range_est_km: z.number().nullable().optional(),
    current_trip_distance_km: z.number().nullable().optional(),
    current_trip_consumption_kwh_100km: z.number().nullable().optional(),
  })
  .passthrough();

const locationSchema = z
  .object({
    lat: z.number().nullable().optional(),
    lon: z.number().nullable().optional(),
    accuracy_m: z.number().nullable().optional(),
    bearing_deg: z.number().nullable().optional(),
  })
  .passthrough();

const payloadSchema = z
  .object({
    schema_version: z.literal(1),
    vehicle_id: z.string().min(1).max(160),
    device_time: z.string().min(1).max(80),
    source: z.literal("BYDMate"),
    telemetry: telemetrySchema,
    location: locationSchema,
  })
  .passthrough();

const batchPayloadSchema = z.union([
  z.array(payloadSchema).min(1).max(300),
  z
    .object({
      samples: z.array(payloadSchema).min(1).max(300),
    })
    .passthrough(),
]);

function normalizePayloads(json: unknown) {
  const batchParsed = batchPayloadSchema.safeParse(json);
  if (batchParsed.success) {
    return {
      success: true as const,
      payloads: Array.isArray(batchParsed.data) ? batchParsed.data : batchParsed.data.samples,
    };
  }

  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success) {
    return {
      success: false as const,
      issues: parsed.error.flatten().fieldErrors,
    };
  }

  return {
    success: true as const,
    payloads: [parsed.data],
  };
}

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

  const samples = parsedSamples.map(({ payload, deviceTime }) => ({
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
      received_at: receivedAt,
      ingest: ingestResult,
    });
  } catch {
    return Response.json({ ok: false, error: "Receiver failed" }, { status: 500 });
  }
}
