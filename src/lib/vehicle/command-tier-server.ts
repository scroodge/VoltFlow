import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveUserEffectivePremium } from "@/lib/premium-entitlement-server";
import type { CommandTier } from "@/lib/vehicle/command-quota";

/** Admin > Premium > free. A failed lookup reads as free: the quota then still applies. */
export async function resolveCommandTier(
  supabase: SupabaseClient,
  userId: string,
): Promise<CommandTier> {
  try {
    const { data: adminRow } = await supabase
      .from("admin_users")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (adminRow?.user_id) return "admin";
    return (await resolveUserEffectivePremium(supabase, userId))
      ? "premium"
      : "free";
  } catch {
    return "free";
  }
}
