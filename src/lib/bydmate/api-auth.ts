import type { SupabaseClient } from "@supabase/supabase-js";

export type BydmateApiKeyProfile = {
  id: string;
  /** See `profiles.live_fast_until` — while in the future, Mate should send status fast. */
  liveFastUntil: string | null;
  liveFastVehicleId: string | null;
};

export async function resolveBydmateApiKeyProfile(
  supabase: SupabaseClient,
  apiKey: string,
): Promise<BydmateApiKeyProfile | null> {
  const trimmed = apiKey.trim();
  if (!trimmed) return null;

  // The live-fast columns ride this existing lookup on purpose: the command poll runs
  // every ~6s per car, and reading them here keeps that hot path at one indexed read.
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, live_fast_until, live_fast_vehicle_id")
    .eq("bydmate_cloud_api_key", trimmed)
    .maybeSingle();

  if (error || !profile?.id) return null;
  return {
    id: profile.id,
    liveFastUntil: profile.live_fast_until ?? null,
    liveFastVehicleId: profile.live_fast_vehicle_id ?? null,
  };
}
