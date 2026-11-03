import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Command doorbell (migration 20261103180000): a per-car Realtime broadcast topic the
 * `vehicle_commands` insert trigger rings, so Mate polls at once instead of on its next tick.
 * The ring carries no command — Mate still fetches, validates and acks through the poll.
 *
 * Only Mate 0.6.4+ asks for it (`X-Doorbell: 1`); older APKs never pay the extra read.
 */
export type CommandDoorbellField = {
  doorbell?: { url: string; apikey: string; topic: string };
};

export function wantsDoorbell(request: Request): boolean {
  return request.headers.get("x-doorbell") === "1";
}

export function realtimeWebsocketUrl(
  supabaseUrl: string | undefined,
): string | null {
  if (!supabaseUrl) return null;
  try {
    const url = new URL(supabaseUrl);
    url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
    url.pathname = "/realtime/v1/websocket";
    url.search = "";
    return url.toString();
  } catch {
    return null;
  }
}

/** Never throws: a missing doorbell only means the car keeps polling as before. */
export async function commandDoorbellField(
  supabase: SupabaseClient,
  userId: string,
  vehicleId: string,
): Promise<CommandDoorbellField> {
  const url = realtimeWebsocketUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const apikey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !apikey || !vehicleId) return {};
  try {
    const { data: existing } = await supabase
      .from("bydmate_command_doorbells")
      .select("topic")
      .eq("user_id", userId)
      .eq("vehicle_id", vehicleId)
      .maybeSingle();
    let topic = (existing as { topic?: string } | null)?.topic;
    if (!topic) {
      await supabase
        .from("bydmate_command_doorbells")
        .upsert(
          { user_id: userId, vehicle_id: vehicleId },
          { onConflict: "user_id,vehicle_id", ignoreDuplicates: true },
        );
      const { data: created } = await supabase
        .from("bydmate_command_doorbells")
        .select("topic")
        .eq("user_id", userId)
        .eq("vehicle_id", vehicleId)
        .maybeSingle();
      topic = (created as { topic?: string } | null)?.topic;
    }
    return topic ? { doorbell: { url, apikey, topic } } : {};
  } catch {
    return {};
  }
}
