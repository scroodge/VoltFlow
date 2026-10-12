import { createServiceClient } from "@/lib/supabase/service";
import {
  hashWebhookToken,
  resolveWebhookToken,
} from "@/lib/voltflowmate/webhook-token-auth";
import {
  buildBydMateWebhookIngestRpcParams,
  bydMateWebhookSchema,
  mapBydMateWebhookPayload,
} from "@/lib/voltflowmate/bydmate-webhook-mapper";
import {
  readBodyWithLimit,
  RequestBodyTooLargeError,
} from "@/lib/api/read-body";

export const runtime = "nodejs";

// The sender's own payload is a single flat object (~350 bytes observed); this is not
// the batched Mate ingest, so a small cap is enough and rejects anything malformed early.
const MAX_WEBHOOK_BODY_BYTES = 20_000;

/**
 * Receives third-party "webhook telemetry" senders — e.g. AndyShaman/BYDMate's own
 * Settings → "Webhook — telemetry" feature — that POST one flat JSON object per tick
 * with no vehicle id and no X-API-Key/X-Vehicle-Id headers. Identity comes entirely
 * from the opaque `token` in the URL, minted per (user, vehicle) via
 * scripts/mint-bydmate-webhook-token.mjs.
 *
 * Deliberately minimal: writes the live snapshot + telemetry history through the same
 * `bydmate_ingest_telemetry` RPC the canonical Mate ingest uses, but does not run
 * auto-charging-session detection, notifications, Telegram widgets, or rollups for this
 * source, and does not attempt trip inference (this sender has no per-trip distance
 * delta, only lifetime odometer). That is enforced in the RPC, not here: for
 * `source = 'bydmate-app-webhook'` it returns before any trip logic (migration
 * `20261004150000`); without that guard every drive got a 0 km server-built twin trip and
 * webhook samples could close an open Mate trip. See BACKLOG.md for the full scope decision.
 *
 * Calls the 9-arg `bydmate_ingest_telemetry` overload directly (no `p_diplus` key) rather
 * than the 10-arg diplus-sync overload the canonical Mate ingest uses. This sender never
 * carries a diplus block, and passing `p_diplus: null` through the 10-arg overload makes it
 * apply an empty diplus object to `bydmate_live_snapshots` on every tick — nulling out
 * `diplus_gear`/`diplus_charge_gun_state`/`diplus_charging_status`/`diplus_power_kw` from
 * whatever the real Mate daemon last wrote, since both sources share one row per
 * (user_id, vehicle_id) and BACKLOG.md's "A/B against Di+/Mate" use case runs them under the
 * same account by design. The 9-arg overload's own live-snapshot upsert never touches those
 * columns, so calling it directly is also what skips the diplus clobber, not just the trip
 * guard it already carried.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  let supabase: ReturnType<typeof createServiceClient>;
  try {
    supabase = createServiceClient();
  } catch {
    return Response.json(
      { ok: false, error: "Service unavailable" },
      { status: 500 },
    );
  }

  const target = await resolveWebhookToken(supabase, token).catch(() => null);
  if (!target) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let json: unknown;
  try {
    const body = await readBodyWithLimit(request, MAX_WEBHOOK_BODY_BYTES);
    json = JSON.parse(new TextDecoder().decode(body));
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return Response.json(
        { ok: false, error: "Payload too large" },
        { status: 413 },
      );
    }
    // The sender has no retry/queue and cools down 60s on any non-2xx, so malformed
    // JSON is acknowledged rather than retried into the same dead end.
    return Response.json({ ok: true, skipped: "invalid_json" });
  }

  const parsed = bydMateWebhookSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ ok: true, skipped: "invalid_payload" });
  }

  const mapped = mapBydMateWebhookPayload(parsed.data);
  if (!mapped) {
    // No soc/utc yet (matches the sender's own send gate) — nothing to persist, but
    // not an error either; ack so the sender doesn't sit in its 60s failure cooldown.
    return Response.json({ ok: true, skipped: "no_soc_or_utc" });
  }

  const receivedAt = new Date().toISOString();
  const rpcParams = buildBydMateWebhookIngestRpcParams({
    userId: target.userId,
    vehicleId: target.vehicleId,
    mapped,
    receivedAt,
  });

  const { data: ingestResult, error: ingestError } = await supabase.rpc(
    "bydmate_ingest_telemetry",
    rpcParams,
  );

  if (ingestError) {
    return Response.json(
      { ok: false, error: "Ingest failed" },
      { status: 500 },
    );
  }

  // Best-effort freshness stamp for the token itself (not the sample); never blocks or
  // fails the response.
  await supabase
    .from("bydmate_webhook_tokens")
    .update({ last_seen_at: receivedAt })
    .eq("token_hash", hashWebhookToken(token))
    .then(
      () => undefined,
      () => undefined,
    );

  return Response.json({
    ok: true,
    vehicle_id: target.vehicleId,
    device_time: mapped.deviceTime,
    ingest: ingestResult,
  });
}
