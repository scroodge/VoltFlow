import { processBydmateAutoChargingSessions } from "@/lib/bydmate/charging-auto-session";
import { normalizePayloads } from "@/lib/bydmate/ingest-payload";
import { processBydmateChargeNotifications } from "@/lib/push/charge-notifications";
import {
  acceptedLocationFromSnapshot,
  acceptedTelemetryFromSnapshot,
  sanitizePayloadLocations,
  sanitizePayloadTelemetry,
  type AcceptedLocation,
  type AcceptedTelemetry,
} from "@/lib/bydmate/telemetry-sanitizer";
import { createServiceClient } from "@/lib/supabase/service";
import type { TelemetryPayload } from "@/lib/bydmate/ingest-payload";

export const runtime = "nodejs";

type PersistedTelemetryRow = {
  vehicle_id: string;
  received_at: string;
  device_time: string;
  diplus: unknown;
  raw_payload: unknown;
  diplus_min_cell_voltage_v: unknown;
  diplus_max_cell_voltage_v: unknown;
  diplus_cell_delta_v: unknown;
};

type PersistedTelemetryResponse = {
  vehicle_id: string;
  received_at: string;
  device_time: string;
  diplus: unknown;
  diplus_min_cell_voltage_v: number | null;
  diplus_max_cell_voltage_v: number | null;
  diplus_cell_delta_v: number | null;
};

function finiteNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  return null;
}

function firstFiniteNumber(...values: unknown[]) {
  for (const value of values) {
    const n = finiteNumber(value);
    if (n != null) return n;
  }

  return null;
}

function isNonEmptyRecord(value: unknown) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0
  );
}

function expectedCellVoltage(sample: TelemetryPayload) {
  const min = firstFiniteNumber(
    sample.telemetry.diplus_min_cell_voltage_v,
    sample.telemetry.cell_voltage_min_v,
    sample.diplus?.min_cell_voltage_v,
  );
  const max = firstFiniteNumber(
    sample.telemetry.diplus_max_cell_voltage_v,
    sample.telemetry.cell_voltage_max_v,
    sample.diplus?.max_cell_voltage_v,
  );
  const explicitDelta = firstFiniteNumber(
    sample.telemetry.diplus_cell_delta_v,
    sample.telemetry.cell_delta_v,
    sample.diplus?.cell_delta_v,
  );

  return {
    min,
    max,
    delta: explicitDelta ?? (min != null && max != null ? max - min : null),
  };
}

function persistedTelemetry(row: PersistedTelemetryRow): PersistedTelemetryResponse {
  return {
    vehicle_id: row.vehicle_id,
    received_at: row.received_at,
    device_time: row.device_time,
    diplus: row.diplus,
    diplus_min_cell_voltage_v: finiteNumber(row.diplus_min_cell_voltage_v),
    diplus_max_cell_voltage_v: finiteNumber(row.diplus_max_cell_voltage_v),
    diplus_cell_delta_v: finiteNumber(row.diplus_cell_delta_v),
  };
}

function rawPayloadDiplus(row: PersistedTelemetryRow) {
  if (!row.raw_payload || typeof row.raw_payload !== "object" || Array.isArray(row.raw_payload)) {
    return null;
  }

  return "diplus" in row.raw_payload ? row.raw_payload.diplus : null;
}

function persistenceError(
  sample: TelemetryPayload,
  persisted: PersistedTelemetryResponse | null,
  persistedRow: PersistedTelemetryRow | null,
) {
  if (!persisted || !persistedRow) return "telemetry missing after persist";

  if (isNonEmptyRecord(sample.diplus) && !isNonEmptyRecord(persisted.diplus)) {
    return "diplus missing after persist";
  }

  if (isNonEmptyRecord(sample.diplus) && !isNonEmptyRecord(rawPayloadDiplus(persistedRow))) {
    return "raw payload diplus missing after persist";
  }

  const expected = expectedCellVoltage(sample);
  const missingCellVoltage =
    (expected.min != null && persisted.diplus_min_cell_voltage_v == null) ||
    (expected.max != null && persisted.diplus_max_cell_voltage_v == null) ||
    (expected.delta != null && persisted.diplus_cell_delta_v == null);

  if (missingCellVoltage) return "cell voltage missing after persist";

  return null;
}

