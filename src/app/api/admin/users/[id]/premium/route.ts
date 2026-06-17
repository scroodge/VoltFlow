import { NextRequest, NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/knowledge";

type PremiumUpdateBody = {
  premiumUntil?: string | null;
  isPremium?: boolean;
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin();
  if (!guard.ok) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const { id: userId } = await context.params;
  if (!userId) {
    return NextResponse.json({ error: "Missing user id." }, { status: 400 });
  }

  const { data: adminRow, error: adminError } = await supabaseAdmin
    .from("admin_users")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (adminError) {
    return NextResponse.json({ error: adminError.message }, { status: 500 });
  }
  if (adminRow?.user_id) {
    return NextResponse.json(
      { error: "admins are permanent premium" },
      { status: 400 },
    );
  }

  let body: PremiumUpdateBody;
  try {
    body = (await request.json()) as PremiumUpdateBody;
  } catch {
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

  if (Object.keys(updatePayload).length === 0) {
    return NextResponse.json({ error: "No premium fields provided." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
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

  return NextResponse.json({ ok: true, user: data });
}
