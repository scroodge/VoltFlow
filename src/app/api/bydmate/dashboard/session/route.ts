import { NextRequest, NextResponse } from "next/server";

import { resolveDashboardSession } from "@/lib/bydmate/dashboard-entitlement";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const apiKey = request.headers.get("x-api-key")?.trim() ?? "";
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "missing_api_key" }, { status: 401 });
  }

  const buildHeader = request.headers.get("x-dashboard-build")?.trim().toLowerCase();
  const allowDebugBuild =
    buildHeader === "debug" && process.env.ALLOW_DEBUG_DASHBOARD === "true";

  try {
    const result = await resolveDashboardSession(supabaseAdmin, apiKey, { allowDebugBuild });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      ok: true,
      entitled: true,
      command: result.command,
      nonce: result.nonce,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "session_failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
