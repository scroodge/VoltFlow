import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveBydmateApiKeyProfile } from "@/lib/bydmate/api-auth";
import { isDashboardEntitled } from "@/lib/bydmate/dashboard-entitlement";

const BUCKET = "cluster-backgrounds";
const SIGNED_URL_TTL_SEC = 3600;

export type ClusterBackgroundItem = {
  id: string;
  name: string;
  thumbnail_url: string;
  created_at: string;
};

export async function resolveEntitledProfileId(
  supabase: SupabaseClient,
  apiKey: string,
): Promise<{ userId: string } | { error: string; status: number }> {
  const profile = await resolveBydmateApiKeyProfile(supabase, apiKey);
  if (!profile) {
    return { error: "invalid_api_key", status: 401 };
  }

  const entitled = await isDashboardEntitled(supabase, profile.id);
  if (!entitled) {
    return { error: "not_entitled", status: 403 };
  }

  return { userId: profile.id };
}

export async function listClusterBackgrounds(
  supabase: SupabaseClient,
  userId: string,
): Promise<ClusterBackgroundItem[]> {
  const { data, error } = await supabase
    .from("cluster_backgrounds")
    .select("id, display_name, storage_path, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const rows = data ?? [];
  const items: ClusterBackgroundItem[] = [];

  for (const row of rows) {
    const path = typeof row.storage_path === "string" ? row.storage_path : "";
    if (!path) continue;

    const { data: signed, error: signError } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SEC);

    if (signError || !signed?.signedUrl) {
      continue;
    }

    items.push({
      id: String(row.id),
      name: String(row.display_name ?? "Background"),
      thumbnail_url: signed.signedUrl,
      created_at: String(row.created_at ?? ""),
    });
  }

  return items;
}

export async function getClusterBackgroundForDownload(
  supabase: SupabaseClient,
  userId: string,
  backgroundId: string,
): Promise<{ storagePath: string; displayName: string } | null> {
  const { data, error } = await supabase
    .from("cluster_backgrounds")
    .select("storage_path, display_name")
    .eq("id", backgroundId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const storagePath = typeof data?.storage_path === "string" ? data.storage_path : "";
  if (!storagePath) {
    return null;
  }

  return {
    storagePath,
    displayName: typeof data?.display_name === "string" ? data.display_name : "background.png",
  };
}

export async function downloadClusterBackgroundBytes(
  supabase: SupabaseClient,
  storagePath: string,
): Promise<Uint8Array> {
  const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);
  if (error || !data) {
    throw new Error(error?.message ?? "download_failed");
  }

  const buffer = await data.arrayBuffer();
  return new Uint8Array(buffer);
}

export { BUCKET };
