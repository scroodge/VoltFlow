import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Upper bound on a stored layout, enforced here rather than as a CHECK constraint
 * (see 20260816140000_dashboard_layouts.sql). A real DashboardLayoutConfig is a few KB —
 * a handful of widgets with normalized coordinates — so this is a guard against a bug or
 * a stolen key, not a ceiling any dashboard should approach.
 */
export const MAX_LAYOUT_BYTES = 256 * 1024;

export type StoredDashboardLayout = {
  layout: Record<string, unknown>;
  layoutVersion: number;
  updatedAt: string;
};

export async function getDashboardLayout(
  supabase: SupabaseClient,
  userId: string,
): Promise<StoredDashboardLayout | null> {
  const { data, error } = await supabase
    .from("dashboard_layouts")
    .select("layout, layout_version, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data || data.layout === null || typeof data.layout !== "object") {
    return null;
  }

  return {
    layout: data.layout as Record<string, unknown>,
    layoutVersion: Number(data.layout_version ?? 1),
    updatedAt: String(data.updated_at ?? ""),
  };
}

export async function saveDashboardLayout(
  supabase: SupabaseClient,
  userId: string,
  layout: Record<string, unknown>,
  layoutVersion: number,
): Promise<{ updatedAt: string }> {
  const updatedAt = new Date().toISOString();

  const { error } = await supabase.from("dashboard_layouts").upsert(
    {
      user_id: userId,
      layout,
      layout_version: layoutVersion,
      updated_at: updatedAt,
    },
    { onConflict: "user_id" },
  );

  if (error) {
    throw new Error(error.message);
  }

  return { updatedAt };
}
