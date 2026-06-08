import type { SupabaseClient } from "@supabase/supabase-js";

export async function resolveBydmateApiKeyProfile(
  supabase: SupabaseClient,
  apiKey: string,
): Promise<{ id: string } | null> {
  const trimmed = apiKey.trim();
  if (!trimmed) return null;

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("bydmate_cloud_api_key", trimmed)
    .maybeSingle();

  if (error || !profile?.id) return null;
  return { id: profile.id };
}
