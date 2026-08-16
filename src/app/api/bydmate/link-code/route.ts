import { NextRequest, NextResponse } from "next/server";

import { createVoltflowMateLinkCode } from "@/lib/voltflowmate/link-code";
import { resolveVehicleApiAccess } from "@/lib/dev/dev-api-auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const access = await resolveVehicleApiAccess(request);
  if (!access) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { code, expiresAt } = await createVoltflowMateLinkCode(access.userId);
    return NextResponse.json(
      { ok: true, code, expires_at: expiresAt },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create link code";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
