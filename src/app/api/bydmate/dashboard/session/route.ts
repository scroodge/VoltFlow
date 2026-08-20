import { NextRequest, NextResponse } from "next/server";

import {
  parseDashboardVersionHeaders,
  recordDashboardAppVersion,
  resolveDashboardSession,
} from "@/lib/voltflowmate/dashboard-entitlement";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

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
    const result = await resolveDashboardSession(getSupabaseAdmin(), apiKey, { allowDebugBuild });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }

    // Only after the key is known good, so an unauthenticated caller cannot write here.
    // Awaited rather than fired and forgotten: this runtime may freeze the function once
    // the response is returned, which would drop the write silently.
    await recordDashboardAppVersion(
      getSupabaseAdmin(),
      apiKey,
      parseDashboardVersionHeaders(
        request.headers.get("x-dashboard-version"),
        request.headers.get("x-dashboard-version-code"),
      ),
    );

    return NextResponse.json({
      ok: true,
      entitled: true,
      command: result.command,
      nonce: result.nonce,
      close_command: result.closeCommand,
      close_nonce: result.closeNonce,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "session_failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
