import type { SupabaseClient } from "@supabase/supabase-js";

export const USER_ACTIVITY_REFRESH_MS = 60 * 60 * 1_000;

/**
 * Best-effort activity stamp shared by browser auth and device ingestion paths.
 * The conditional update keeps repeated calls cheap while preserving a one-hour
 * upper bound on timestamp staleness.
 */
export async function stampUserActivity(
  supabase: SupabaseClient,
  userId: string,
  now = new Date(),
): Promise<boolean> {
  const activityTime = now.toISOString();
  const lastActiveBefore = new Date(now.getTime() - USER_ACTIVITY_REFRESH_MS).toISOString();
  try {
    const { error } = await supabase
      .from("profiles")
      .update({ last_active_at: activityTime })
      .eq("id", userId)
      .or(`last_active_at.is.null,last_active_at.lt.${lastActiveBefore}`);

    return !error;
  } catch {
    return false;
  }
}
