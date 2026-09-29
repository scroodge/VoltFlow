import { createHmac, randomBytes } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

function webhookTokenPepper(): string {
  const pepper = process.env.BYDMATE_WEBHOOK_TOKEN_PEPPER?.trim();
  if (pepper) return pepper;

  // Falls back to the paired-client pepper chain so a deployment that hasn't set the
  // dedicated secret yet still works; new deployments should set
  // BYDMATE_WEBHOOK_TOKEN_PEPPER explicitly (see BYDMATE_API_KEY_PEPPER's own note).
  const apiKeyPepper = process.env.BYDMATE_API_KEY_PEPPER?.trim();
  if (apiKeyPepper) return apiKeyPepper;
  const linkCodePepper = process.env.BYDMATE_LINK_CODE_PEPPER?.trim();
  if (linkCodePepper) return linkCodePepper;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (serviceRoleKey) return serviceRoleKey;
  throw new Error(
    "Missing BYDMATE_WEBHOOK_TOKEN_PEPPER or SUPABASE_SERVICE_ROLE_KEY",
  );
}

export function hashWebhookToken(token: string): string {
  return createHmac("sha256", webhookTokenPepper())
    .update(`bydmate-webhook-token:${token.trim()}`)
    .digest("hex");
}

/** URL-safe, 32 bytes of entropy. The user pastes this straight into the sender app's URL field. */
export function generateWebhookToken(): string {
  return randomBytes(32).toString("base64url");
}

export type WebhookTokenTarget = {
  userId: string;
  vehicleId: string;
};

type WebhookTokenRow = {
  user_id: string;
  vehicle_id: string;
};

/**
 * Resolves an opaque webhook token to the (user, vehicle) it was minted for.
 * Unlike bydmate_devices (one paired client per user+kind, identified by X-Vehicle-Id),
 * this table identifies one external sender per (user, vehicle) purely from the token —
 * these third-party senders carry no vehicle id or X-API-Key header of their own.
 */
export async function resolveWebhookToken(
  supabase: SupabaseClient,
  token: string,
): Promise<WebhookTokenTarget | null> {
  const trimmed = token.trim();
  if (!trimmed || trimmed.length > 256) return null;

  const tokenHash = hashWebhookToken(trimmed);
  const { data, error } = await supabase
    .from("bydmate_webhook_tokens")
    .select("user_id, vehicle_id")
    .eq("token_hash", tokenHash)
    .maybeSingle<WebhookTokenRow>();

  if (error || !data) return null;
  return { userId: data.user_id, vehicleId: data.vehicle_id };
}
