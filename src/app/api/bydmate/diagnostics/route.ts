import { gunzipSync, gzipSync } from "node:zlib";

import { resolveVoltflowMateApiKeyProfile } from "@/lib/voltflowmate/api-auth";
import { resolveVehicleKey } from "@/lib/voltflowmate/vehicle-identity";
import { createServiceClient } from "@/lib/supabase/service";
import {
  readBodyWithLimit,
  RequestBodyTooLargeError,
} from "@/lib/api/read-body";
import { sendTelegramDocument } from "@/lib/telegram/bot-send";
import {
  DIAGNOSTICS_MAX_GZIP_BYTES,
  DIAGNOSTICS_MAX_TEXT_BYTES,
  diagnosticsCaption,
  diagnosticsFileName,
  diagnosticsRateVerdict,
  isGzip,
  normalizeDiagnosticsComment,
  normalizeMateVersion,
  redactDiagnosticsText,
} from "@/lib/voltflowmate/diagnostics";

export const runtime = "nodejs";

function decodeComment(raw: string | null): string | null {
  if (!raw) return null;
  try {
    return normalizeDiagnosticsComment(decodeURIComponent(raw));
  } catch {
    return null;
  }
}

// Mate «Отправить диагностику»: a gzip text bundle relayed to the developer's Telegram chat.
// The bot token and chat id stay server-side — see src/lib/voltflowmate/diagnostics.ts and
// supabase/VOLTFLOW_MATE_API.md. Auth mirrors /api/bydmate/trip-summaries.
export async function POST(request: Request) {
  const apiKey = request.headers.get("x-api-key") ?? "";
  const headerVehicleId = request.headers.get("x-vehicle-id")?.trim();
  if (!headerVehicleId) {
    return Response.json(
      { ok: false, error: "Missing X-Vehicle-Id" },
      { status: 400 },
    );
  }

  const chatId = process.env.TELEGRAM_DIAGNOSTICS_CHAT_ID?.trim();
  if (!chatId) {
    return Response.json(
      { ok: false, error: "Diagnostics not configured" },
      { status: 503 },
    );
  }

  let supabase: ReturnType<typeof createServiceClient>;
  let profile: Awaited<ReturnType<typeof resolveVoltflowMateApiKeyProfile>>;
  try {
    supabase = createServiceClient();
    profile = await resolveVoltflowMateApiKeyProfile(supabase, apiKey);
  } catch {
    return Response.json(
      { ok: false, error: "Key lookup failed" },
      { status: 500 },
    );
  }
  if (!profile) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const vehicleId = await resolveVehicleKey(
    supabase,
    profile.id,
    headerVehicleId,
    request.headers.get("x-vehicle-uid"),
  );

  // Checked before reading the body, so a client over its limit does not upload 4 MB for nothing.
  const nowMs = Date.now();
  const [vehicleHour, userDay] = await Promise.all([
    supabase
      .from("bydmate_diagnostic_uploads")
      .select("id", { count: "exact", head: true })
      .eq("user_id", profile.id)
      .eq("vehicle_id", vehicleId)
      .gte("created_at", new Date(nowMs - 60 * 60 * 1000).toISOString()),
    supabase
      .from("bydmate_diagnostic_uploads")
      .select("id", { count: "exact", head: true })
      .eq("user_id", profile.id)
      .gte("created_at", new Date(nowMs - 24 * 60 * 60 * 1000).toISOString()),
  ]);
  if (vehicleHour.error || userDay.error) {
    return Response.json(
      { ok: false, error: "Rate check failed" },
      { status: 500 },
    );
  }
  const verdict = diagnosticsRateVerdict({
    vehicleLastHour: vehicleHour.count ?? 0,
    userLastDay: userDay.count ?? 0,
  });
  if (!verdict.ok) {
    return Response.json(
      {
        ok: false,
        error: "Too many diagnostics uploads",
        reason: verdict.reason,
      },
      { status: 429 },
    );
  }

  let gzipped: Uint8Array;
  try {
    gzipped = await readBodyWithLimit(request, DIAGNOSTICS_MAX_GZIP_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return Response.json(
        { ok: false, error: "Payload too large" },
        { status: 413 },
      );
    }
    return Response.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }
  if (!isGzip(gzipped)) {
    return Response.json(
      { ok: false, error: "Body must be gzip" },
      { status: 415 },
    );
  }

  let text: string;
  try {
    text = gunzipSync(gzipped, {
      maxOutputLength: DIAGNOSTICS_MAX_TEXT_BYTES,
    }).toString("utf8");
  } catch {
    return Response.json(
      { ok: false, error: "Invalid or oversized gzip" },
      { status: 400 },
    );
  }
  const bundle = gzipSync(Buffer.from(redactDiagnosticsText(text), "utf8"));

  const mateVersion = normalizeMateVersion(
    request.headers.get("x-mate-version"),
  );
  const comment = decodeComment(request.headers.get("x-diagnostics-comment"));
  const { data: car } = await supabase
    .from("cars")
    .select("name")
    .eq("user_id", profile.id)
    .eq("vehicle_alias", vehicleId)
    .maybeSingle();

  const sent = await sendTelegramDocument(
    chatId,
    {
      bytes: new Uint8Array(bundle),
      fileName: diagnosticsFileName(vehicleId, new Date(nowMs)),
      contentType: "application/gzip",
    },
    {
      caption: diagnosticsCaption({
        carName: (car as { name?: string | null } | null)?.name ?? null,
        vehicleId,
        userId: profile.id,
        mateVersion,
        comment,
        bytes: bundle.byteLength,
      }),
      parseMode: "HTML",
    },
  );

  // A failed send still counts against the limit: a client retrying a broken upload in a
  // loop must not turn the relay into a Telegram flood once it recovers.
  await supabase.from("bydmate_diagnostic_uploads").insert({
    user_id: profile.id,
    vehicle_id: vehicleId,
    size_bytes: bundle.byteLength,
    mate_version: mateVersion,
    status: sent.ok ? "sent" : "failed",
    telegram_message_id: sent.ok ? (sent.messageId ?? null) : null,
    error: sent.ok ? null : sent.error.slice(0, 200),
  });

  if (!sent.ok) {
    return Response.json(
      { ok: false, error: "Delivery failed" },
      { status: 502 },
    );
  }
  return Response.json({ ok: true, vehicle_id: vehicleId });
}
