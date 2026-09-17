import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveEffectivePremium } from "@/lib/premium-entitlement";

/**
 * Server-side entitlement lookup shared by every route that needs to know whether a
 * user is effectively Premium (retention-status, the account entitlement badge, and
 * the dashboard cluster projection each duplicated this profile+admin_users dance
 * independently before this was extracted).
 */
export async function resolveUserEffectivePremium(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const primaryProfile = await supabase
    .from("profiles")
    .select("is_premium,premium_until")
    .eq("id", userId)
    .maybeSingle();
  const profileResult =
    primaryProfile.error &&
    primaryProfile.error.code === "42703" &&
    primaryProfile.error.message.includes("premium_until")
      ? await supabase.from("profiles").select("is_premium").eq("id", userId).maybeSingle()
      : primaryProfile;

  if (profileResult.error) {
    throw new Error(profileResult.error.message);
  }

  const profile = (profileResult.data ?? null) as
    | { is_premium?: boolean | null; premium_until?: string | null }
    | null;

  const { data: adminRow, error: adminError } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (adminError) {
    throw new Error(adminError.message);
  }

  return resolveEffectivePremium({
    isAdmin: Boolean(adminRow?.user_id),
    isPremiumFlag: profile?.is_premium === true,
    premiumUntil: profile?.premium_until ?? null,
  });
}
