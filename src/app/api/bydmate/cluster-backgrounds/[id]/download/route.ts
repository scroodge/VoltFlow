import { NextRequest, NextResponse } from "next/server";

import {
  downloadClusterBackgroundBytes,
  getClusterBackgroundForDownload,
  resolveEntitledProfileId,
} from "@/lib/bydmate/cluster-backgrounds";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const apiKey = request.headers.get("x-api-key")?.trim() ?? "";
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "missing_api_key" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!id?.trim()) {
    return NextResponse.json({ ok: false, error: "missing_id" }, { status: 400 });
  }

  try {
    const auth = await resolveEntitledProfileId(supabaseAdmin, apiKey);
    if ("error" in auth) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const row = await getClusterBackgroundForDownload(supabaseAdmin, auth.userId, id.trim());
    if (!row) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }

    const bytes = await downloadClusterBackgroundBytes(supabaseAdmin, row.storagePath);
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": `inline; filename="${encodeURIComponent(row.displayName)}"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "download_failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
