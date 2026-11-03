import { readBodyWithLimit, RequestBodyTooLargeError } from "@/lib/api/read-body";
import { createServiceClient } from "@/lib/supabase/service";
import { resolveVoltflowMateApiKeyProfile } from "@/lib/voltflowmate/api-auth";
import { CAMERA_SNAPSHOT_BUCKET } from "@/lib/voltflowmate/camera-snapshots";
import { resolveVehicleKey } from "@/lib/voltflowmate/vehicle-identity";

export const runtime = "nodejs";

const MAX_JPEG_BYTES = 6 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isJpeg(bytes: Uint8Array) {
  return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ commandId: string }> },
) {
  const { commandId } = await params;
  if (!UUID_RE.test(commandId)) {
    return Response.json({ ok: false, error: "invalid_command_id" }, { status: 400 });
  }
  if (request.headers.get("content-type")?.split(";", 1)[0] !== "image/jpeg") {
    return Response.json({ ok: false, error: "jpeg_required" }, { status: 415 });
  }
  const apiKey = request.headers.get("x-api-key") ?? "";
  const headerVehicleId = request.headers.get("x-vehicle-id")?.trim();
  if (!headerVehicleId) {
    return Response.json({ ok: false, error: "missing_vehicle_id" }, { status: 400 });
  }

  try {
    const supabase = createServiceClient();
    const profile = await resolveVoltflowMateApiKeyProfile(supabase, apiKey);
    if (!profile) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    const vehicleId = await resolveVehicleKey(
      supabase,
      profile.id,
      headerVehicleId,
      request.headers.get("x-vehicle-uid"),
    );
    const { data: command, error: commandError } = await supabase
      .from("vehicle_commands")
      .select("id")
      .eq("id", commandId)
      .eq("user_id", profile.id)
      .eq("vehicle_id", vehicleId)
      .eq("type", "camera_snapshot")
      .eq("status", "sent")
      .maybeSingle();
    if (commandError) throw commandError;
    if (!command) return Response.json({ ok: false, error: "unknown_snapshot_command" }, { status: 404 });

    let bytes: Uint8Array;
    try {
      bytes = await readBodyWithLimit(request, MAX_JPEG_BYTES);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return Response.json({ ok: false, error: "payload_too_large" }, { status: 413 });
      }
      throw error;
    }
    if (!isJpeg(bytes)) return Response.json({ ok: false, error: "invalid_jpeg" }, { status: 400 });

    // Keep precisely one rolling snapshot per vehicle. The bucket remains bounded even
    // with high-resolution captures; the command row records when it was captured.
    const storagePath = `${profile.id}/${vehicleId}/latest.jpg`;
    const { error: uploadError } = await supabase.storage
      .from(CAMERA_SNAPSHOT_BUCKET)
      .upload(storagePath, bytes, { contentType: "image/jpeg", upsert: true });
    if (uploadError) throw uploadError;

    return Response.json({
      ok: true,
      storage_path: storagePath,
      captured_at: new Date().toISOString(),
    });
  } catch {
    return Response.json({ ok: false, error: "snapshot_upload_failed" }, { status: 500 });
  }
}
