import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type JsonRecord = Record<string, unknown>;

const telemetryFields = [
  "soc", "speed_kmh", "power_kw", "battery_temp_c", "cabin_temp_c", "outside_temp_c",
  "battery_voltage_v", "aux_voltage_v", "cell_voltage_min_v", "cell_voltage_max_v",
  "cell_delta_v", "diplus_min_cell_voltage_v", "diplus_max_cell_voltage_v",
  "diplus_cell_delta_v", "odometer_km", "soh_percent", "is_charging", "charge_power_kw",
  "charge_type", "kwh_charged", "range_est_km", "current_trip_distance_km",
  "current_trip_consumption_kwh_100km",
] as const;
const diplusFields = [
  "soc", "speed_kmh", "mileage_km", "power_kw", "charge_gun_state", "charging_status",
  "battery_capacity_kwh", "total_elec_consumption_kwh", "voltage_12v", "max_cell_voltage_v",
  "min_cell_voltage_v", "cell_delta_v", "avg_battery_temp_c", "exterior_temp_c", "gear",
  "power_state", "inside_temp_c", "ac_status", "ac_temp_c", "fan_level", "door_fl",
  "door_fr", "door_rl", "door_rr", "window_fl_percent", "window_fr_percent",
  "window_rl_percent", "window_rr_percent", "sunroof_percent", "trunk", "hood",
  "tire_press_fl_kpa", "tire_press_fr_kpa", "tire_press_rl_kpa", "tire_press_rr_kpa",
  "drive_mode", "work_mode", "auto_park", "rain", "light_low", "drl", "sunshade_percent",
  "sentry_state", "remote_lock_state", "stall_sentry_mode", "sentry_provider", "sentry_active",
] as const;
const autoserviceFields = [
  "soc_percent", "power_kw", "gun_state", "bms_state", "charge_capacity_kwh",
  "charge_battery_volt", "battery_type", "lifetime_mileage_km", "lifetime_kwh",
] as const;
const locationFields = ["lat", "lon", "accuracy_m", "bearing_deg"] as const;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonResponse(body: JsonRecord, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickFields(record: JsonRecord, fields: readonly string[]): JsonRecord {
  return Object.fromEntries(
    fields.flatMap((field) => (field in record ? [[field, record[field]]] : [])),
  );
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function bydmateApiKeyPepper() {
  const pepper = Deno.env.get("BYDMATE_API_KEY_PEPPER")?.trim();
  if (pepper) return pepper;
  return (
    Deno.env.get("BYDMATE_LINK_CODE_PEPPER")?.trim() ||
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ||
    ""
  );
}

async function hashBydmateApiKey(apiKey: string) {
  const pepper = bydmateApiKeyPepper();
  if (!pepper) throw new Error("Missing BYDMATE_API_KEY_PEPPER");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`bydmate-api-key:${apiKey}`),
  );
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeSamples(payload: unknown) {
  if (Array.isArray(payload)) return payload;
  if (isRecord(payload) && Array.isArray(payload.samples)) return payload.samples;
  return [payload];
}

function validateSample(sample: unknown, index: number) {
  if (!isRecord(sample)) return `samples[${index}] must be an object`;
  if (asString(sample.source) !== "BYDMate") return `samples[${index}].source is invalid`;
  if (Number(sample.schema_version) !== 1) return `samples[${index}].schema_version is invalid`;
  if (asString(sample.vehicle_id).length > 160) return `samples[${index}].vehicle_id is invalid`;
  if (asString(sample.device_time) === "") return `samples[${index}].device_time is required`;
  if (!isRecord(sample.telemetry)) return `samples[${index}].telemetry must be an object`;
  if ("location" in sample && sample.location !== null && !isRecord(sample.location)) {
    return `samples[${index}].location must be an object`;
  }
  if ("diplus" in sample && sample.diplus !== null && sample.diplus !== undefined && !isRecord(sample.diplus)) {
    return `samples[${index}].diplus must be an object or null`;
  }
  if (Number.isNaN(new Date(asString(sample.device_time)).getTime())) {
    return `samples[${index}].device_time is invalid`;
  }
  return null;
}

function sanitizeSample(record: JsonRecord, vehicleId: string) {
  const telemetry = isRecord(record.telemetry) ? pickFields(record.telemetry, telemetryFields) : {};
  const diplus = isRecord(record.diplus) ? pickFields(record.diplus, diplusFields) : null;
  const location = isRecord(record.location) ? pickFields(record.location, locationFields) : {};
  const autoservice = isRecord(record.autoservice)
    ? pickFields(record.autoservice, autoserviceFields)
    : undefined;

  return {
    original_vehicle_id: asString(record.vehicle_id) || vehicleId,
    vehicle_id: vehicleId,
    source: asString(record.source) || "BYDMate",
    schema_version: Number(record.schema_version) || 1,
    device_time: new Date(asString(record.device_time)).toISOString(),
    mate_version: asString(record.mate_version) || undefined,
    live_only: record.live_only === true,
    client_hourly: record.client_hourly === true,
    client_trip: record.client_trip === true,
    trip_id: asString(record.trip_id) || undefined,
    telemetry,
    diplus,
    location,
    ...(autoservice ? { autoservice } : {}),
  };
}

async function resolveVehicleId(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  incomingVehicleId: string,
) {
  if (uuidPattern.test(incomingVehicleId)) {
    const { data, error } = await supabase
      .from("cars")
      .select("id, vehicle_alias")
      .eq("user_id", userId)
      .eq("id", incomingVehicleId)
      .maybeSingle();

    if (error) throw new Error(`car id lookup failed: ${error.message}`);
    if (data?.id) return { id: data.id as string, matchedBy: "id" as const };
  }

  const { data, error } = await supabase
    .from("cars")
    .select("id, vehicle_alias")
    .eq("user_id", userId)
    .eq("vehicle_alias", incomingVehicleId)
    .limit(2);

  if (error) throw new Error(`car alias lookup failed: ${error.message}`);
  if (!data?.length) return null;
  if (data.length > 1) {
    return { error: "Vehicle alias is ambiguous" as const };
  }

  const carId = data[0].id as string;
  const { error: updateError } = await supabase
    .from("cars")
    .update({ vehicle_alias: incomingVehicleId })
    .eq("user_id", userId)
    .eq("id", carId);

  if (updateError) throw new Error(`vehicle alias sync failed: ${updateError.message}`);

  return { id: carId, matchedBy: "alias" as const };
}

async function resolveUserId(supabase: ReturnType<typeof createClient>, request: Request) {
  const authorization = request.headers.get("Authorization") ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (token) {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user?.id) return null;
    return data.user.id;
  }

  const apiKey = request.headers.get("X-API-Key")?.trim() ?? "";
  if (!apiKey) return null;

  const { data: hashedProfile, error: hashError } = await supabase
    .from("profiles")
    .select("id")
    .eq("bydmate_cloud_api_key_hash", await hashBydmateApiKey(apiKey))
    .maybeSingle();

  if (hashError) return null;
  if (hashedProfile?.id) return hashedProfile.id as string;

  // Temporary compatibility with cars paired before hashed credentials shipped.
  const { data: legacyProfile, error: legacyError } = await supabase
    .from("profiles")
    .select("id")
    .eq("bydmate_cloud_api_key", apiKey)
    .maybeSingle();
  if (legacyError || !legacyProfile?.id) return null;

  // Retire a legacy plaintext credential after its first proven use. The extra
  // equality condition prevents overwriting a concurrently rotated key.
  const apiKeyHash = await hashBydmateApiKey(apiKey);
  await supabase
    .from("profiles")
    .update({
      bydmate_cloud_api_key: null,
      bydmate_cloud_api_key_hash: apiKeyHash,
      bydmate_cloud_api_key_fingerprint: apiKeyHash.slice(-12),
    })
    .eq("id", legacyProfile.id)
    .eq("bydmate_cloud_api_key", apiKey);
  return legacyProfile.id as string;
}

