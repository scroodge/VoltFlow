import { NextRequest, NextResponse } from "next/server";

import { writeAdminAuditLog } from "@/lib/admin-audit-log";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/knowledge";

type PremiumUpdateBody = {
  premiumUntil?: string | null;
  isPremium?: boolean;
  payment?: {
    amount: number;
    currency: string;
    method: string;
    note?: string | null;
  };
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin();
  if (!guard.ok || !guard.user) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const { id: userId } = await context.params;
  if (!userId) {
    return NextResponse.json({ error: "Missing user id." }, { status: 400 });
  }

  const { data: adminRow, error: adminError } = await getSupabaseAdmin()
    .from("admin_users")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (adminError) {
    return NextResponse.json({ error: adminError.message }, { status: 500 });
  }
  let body: PremiumUpdateBody;
  try {
    body = (await request.json()) as PremiumUpdateBody;
  } catch {
    body = {};
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    body = {};
  }

  const premiumUntil =
    body.premiumUntil === undefined
      ? undefined
      : body.premiumUntil === null || body.premiumUntil === ""
        ? null
        : body.premiumUntil;

  if (typeof premiumUntil === "string") {
    const parsed = Date.parse(premiumUntil);
    if (!Number.isFinite(parsed)) {
      return NextResponse.json({ error: "Invalid premiumUntil value." }, { status: 400 });
    }
  }

  const updatePayload: Record<string, unknown> = {};
  if (premiumUntil !== undefined) {
    updatePayload.premium_until = premiumUntil;
  }
  if (typeof body.isPremium === "boolean") {
    updatePayload.is_premium = body.isPremium;
  }

  const payment = body.payment;
  if (payment !== undefined) {
    if (
      !payment ||
      typeof payment !== "object" ||
      typeof payment.amount !== "number" ||
      !Number.isFinite(payment.amount) ||
      payment.amount <= 0 ||
      typeof payment.currency !== "string" ||
      payment.currency.trim().length === 0 ||
      typeof payment.method !== "string" ||
      payment.method.trim().length === 0 ||
      (payment.note != null && typeof payment.note !== "string")
    ) {
      return NextResponse.json({ error: "Invalid donation details." }, { status: 400 });
    }
    if ("premiumUntil" in body || "isPremium" in body) {
      return NextResponse.json(
        { error: "A donation cannot be recorded together with an access change." },
        { status: 400 },
      );
    }

    const { data: profile, error: profileError } = await getSupabaseAdmin()
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle();
    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 });
    }
    if (!profile) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    // Keep the historical table name for compatibility; new records are donation
    // statistics and have no access period attached.
    const { error: paymentError } = await getSupabaseAdmin().from("premium_payments").insert({
      user_id: userId,
      amount: payment.amount,
      currency: payment.currency.trim(),
      method: payment.method.trim(),
      note: payment.note?.trim() || null,
      recorded_by_admin_id: guard.user.id,
      applied_until: null,
    });
    if (paymentError) {
      return NextResponse.json({ error: paymentError.message }, { status: 500 });
    }
    await writeAdminAuditLog({
      actorAdminId: guard.user.id,
      targetUserId: userId,
      action: "donation_recorded",
      details: {
        amount: payment.amount,
        currency: payment.currency.trim(),
        method: payment.method.trim(),
      },
    });
    return NextResponse.json({ ok: true, donationRecorded: true });
  }

  if (Object.keys(updatePayload).length === 0) {
    return NextResponse.json({ error: "No access fields provided." }, { status: 400 });
  }
  if (adminRow?.user_id) {
    return NextResponse.json(
      { error: "admins are permanent premium" },
      { status: 400 },
    );
  }

  const { data: before } = await getSupabaseAdmin()
    .from("profiles")
    .select("is_premium,premium_until")
    .eq("id", userId)
    .maybeSingle();

  const { data, error } = await getSupabaseAdmin()
    .from("profiles")
    .update(updatePayload)
    .eq("id", userId)
    .select("id,email,is_premium,premium_until")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  await writeAdminAuditLog({
    actorAdminId: guard.user.id,
    targetUserId: userId,
    action: "premium_update",
    details: {
      before: { is_premium: before?.is_premium ?? null, premium_until: before?.premium_until ?? null },
      after: { is_premium: data.is_premium, premium_until: data.premium_until },
    },
  });

  return NextResponse.json({ ok: true, user: data });
}
