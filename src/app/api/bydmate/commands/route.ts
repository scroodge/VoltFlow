import { resolveBydmateApiKeyProfile } from "@/lib/bydmate/api-auth";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

const COMMAND_TIMEOUT_MS = 60 * 1000;
const MAX_BATCH = 10;

type PendingCommand = {
  id: string;
  type: string;
  params: Record<string, unknown>;
};

async function expireStalePending(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
  vehicleId: string,
) {
  const cutoff = new Date(Date.now() - COMMAND_TIMEOUT_MS).toISOString();
  await supabase
    .from("vehicle_commands")
    .update({
      status: "failed",
      executed_at: new Date().toISOString(),
      result: { error: "timeout", timed_out: true },
    })
    .eq("user_id", userId)
    .eq("vehicle_id", vehicleId)
    .eq("status", "pending")
    .lt("created_at", cutoff);
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

    await expireStalePending(supabase, profile.id, vehicleId);

    const { data: rows, error } = await supabase
      .from("vehicle_commands")
      .select("id, type, params")
      .eq("user_id", profile.id)
      .eq("vehicle_id", vehicleId)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(MAX_BATCH);

    if (error) {
      return Response.json({ ok: false, error: "Command lookup failed" }, { status: 500 });
    }

    const commands = (rows ?? []) as PendingCommand[];
    if (commands.length > 0) {
      const ids = commands.map((row) => row.id);
      await supabase
        .from("vehicle_commands")
        .update({ status: "sent" })
        .in("id", ids)
        .eq("status", "pending");
    }

    return Response.json({ ok: true, commands });
  } catch {
    return Response.json({ ok: false, error: "Command poll failed" }, { status: 500 });
  }
}