Deno.serve(async (request) => {
  // This endpoint is for paired native clients. Do not allow arbitrary browser origins
  // to preflight credentialed API-key requests.
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (request.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ ok: false, error: "Server is not configured" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const userId = await resolveUserId(supabase, request);
  if (!userId) return jsonResponse({ ok: false, error: "Unauthorized" }, 401);

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 2_000_000) {
    return jsonResponse({ ok: false, error: "Payload too large" }, 413);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON" }, 400);
  }

  const samples = normalizeSamples(payload);
  if (samples.length < 1 || samples.length > 300) {
    return jsonResponse({ ok: false, error: "Batch size must be 1..300" }, 400);
  }

  for (let i = 0; i < samples.length; i += 1) {
    const issue = validateSample(samples[i], i);
    if (issue) return jsonResponse({ ok: false, error: "Invalid payload", issue }, 400);
  }

  const headerVehicleId = request.headers.get("X-Vehicle-Id")?.trim() ?? "";
  const bodyVehicleIds = Array.from(
    new Set(samples.map((sample) => (isRecord(sample) ? asString(sample.vehicle_id) : "")).filter(Boolean)),
  );
  const incomingVehicleId = headerVehicleId || bodyVehicleIds[0] || "";

  if (!incomingVehicleId) {
    return jsonResponse({ ok: false, error: "Missing vehicle_id" }, 400);
  }
  if (headerVehicleId && bodyVehicleIds.some((vehicleId) => vehicleId !== headerVehicleId)) {
    return jsonResponse({ ok: false, error: "Vehicle ID mismatch" }, 400);
  }
  if (!headerVehicleId && bodyVehicleIds.length > 1) {
    return jsonResponse({ ok: false, error: "Batch contains multiple vehicle_id values" }, 400);
  }

  let resolvedVehicle;
  try {
    resolvedVehicle = await resolveVehicleId(supabase, userId, incomingVehicleId);
  } catch (error) {
    console.error(error);
    return jsonResponse({ ok: false, error: "Vehicle lookup failed" }, 500);
  }

  if (!resolvedVehicle) {
    return jsonResponse({ ok: false, error: "Unknown vehicle_id" }, 400);
  }
  if ("error" in resolvedVehicle) {
    return jsonResponse({ ok: false, error: resolvedVehicle.error }, 400);
  }

  const receivedAt = new Date().toISOString();
  const resolvedSamples = samples.map((sample) =>
    sanitizeSample(sample as JsonRecord, resolvedVehicle.id),
  );

  const { error: ingestError } =
    resolvedSamples.length === 1
      ? await supabase.rpc("bydmate_ingest_telemetry", {
          p_user_id: userId,
          p_vehicle_id: resolvedSamples[0].vehicle_id,
          p_source: resolvedSamples[0].source,
          p_schema_version: resolvedSamples[0].schema_version,
          p_device_time: resolvedSamples[0].device_time,
          p_received_at: receivedAt,
          p_telemetry: resolvedSamples[0].telemetry,
          p_diplus: resolvedSamples[0].diplus,
          p_location: resolvedSamples[0].location,
          p_raw_payload: resolvedSamples[0],
        })
      : await supabase.rpc("bydmate_ingest_telemetry_batch", {
          p_user_id: userId,
          p_received_at: receivedAt,
          p_samples: resolvedSamples,
        });

  if (ingestError) {
    console.error("Telemetry ingest failed", ingestError);
    return jsonResponse({ ok: false, error: "Telemetry ingest failed" }, 500);
  }

  return jsonResponse({
    ok: true,
    accepted: resolvedSamples.length,
    vehicle_id: resolvedVehicle.id,
    matched_by: resolvedVehicle.matchedBy,
  });
});
