import { resolveVoltflowMateApiKeyProfile } from "@/lib/voltflowmate/api-auth";
import { liveFastSecondsFor } from "@/lib/voltflowmate/live-fast";
import { createServiceClient } from "@/lib/supabase/service";
import {
  ACTIVE_COMMAND_POLL_AFTER_SECONDS,
  REMOTE_COMMANDS_DISABLED,
  SUSPENDED_COMMAND_POLL_AFTER_SECONDS,
} from "@/lib/voltflowmate/remote-commands";

export const runtime = "nodejs";

const COMMAND_TIMEOUT_MS = 60 * 1000;
const MAX_BATCH = 10;

/**
 * Poll cadence handed back to the car in `poll_after_seconds`.
 *
 * This route was the single largest source of Vercel invocations: every car polls it around
 * the clock (the daemon's command loop is not gated on the app being alive), so a 6s interval
 * is ~14.4k invocations/car/day — several times the entire telemetry ingest path, and while
 * [REMOTE_COMMANDS_DISABLED] every one of them returns an empty array.
 *
 * A car running an older build ignores the field and keeps its built-in 6s, so this is purely
 * additive and needs no version gate.
 */
const ACTIVE_POLL_AFTER_SECONDS = ACTIVE_COMMAND_POLL_AFTER_SECONDS;
/**
 * While commands are suspended the poll carries nothing a slower cadence would lose: the
 * `live_fast_seconds` grant now also rides the telemetry ingest response, which every car
 * sends at 15s (driving) to 60s (parked/charging). Live-view *entry* latency is therefore
 * bounded by that cadence rather than by this one, and once fast mode is on the 3s
 * `live_only` pings renew the grant themselves.
 *
 * 300s is the ceiling both supported clients accept: they clamp the server-provided interval
 * to MAX_SERVER_POLL_MS = 300_000. Drop this back to [ACTIVE_POLL_AFTER_SECONDS] the moment
 * remote commands come back.
 */
const SUSPENDED_POLL_AFTER_SECONDS = SUSPENDED_COMMAND_POLL_AFTER_SECONDS;

const POLL_AFTER_SECONDS = REMOTE_COMMANDS_DISABLED
  ? SUSPENDED_POLL_AFTER_SECONDS
  : ACTIVE_POLL_AFTER_SECONDS;

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

export async function GET(request: Request) {
  const apiKey = request.headers.get("x-api-key") ?? "";
  const vehicleId = request.headers.get("x-vehicle-id")?.trim();
  if (!vehicleId) {
    return Response.json({ ok: false, error: "Missing X-Vehicle-Id" }, { status: 400 });
  }

  try {
    const supabase = createServiceClient();
    const profile = await resolveVoltflowMateApiKeyProfile(supabase, apiKey);
    if (!profile) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const liveFastSeconds = liveFastSecondsFor(profile, vehicleId);
    if (REMOTE_COMMANDS_DISABLED) {
      return Response.json({
        ok: true,
        commands: [],
        commands_enabled: !REMOTE_COMMANDS_DISABLED,
        live_fast_seconds: liveFastSeconds,
        poll_after_seconds: POLL_AFTER_SECONDS,
      });
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
    const pending = (rows ?? []) as PendingCommand[];
    if (pending.length === 0) {
      return Response.json({
        ok: true,
        commands: [],
        commands_enabled: !REMOTE_COMMANDS_DISABLED,
        live_fast_seconds: liveFastSeconds,
        poll_after_seconds: POLL_AFTER_SECONDS,
      });
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

    // Something was actually delivered, so keep the car on the fast cadence to pick up the
    // ack round trip and any follow-up command promptly, regardless of the suspended default.
    return Response.json({
      ok: true,
      commands,
      commands_enabled: !REMOTE_COMMANDS_DISABLED,
      live_fast_seconds: liveFastSeconds,
      poll_after_seconds: ACTIVE_POLL_AFTER_SECONDS,
    });
  } catch {
    return Response.json({ ok: false, error: "Command poll failed" }, { status: 500 });
  }
}
