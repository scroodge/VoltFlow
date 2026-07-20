import { createHmac } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

export type BydmateApiKeyProfile = {
  id: string;
  /** See `profiles.live_fast_until` — while in the future, Mate should send status fast. */
  liveFastUntil: string | null;
  liveFastVehicleId: string | null;
  vehicleConnectedAt: string | null;
};

function bydmateApiKeyPepper(): string {
  const pepper = process.env.BYDMATE_API_KEY_PEPPER?.trim();
  if (pepper) return pepper;

  // A rollout fallback keeps existing deployments working until the dedicated
  // secret is configured. New deployments must set BYDMATE_API_KEY_PEPPER.
  const linkCodePepper = process.env.BYDMATE_LINK_CODE_PEPPER?.trim();
  if (linkCodePepper) return linkCodePepper;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (serviceRoleKey) return serviceRoleKey;
  throw new Error("Missing BYDMATE_API_KEY_PEPPER or SUPABASE_SERVICE_ROLE_KEY");
}

export function hashBydmateApiKey(apiKey: string): string {
  return createHmac("sha256", bydmateApiKeyPepper())
    .update(`bydmate-api-key:${apiKey.trim()}`)
    .digest("hex");
}

export function bydmateApiKeyFingerprint(apiKey: string): string {
  return hashBydmateApiKey(apiKey).slice(-12);
}

export async function resolveBydmateApiKeyProfile(
  supabase: SupabaseClient,
  apiKey: string,
): Promise<BydmateApiKeyProfile | null> {
  const trimmed = apiKey.trim();
  if (!trimmed || trimmed.length > 256) return null;

  // The live-fast columns ride this existing lookup on purpose: the command poll runs
  // every ~6s per car, and reading them here keeps that hot path at one indexed read.
  // Legacy plaintext values remain readable only during the one-way migration; newly
  // paired cars are authenticated solely by the keyed hash.
  const fields = "id, live_fast_until, live_fast_vehicle_id, vehicle_connected_at";
  const { data: hashedProfile, error: hashError } = await supabase
    .from("profiles")
    .select(fields)
    .eq("bydmate_cloud_api_key_hash", hashBydmateApiKey(trimmed))
    .maybeSingle();

  if (hashError) return null;
  if (hashedProfile?.id) {
    return {
      id: hashedProfile.id,
      liveFastUntil: hashedProfile.live_fast_until ?? null,
      liveFastVehicleId: hashedProfile.live_fast_vehicle_id ?? null,
      vehicleConnectedAt: hashedProfile.vehicle_connected_at ?? null,
    };
  }

  const { data: legacyProfile, error: legacyError } = await supabase
    .from("profiles")
    .select(fields)
    .eq("bydmate_cloud_api_key", trimmed)
    .maybeSingle();
  if (legacyError || !legacyProfile?.id) return null;

  // Migrate an existing car opportunistically on its first authenticated request.
  // The plaintext match makes this safe against a concurrent key rotation.
  await supabase
    .from("profiles")
    .update({
      bydmate_cloud_api_key: null,
      bydmate_cloud_api_key_hash: hashBydmateApiKey(trimmed),
      bydmate_cloud_api_key_fingerprint: bydmateApiKeyFingerprint(trimmed),
    })
    .eq("id", legacyProfile.id)
    .eq("bydmate_cloud_api_key", trimmed);

  return {
    id: legacyProfile.id,
    liveFastUntil: legacyProfile.live_fast_until ?? null,
    liveFastVehicleId: legacyProfile.live_fast_vehicle_id ?? null,
    vehicleConnectedAt: legacyProfile.vehicle_connected_at ?? null,
  };
}
