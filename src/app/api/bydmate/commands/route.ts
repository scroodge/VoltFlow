import { resolveBydmateApiKeyProfile } from "@/lib/bydmate/api-auth";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

const COMMAND_TIMEOUT_MS = 60 * 1000;
const MAX_BATCH = 10;

type PendingCommand = {
  id: string;
  type: string;
  params: Record<string, unknown>;
  created_at: string;
};

async function expireStalePending(
  supabase: ReturnType<typeof createServiceClient>,
  ids: string[],
) {
  if (ids.length === 0) return;
  await supabase
    .from("vehicle_commands")
    .update({
      status: "failed",
      executed_at: new Date().toISOString(),
      result: { error: "timeout", timed_out: true },
    })
    .in("id", ids)
    .eq("status", "pending");
}

// Seconds of fast live-status cadence to grant the car per poll. Deliberately a little
// longer than the ~6s poll interval so a single dropped poll does not drop the car out of
// fast mode mid-view, and short enough that closing the app stops the traffic promptly.
const LIVE_FAST_GRANT_SECONDS = 20;

/**
 * How much longer (if at all) this vehicle should keep pushing `live_only` status at the
 * fast cadence. Derived from the profile row the caller already fetched, so this adds no
 * query to a path that runs every ~6s per car.
 */
function liveFastSecondsFor(
  profile: { liveFastUntil: string | null; liveFastVehicleId: string | null },
  vehicleId: string,
): number {
  if (!profile.liveFastUntil) return 0;
  // A multi-car account watching car A must not speed up car B. A null vehicle id means
  // the window was set before we knew which car, so honour it rather than dropping it.
  if (profile.liveFastVehicleId && profile.liveFastVehicleId !== vehicleId) return 0;
  const remainingMs = new Date(profile.liveFastUntil).getTime() - Date.now();
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return 0;
  return Math.min(LIVE_FAST_GRANT_SECONDS, Math.ceil(remainingMs / 1000));
}

export async function GET(request: Request) {
  const apiKey = request.headers.get("x-api-key") ?? "";
  const vehicleId = request.headers.get("x-vehicle-id")?.trim();
  if (!vehicleId) {
    return Response.json({ ok: false, error: "Missing X-Vehicle-Id" }, { status: 400 });
  }

  try {
    const supabase = createServiceClient();
    const profile = await resolveBydmateApiKeyProfile(supabase, apiKey);
    if (!profile) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { error: scheduleError } = await supabase.rpc("enqueue_due_vehicle_command_schedules", {
      p_user_id: profile.id,
      p_vehicle_id: vehicleId,
    });
    if (scheduleError) {
      return Response.json({ ok: false, error: "Schedule materialization failed" }, { status: 500 });
    }

    const { data: rows, error } = await supabase
      .from("vehicle_commands")
      .select("id, type, params, created_at")
      .eq("user_id", profile.id)
      .eq("vehicle_id", vehicleId)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(MAX_BATCH);

    if (error) {
      return Response.json({ ok: false, error: "Command lookup failed" }, { status: 500 });
    }

    // Empty queue (the overwhelming majority of polls) costs one indexed read and zero
    // writes. Only touch the table when there is something stale to expire or fresh to send.
    const liveFastSeconds = liveFastSecondsFor(profile, vehicleId);

    const pending = (rows ?? []) as PendingCommand[];
    if (pending.length === 0) {
      return Response.json({ ok: true, commands: [], live_fast_seconds: liveFastSeconds });
    }

    const cutoff = Date.now() - COMMAND_TIMEOUT_MS;
    const staleIds: string[] = [];
    const commands: PendingCommand[] = [];
    for (const row of pending) {
      if (new Date(row.created_at).getTime() < cutoff) {
        staleIds.push(row.id);
      } else {
        commands.push(row);
      }
    }

    await expireStalePending(supabase, staleIds);

    if (commands.length > 0) {
      const ids = commands.map((row) => row.id);
      await supabase
        .from("vehicle_commands")
        .update({ status: "sent" })
        .in("id", ids)
        .eq("status", "pending");
    }

    return Response.json({ ok: true, commands, live_fast_seconds: liveFastSeconds });
  } catch {
    return Response.json({ ok: false, error: "Command poll failed" }, { status: 500 });
  }
}
