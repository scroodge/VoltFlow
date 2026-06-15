import { NextRequest, NextResponse } from "next/server";

import {
  listClusterBackgrounds,
  resolveEntitledProfileId,
} from "@/lib/bydmate/cluster-backgrounds";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const apiKey = request.headers.get("x-api-key")?.trim() ?? "";
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "missing_api_key" }, { status: 401 });
  }

  try {
    const auth = await resolveEntitledProfileId(supabaseAdmin, apiKey);
    if ("error" in auth) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const backgrounds = await listClusterBackgrounds(supabaseAdmin, auth.userId);
    return NextResponse.json({ ok: true, backgrounds });
  } catch (error) {
    const message = error instanceof Error ? error.message : "list_failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
