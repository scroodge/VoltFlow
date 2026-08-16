import { createHmac } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

/** Mate (the car) and the Dashboard (the head unit) pair independently. */
export type VoltflowMateDeviceKind = "mate" | "dashboard";

export type VoltflowMateApiKeyProfile = {
  id: string;
  /** Present only for server-side fan-out eligibility; never returned to the paired client. */
  telegramId: number | null;
  /** See `profiles.live_fast_until` — while in the future, Mate should send status fast. */
  liveFastUntil: string | null;
  liveFastVehicleId: string | null;
  vehicleConnectedAt: string | null;
};

function voltflowMateApiKeyPepper(): string {
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

export function hashVoltflowMateApiKey(apiKey: string): string {
  return createHmac("sha256", voltflowMateApiKeyPepper())
    .update(`bydmate-api-key:${apiKey.trim()}`)
    .digest("hex");
}

export function voltflowMateApiKeyFingerprint(apiKey: string): string {
  return hashVoltflowMateApiKey(apiKey).slice(-12);
}

type ProfileRow = {
  id: string;
  telegram_id?: number | null;
  live_fast_until?: string | null;
  live_fast_vehicle_id?: string | null;
  vehicle_connected_at?: string | null;
};

function toApiKeyProfile(row: ProfileRow): VoltflowMateApiKeyProfile {
  return {
    id: row.id,
    telegramId: row.telegram_id ?? null,
    liveFastUntil: row.live_fast_until ?? null,
    liveFastVehicleId: row.live_fast_vehicle_id ?? null,
    vehicleConnectedAt: row.vehicle_connected_at ?? null,
  };
}

export async function resolveVoltflowMateApiKeyProfile(
  supabase: SupabaseClient,
  apiKey: string,
): Promise<VoltflowMateApiKeyProfile | null> {
  const trimmed = apiKey.trim();
  if (!trimmed || trimmed.length > 256) return null;

  // The live-fast columns ride this existing lookup on purpose: the command poll runs
  // every ~6s per car, and reading them here keeps that hot path at one indexed read.
  // Legacy plaintext values remain readable only during the one-way migration; newly
  // paired cars are authenticated solely by the keyed hash.
  const fields = "id, telegram_id, live_fast_until, live_fast_vehicle_id, vehicle_connected_at";
  const keyHash = hashVoltflowMateApiKey(trimmed);

  // Devices first — this is where every credential paired after the bydmate_devices
  // migration lives. The embedded profile keeps the hot path at one round trip, and the
  // unique index on api_key_hash keeps it a single indexed read.
  const { data: device, error: deviceError } = await supabase
    .from("bydmate_devices")
    .select(`profiles!inner(${fields})`)
    .eq("api_key_hash", keyHash)
    .maybeSingle();

  if (deviceError) return null;
  // PostgREST types an embedded to-one relation as an array; normalise before use.
  const deviceProfile = (
    Array.isArray(device?.profiles) ? device?.profiles[0] : device?.profiles
  ) as ProfileRow | undefined;
  if (deviceProfile?.id) {
    return toApiKeyProfile(deviceProfile);
  }

  const { data: hashedProfile, error: hashError } = await supabase
    .from("profiles")
    .select(fields)
    .eq("bydmate_cloud_api_key_hash", keyHash)
    .maybeSingle();

  if (hashError) return null;
  if (hashedProfile?.id) {
    // A car paired before the devices migration and not covered by its backfill. Adopt
    // it so the next request takes the device path.
    await supabase
      .from("bydmate_devices")
      .upsert(
        {
          user_id: hashedProfile.id,
          kind: "mate" satisfies VoltflowMateDeviceKind,
          api_key_hash: keyHash,
          api_key_fingerprint: voltflowMateApiKeyFingerprint(trimmed),
        },
        { onConflict: "user_id,kind" },
      );

    return toApiKeyProfile(hashedProfile);
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
      bydmate_cloud_api_key_hash: keyHash,
      bydmate_cloud_api_key_fingerprint: voltflowMateApiKeyFingerprint(trimmed),
    })
    .eq("id", legacyProfile.id)
    .eq("bydmate_cloud_api_key", trimmed);

  await supabase
    .from("bydmate_devices")
    .upsert(
      {
        user_id: legacyProfile.id,
        kind: "mate" satisfies VoltflowMateDeviceKind,
        api_key_hash: keyHash,
        api_key_fingerprint: voltflowMateApiKeyFingerprint(trimmed),
      },
      { onConflict: "user_id,kind" },
    );

  return toApiKeyProfile(legacyProfile);
}
