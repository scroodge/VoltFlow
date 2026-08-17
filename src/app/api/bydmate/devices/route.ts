import { NextRequest, NextResponse } from "next/server";

import { resolveVehicleApiAccess } from "@/lib/dev/dev-api-auth";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

/**
 * The signed-in user's paired clients, for the settings cloud card.
 *
 * `bydmate_devices` is service-role only (RLS on, no policies — see 20260816120000), so
 * the browser cannot read it directly the way it reads telemetry. This route is the
 * substitute: it authenticates the session, then reads that one user's rows.
 *
 * Credential material never leaves the server. `api_key_fingerprint` is included because
 * it is already the value shown for identifying a key, but `api_key_hash` is not
 * selected at all.
 */
export async function GET(request: NextRequest) {
  const access = await resolveVehicleApiAccess(request);
  if (!access) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("bydmate_devices")
      .select(
        "kind, app_version, version_code, app_version_seen_at, api_key_fingerprint, created_at",
      )
      .eq("user_id", access.userId)
      .order("kind", { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json(
      { ok: true, devices: data ?? [] },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load devices";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
