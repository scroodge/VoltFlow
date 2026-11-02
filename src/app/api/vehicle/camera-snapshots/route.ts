import { resolveVehicleApiAccess } from "@/lib/dev/dev-api-auth";
import { CAMERA_SNAPSHOT_BUCKET } from "@/lib/voltflowmate/camera-snapshots";

export const runtime = "nodejs";

const SIGNED_URL_TTL_SECONDS = 5 * 60;

export async function GET(request: Request) {
  const access = await resolveVehicleApiAccess(request);
  if (!access) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const vehicleId = new URL(request.url).searchParams.get("vehicle_id")?.trim();
  if (!vehicleId) return Response.json({ ok: false, error: "vehicle_id_required" }, { status: 400 });

  const { data: command, error } = await access.supabase
    .from("vehicle_commands")
    .select("id, created_at, executed_at, result")
    .eq("user_id", access.userId)
    .eq("vehicle_id", vehicleId)
    .eq("type", "camera_snapshot")
    .eq("status", "done")
    .order("executed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return Response.json({ ok: false, error: "snapshot_lookup_failed" }, { status: 500 });
  if (!command) return Response.json({ ok: true, snapshot: null });

  const result = command.result as { storage_path?: unknown; captured_at?: unknown } | null;
  const storagePath = typeof result?.storage_path === "string" ? result.storage_path : "";
  const expectedPrefix = `${access.userId}/${vehicleId}/`;
  if (!storagePath.startsWith(expectedPrefix)) {
    return Response.json({ ok: false, error: "invalid_snapshot_path" }, { status: 500 });
  }
  const { data: signed, error: signError } = await access.supabase.storage
    .from(CAMERA_SNAPSHOT_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (signError || !signed?.signedUrl) {
    return Response.json({ ok: false, error: "snapshot_sign_failed" }, { status: 500 });
  }

  return Response.json({
    ok: true,
    snapshot: {
      command_id: command.id,
      captured_at: typeof result?.captured_at === "string" ? result.captured_at : command.executed_at ?? command.created_at,
      image_url: signed.signedUrl,
    },
  });
}
