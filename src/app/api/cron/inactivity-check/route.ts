import { NextRequest, NextResponse } from "next/server";

import { sendInactivityWarning } from "@/lib/email/inactivity-warning";
import { getInactivityCutoffs } from "@/lib/inactivity-cleanup";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const CRON_SECRET = process.env.CRON_SECRET ?? "";

export async function POST(request: NextRequest) {
  const auth = request.headers.get("x-cron-secret");
  if (!auth || auth !== CRON_SECRET) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();
  const results = { warnings_sent: 0, accounts_deleted: 0, errors: [] as string[] };

  // Step 1: find users inactive for 30+ days, no warning sent yet, not premium
  const { thirtyDaysAgo, sixtyDaysAgo } = getInactivityCutoffs(now);

  const { data: warnCandidates, error: warnQueryError } = await getSupabaseAdmin()
    .from("profiles")
    .select("id, email")
    .lt("last_active_at", thirtyDaysAgo)
    .is("inactivity_warning_sent_at", null)
    .or("is_premium.is.null,is_premium.eq.false")
    .or(`premium_until.is.null,premium_until.lt.${thirtyDaysAgo}`);

  if (warnQueryError) {
    return NextResponse.json(
      { ok: false, ...results, error: `Warning candidate query failed: ${warnQueryError.message}` },
      { status: 500 },
    );
  }

  if (warnCandidates) {
    for (const profile of warnCandidates) {
      if (!profile.email) continue;
      const result = await sendInactivityWarning(profile.email);
      if (result.ok) {
        const { error: warningStampError } = await getSupabaseAdmin()
          .from("profiles")
          .update({ inactivity_warning_sent_at: now.toISOString() })
          .eq("id", profile.id);
        if (warningStampError) {
          results.errors.push(`Warning stamp failed for ${profile.id}: ${warningStampError.message}`);
        } else {
          results.warnings_sent++;
        }
      } else {
        results.errors.push(`Warning email failed for ${profile.id}: ${result.error}`);
      }
    }
  }

  // Step 2: find users inactive for 60+ days whose warning is at least 30 days old, not premium
  const { data: deleteCandidates, error: deleteQueryError } = await getSupabaseAdmin()
    .from("profiles")
    .select("id, email")
    .lt("last_active_at", sixtyDaysAgo)
    .lt("inactivity_warning_sent_at", thirtyDaysAgo)
    .or("is_premium.is.null,is_premium.eq.false")
    .or(`premium_until.is.null,premium_until.lt.${sixtyDaysAgo}`);

  if (deleteQueryError) {
    return NextResponse.json(
      { ok: false, ...results, error: `Deletion candidate query failed: ${deleteQueryError.message}` },
      { status: 500 },
    );
  }

  if (deleteCandidates) {
    for (const profile of deleteCandidates) {
      const { error } = await getSupabaseAdmin().auth.admin.deleteUser(profile.id);
      if (error) {
        results.errors.push(`Deletion failed for ${profile.id}: ${error.message}`);
      } else {
        results.accounts_deleted++;
      }
    }
  }

  return NextResponse.json({ ok: true, ...results });
}
