import { NextRequest, NextResponse } from "next/server";

import { resolveEffectivePremium } from "@/lib/premium-entitlement";
import { getPremiumUpgradeEmail } from "@/lib/premium-upgrade-mailto";
import { resolveVehicleApiAccess } from "@/lib/dev/dev-api-auth";

const FREE_RETENTION_DAYS = 30;
const PREMIUM_RETENTION_DAYS = 365;

export async function GET(request: NextRequest) {
  const access = await resolveVehicleApiAccess(request);
  if (!access) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const primaryProfile = await access.supabase
    .from("profiles")
    .select("is_premium,premium_until")
    .eq("id", access.userId)
    .maybeSingle();
  const profileResult =
    primaryProfile.error &&
    primaryProfile.error.code === "42703" &&
    primaryProfile.error.message.includes("premium_until")
      ? await access.supabase
          .from("profiles")
          .select("is_premium")
          .eq("id", access.userId)
          .maybeSingle()
      : primaryProfile;

  if (profileResult.error) {
    return NextResponse.json({ error: profileResult.error.message }, { status: 500 });
  }

  const profile = (profileResult.data ?? null) as
    | { is_premium?: boolean | null; premium_until?: string | null }
    | null;
  const { data: adminRow, error: adminError } = await access.supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", access.userId)
    .maybeSingle();
  if (adminError) {
    return NextResponse.json({ error: adminError.message }, { status: 500 });
  }

  const isPremium = resolveEffectivePremium({
    isAdmin: Boolean(adminRow?.user_id),
    isPremiumFlag: profile?.is_premium === true,
    premiumUntil: profile?.premium_until ?? null,
  });
  const retentionDays = isPremium ? PREMIUM_RETENTION_DAYS : FREE_RETENTION_DAYS;

  const now = new Date();
  const oldestKeptDate = new Date(now);
  oldestKeptDate.setUTCDate(oldestKeptDate.getUTCDate() - retentionDays);
  const nextDeletionDate = new Date(now);
  nextDeletionDate.setUTCDate(nextDeletionDate.getUTCDate() + 1);
  nextDeletionDate.setUTCHours(3, 0, 0, 0);

  return NextResponse.json({
    ok: true,
    isPremium,
    retentionDays,
    oldestKeptDate: oldestKeptDate.toISOString(),
    nextDeletionDate: nextDeletionDate.toISOString(),
    upgradeEmail: getPremiumUpgradeEmail(),
  });
}
