import { NextRequest, NextResponse } from "next/server";

import { resolveVehicleApiAccess } from "@/lib/dev/dev-api-auth";
import { resolveUserEffectivePremium } from "@/lib/premium-entitlement-server";

/**
 * Server-verified Premium badge source. Deliberately re-derives entitlement from
 * profiles+admin_users on the server rather than trusting a client-held copy of
 * profiles.is_premium -- see AUD-02 (BACKLOG.md): that column is client-writable
 * enough to self-grant without this indirection.
 */
export async function GET(request: NextRequest) {
  const access = await resolveVehicleApiAccess(request);
  if (!access) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const isPremium = await resolveUserEffectivePremium(access.supabase, access.userId);
    return NextResponse.json({ ok: true, isPremium });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not resolve entitlement" },
      { status: 500 },
    );
  }
}
