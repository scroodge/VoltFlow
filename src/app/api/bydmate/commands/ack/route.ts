import { createServiceClient } from "@/lib/supabase/service";
import { resolveBydmateApiKeyProfile } from "@/lib/bydmate/api-auth";

export const runtime = "nodejs";

const ALLOWED_STATUSES = new Set(["done", "failed", "rejected"]);

type AckItem = {
  id: string;
  status: string;
  result?: Record<string, unknown>;
};

export async function POST(request: Request) {
  const apiKey = request.headers.get("x-api-key") ?? "";
  const vehicleId = request.headers.get("x-vehicle-id")?.trim();
  if (!vehicleId) {
    return Response.json({ ok: false, error: "Missing X-Vehicle-Id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const acks = Array.isArray((body as { acks?: unknown }).acks)
    ? ((body as { acks: AckItem[] }).acks ?? [])
    : [];

  if (acks.length === 0) {
    return Response.json({ ok: false, error: "acks array required" }, { status: 400 });
  }

  try {
    const supabase = createServiceClient();
    const profile = await resolveBydmateApiKeyProfile(supabase, apiKey);
    if (!profile) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const executedAt = new Date().toISOString();
    let updated = 0;

    for (const ack of acks) {
      const id = typeof ack.id === "string" ? ack.id.trim() : "";
      const status = typeof ack.status === "string" ? ack.status.trim() : "";
      if (!id || !ALLOWED_STATUSES.has(status)) continue;

      const { error } = await supabase
        .from("vehicle_commands")
        .update({
          status,
          executed_at: executedAt,
          result: ack.result ?? {},
        })
        .eq("id", id)
        .eq("user_id", profile.id)
        .eq("vehicle_id", vehicleId)
        .in("status", ["pending", "sent"]);

      if (!error) updated += 1;
    }

    return Response.json({ ok: true, updated });
  } catch {
    return Response.json({ ok: false, error: "Ack failed" }, { status: 500 });
  }
}
