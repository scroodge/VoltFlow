import { NextRequest, NextResponse } from "next/server";

import { getPremiumUpgradeEmail } from "@/lib/premium-upgrade-mailto";
import { resolveVehicleApiAccess } from "@/lib/dev/dev-api-auth";
import { resolveUserEffectivePremium } from "@/lib/premium-entitlement-server";

const FREE_RETENTION_DAYS = 30;

export async function GET(request: NextRequest) {
  const access = await resolveVehicleApiAccess(request);
  if (!access) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let isPremium: boolean;
  try {
    isPremium = await resolveUserEffectivePremium(access.supabase, access.userId);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not resolve entitlement" },
      { status: 500 },
    );
  }
  // Premium/admin retention is indefinite while the account is active (see
  // docs/PREMIUM_ADMIN.md and migration 20260626130000) -- there is no cutoff date to
  // report, unlike AUD-16's previous invented 365-day constant.
  if (isPremium) {
    return NextResponse.json({
      ok: true,
      isPremium: true,
      retentionDays: null,
      oldestKeptDate: null,
      nextDeletionDate: null,
      upgradeEmail: getPremiumUpgradeEmail(),
    });
  }

  const now = new Date();
  const oldestKeptDate = new Date(now);
  oldestKeptDate.setUTCDate(oldestKeptDate.getUTCDate() - FREE_RETENTION_DAYS);
  const nextDeletionDate = new Date(now);
  nextDeletionDate.setUTCDate(nextDeletionDate.getUTCDate() + 1);
  nextDeletionDate.setUTCHours(3, 0, 0, 0);

  return NextResponse.json({
    ok: true,
    isPremium: false,
    retentionDays: FREE_RETENTION_DAYS,
    oldestKeptDate: oldestKeptDate.toISOString(),
    nextDeletionDate: nextDeletionDate.toISOString(),
    upgradeEmail: getPremiumUpgradeEmail(),
  });
}