function parseIngestStats(result: unknown, payloadCount: number) {
  if (!result || typeof result !== "object") {
    return {
      inserted_count: payloadCount,
      skipped_stale_count: 0,
      duplicate_count: 0,
    };
  }

  const record = result as Record<string, unknown>;
  const inserted =
    typeof record.sample_count === "number"
      ? record.sample_count
      : record.duplicate === true
        ? 0
        : 1;
  const skippedStale =
    typeof record.skipped_stale_count === "number" ? record.skipped_stale_count : 0;
  const duplicate = Math.max(0, payloadCount - inserted - skippedStale);

  return {
    inserted_count: inserted,
    skipped_stale_count: skippedStale,
    duplicate_count: duplicate,
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

  // Normalize vehicle_id in every payload to the header value.
  // The header reflects the user's current APK setting; stale queue items
  // may carry an old vehicle_id baked in at enqueue time. Rewriting here
  // prevents a 400 mismatch that would mark those items non-retryable in
  // the APK and silently drain the queue.
  const payloads = normalized.payloads.map((p) =>
    p.vehicle_id !== headerVehicleId ? { ...p, vehicle_id: headerVehicleId } : p,
  );

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

    const previousTelemetryBeforeSanitize = new Map(previousTelemetry);
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
            p_diplus: samples[0].diplus ?? null,
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

    const lastSample = samples.at(-1);
    const { data: persistedRow, error: persistedError } = lastSample
      ? await supabase
          .from("bydmate_live_snapshots")
          .select(
            "vehicle_id, received_at, device_time, diplus, raw_payload, diplus_min_cell_voltage_v, diplus_max_cell_voltage_v, diplus_cell_delta_v",
          )
          .eq("user_id", profile.id)
          .eq("vehicle_id", lastSample.vehicle_id)
          .maybeSingle()
      : { data: null, error: null };

    if (persistedError) {
      return Response.json({ ok: false, error: "Persisted telemetry lookup failed" }, { status: 500 });
    }

    const persisted = persistedRow ? persistedTelemetry(persistedRow) : null;
    const error = lastSample
      ? persistenceError(lastSample, persisted, persistedRow)
      : "telemetry missing after persist";

    if (error) {
      return Response.json({
        ok: false,
        error,
        persisted,
      });
    }

    let chargeNotifications = { sent: 0, thresholds: [] as number[] };
    try {
      chargeNotifications = await processBydmateChargeNotifications({
        supabase,
        userId: profile.id,
        samples,
        previousTelemetry: previousTelemetryBeforeSanitize,
      });
    } catch {
      chargeNotifications = { sent: 0, thresholds: [] };
    }

    let autoChargingSessions = { started: 0, stopped: 0, sessionIds: [] as string[] };
    try {
      autoChargingSessions = await processBydmateAutoChargingSessions({
        supabase,
        userId: profile.id,
        samples,
      });
    } catch {
      autoChargingSessions = { started: 0, stopped: 0, sessionIds: [] };
    }

    return Response.json({
      ok: true,
      persisted,
      vehicle_id: headerVehicleId,
      sample_count: samples.length,
      ...parseIngestStats(ingestResult, samples.length),
      dropped_location_count: droppedLocations,
      dropped_telemetry_field_count: droppedTelemetryFields,
      charge_notifications: chargeNotifications,
      auto_charging_sessions: autoChargingSessions,
      received_at: receivedAt,
      ingest: ingestResult,
    });
  } catch {
    return Response.json({ ok: false, error: "Receiver failed" }, { status: 500 });
  }
}
