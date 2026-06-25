import { NextRequest, NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/knowledge";

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin();
  if (!guard.ok) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const { id: targetUserId } = await context.params;
  if (!targetUserId) {
    return NextResponse.json({ error: "Missing user id." }, { status: 400 });
  }

  if (guard.user && guard.user.id === targetUserId) {
    return NextResponse.json(
      { error: "You cannot remove yourself from the admin list." },
      { status: 400 },
    );
  }

  const { data: existing, error: lookupError } = await supabaseAdmin
    .from("admin_users")
    .select("user_id")
    .eq("user_id", targetUserId)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json({ error: lookupError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json(
      { error: "User is not an admin." },
      { status: 404 },
    );
  }

  const { error: deleteError } = await supabaseAdmin
    .from("admin_users")
    .delete()
    .eq("user_id", targetUserId);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
