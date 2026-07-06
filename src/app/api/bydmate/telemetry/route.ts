import { processBydmateAutoChargingSessions } from "@/lib/bydmate/charging-auto-session";
import { reconcileChargingSessionsForUser } from "@/lib/charging-session-reconcile";
import { normalizePayloads } from "@/lib/bydmate/ingest-payload";
import { parseIngestStats } from "@/lib/bydmate/ingest-stats";
import { processBydmateChargeNotifications } from "@/lib/push/charge-notifications";
import { updateTelegramLiveWidgets } from "@/lib/telegram/live-widget";
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

function persistenceError(
  sample: TelemetryPayload,
  persisted: PersistedTelemetryResponse | null,
  persistedRow: PersistedTelemetryRow | null,
) {
  if (!persisted || !persistedRow) return "telemetry missing after persist";

  // The `diplus` column check below already proves the sample persisted; we no
  // longer re-read the full `raw_payload` blob just to re-check its diplus (that
  // re-read was a large per-request Supabase egress cost).
  if (isNonEmptyRecord(sample.diplus) && !isNonEmptyRecord(persisted.diplus)) {
    return "diplus missing after persist";
  }

  const expected = expectedCellVoltage(sample);
  const missingCellVoltage =
    (expected.min != null && persisted.diplus_min_cell_voltage_v == null) ||
    (expected.max != null && persisted.diplus_max_cell_voltage_v == null) ||
    (expected.delta != null && persisted.diplus_cell_delta_v == null);

  if (missingCellVoltage) return "cell voltage missing after persist";

  return null;
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
      .select("id, vehicle_connected_at")
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

    // First-ever telemetry for this user → mark the car connected so the
    // post-login onboarding gate clears. The null guard keeps this a one-time
    // write; once set the column is non-null and we skip on every later ingest.
    if (!profile.vehicle_connected_at) {
      await supabase
        .from("profiles")
        .update({ vehicle_connected_at: new Date().toISOString() })
        .eq("id", profile.id)
        .is("vehicle_connected_at", null);
    }

    const lastSample = samples.at(-1);
    const { data: persistedRow, error: persistedError } = lastSample
      ? await supabase
          .from("bydmate_live_snapshots")
          .select(
            "vehicle_id, received_at, device_time, diplus, diplus_min_cell_voltage_v, diplus_max_cell_voltage_v, diplus_cell_delta_v",
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

    let telegramWidgets = { updated: 0 };
    try {
      telegramWidgets = await updateTelegramLiveWidgets({
        supabase,
        userId: profile.id,
        samples,
        receivedAt,
      });
    } catch {
      telegramWidgets = { updated: 0 };
    }

    let autoChargingSessions: {
      started: number;
      stopped: number;
      sessionIds: string[];
      error?: string;
    } = { started: 0, stopped: 0, sessionIds: [] };
    try {
      autoChargingSessions = await processBydmateAutoChargingSessions({
        supabase,
        userId: profile.id,
        samples,
      });
    } catch (autoSessionError) {
      const message =
        autoSessionError instanceof Error ? autoSessionError.message : "Auto session failed";
      console.error("bydmate auto charging session:", message);
      autoChargingSessions = { started: 0, stopped: 0, sessionIds: [], error: message };
    }

    // Only reconcile when auto-session processing actually opened/closed a row.
    // Reconcile reads sessions + samples back from Supabase, so running it on
    // every ~1Hz sample was a large, mostly-redundant CPU + egress cost. The
    // session-list load path (/api/vehicle/sessions) still reconciles, so any
    // rows broken while no auto event fired are repaired when the list loads.
    let chargingSessionReconcile = { reconciled: 0, sessionIds: [] as string[] };
    if (autoChargingSessions.started || autoChargingSessions.stopped) {
      try {
        chargingSessionReconcile = await reconcileChargingSessionsForUser({
          supabase,
          userId: profile.id,
          vehicleIds: [headerVehicleId],
        });
      } catch (reconcileError) {
        const message =
          reconcileError instanceof Error ? reconcileError.message : "Reconcile failed";
        console.error("charging session reconcile:", message);
      }
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
      telegram_live_widgets: telegramWidgets,
      auto_charging_sessions: autoChargingSessions,
      charging_session_reconcile: chargingSessionReconcile,
      received_at: receivedAt,
      ingest: ingestResult,
    });
  } catch {
    return Response.json({ ok: false, error: "Receiver failed" }, { status: 500 });
  }
}
