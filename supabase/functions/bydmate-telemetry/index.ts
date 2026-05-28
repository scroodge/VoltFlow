import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type JsonRecord = Record<string, unknown>;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key, x-vehicle-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonResponse(body: JsonRecord, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSamples(payload: unknown) {
  if (Array.isArray(payload)) return payload;
  if (isRecord(payload) && Array.isArray(payload.samples)) return payload.samples;
  return [payload];
}

function validateSample(sample: unknown, index: number) {
  if (!isRecord(sample)) return `samples[${index}] must be an object`;
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

  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("bydmate_cloud_api_key", apiKey)
    .maybeSingle();

  if (error || !data?.id) return null;
  return data.id as string;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
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
  const resolvedSamples = samples.map((sample) => {
    const record = sample as JsonRecord;
    return {
      ...record,
      original_vehicle_id: asString(record.vehicle_id) || incomingVehicleId,
      vehicle_id: resolvedVehicle.id,
      source: asString(record.source) || "BYDMate",
      schema_version: Number(record.schema_version) || 1,
      device_time: new Date(asString(record.device_time)).toISOString(),
      telemetry: isRecord(record.telemetry) ? record.telemetry : {},
      diplus: isRecord(record.diplus) ? record.diplus : null,
      location: isRecord(record.location) ? record.location : {},
    };
  });

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
