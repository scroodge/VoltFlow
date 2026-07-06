import { NextRequest, NextResponse } from "next/server";

import { sendInactivityWarning } from "@/lib/email/inactivity-warning";
import { supabaseAdmin } from "@/lib/supabase/admin";

const CRON_SECRET = process.env.CRON_SECRET ?? "";

export async function POST(request: NextRequest) {
  const auth = request.headers.get("x-cron-secret");
  if (!auth || auth !== CRON_SECRET) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();
  const results = { warnings_sent: 0, accounts_deleted: 0, errors: [] as string[] };

  // Step 1: find users inactive for 30+ days, no warning sent yet, not premium
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: warnCandidates } = await supabaseAdmin
    .from("profiles")
    .select("id, email")
    .lt("last_active_at", thirtyDaysAgo)
    .is("inactivity_warning_sent_at", null)
    .or("is_premium.is.null,is_premium.eq.false")
    .or("premium_until.is.null,premium_until.lt", thirtyDaysAgo);

  if (warnCandidates) {
    for (const profile of warnCandidates) {
      if (!profile.email) continue;
      const result = await sendInactivityWarning(profile.email);
      if (result.ok) {
        await supabaseAdmin
          .from("profiles")
          .update({ inactivity_warning_sent_at: now.toISOString() })
          .eq("id", profile.id);
        results.warnings_sent++;
      } else {
        results.errors.push(`Warning email failed for ${profile.id}: ${result.error}`);
      }
    }
  }

  // Step 2: find users inactive for 60+ days, warning sent, not premium
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString();

  const { data: deleteCandidates } = await supabaseAdmin
    .from("profiles")
    .select("id, email")
    .lt("last_active_at", sixtyDaysAgo)
    .not("inactivity_warning_sent_at", "is", null)
    .or("is_premium.is.null,is_premium.eq.false")
    .or("premium_until.is.null,premium_until.lt", sixtyDaysAgo);

  if (deleteCandidates) {
    for (const profile of deleteCandidates) {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(profile.id);
      if (error) {
        results.errors.push(`Deletion failed for ${profile.id}: ${error.message}`);
      } else {
        results.accounts_deleted++;
      }
    }
  }

  return NextResponse.json({ ok: true, ...results });
}
