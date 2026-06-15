import { NextRequest, NextResponse } from "next/server";

import { isDashboardEntitled } from "@/lib/bydmate/dashboard-entitlement";
import { BUCKET } from "@/lib/bydmate/cluster-backgrounds";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const MAX_BYTES = 5 * 1024 * 1024;

export async function GET() {
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const entitled = await isDashboardEntitled(supabaseAdmin, userData.user.id);
  if (!entitled) {
    return NextResponse.json({ ok: false, error: "not_entitled" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("cluster_backgrounds")
    .select("id, display_name, storage_path, created_at")
    .eq("user_id", userData.user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, backgrounds: data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const entitled = await isDashboardEntitled(supabaseAdmin, userData.user.id);
  if (!entitled) {
    return NextResponse.json({ ok: false, error: "not_entitled" }, { status: 403 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "missing_file" }, { status: 400 });
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: "file_too_large" }, { status: 400 });
  }

  const id = crypto.randomUUID();
  const storagePath = `${userData.user.id}/${id}.png`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { error: uploadError } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(storagePath, bytes, {
      contentType: file.type || "image/png",
      upsert: false,
    });

  if (uploadError) {
    return NextResponse.json({ ok: false, error: uploadError.message }, { status: 500 });
  }

  const displayName = file.name || "background.png";
  const { data: row, error: insertError } = await supabase
    .from("cluster_backgrounds")
    .insert({
      id,
      user_id: userData.user.id,
      storage_path: storagePath,
      display_name: displayName,
    })
    .select("id, display_name, created_at")
    .single();

  if (insertError) {
    return NextResponse.json({ ok: false, error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, background: row });
}
