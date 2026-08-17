import { NextRequest, NextResponse } from "next/server";

import type { VoltflowMateDeviceKind } from "@/lib/voltflowmate/api-auth";
import { normalizeReportedAppVersion } from "@/lib/voltflowmate/dashboard-entitlement";
import {
  clientIpFromRequest,
  hashClientIp,
  redeemVoltflowMateLinkCode,
} from "@/lib/voltflowmate/link-code";

export const runtime = "nodejs";

// Mate and the Dashboard redeem through this one endpoint and hold separate
// credentials. Only the Dashboard announces itself; anything else is a car, which is
// what every Mate build shipped before this field existed.
function deviceKindFromBody(client: unknown): VoltflowMateDeviceKind {
  return typeof client === "string" && client.trim().toLowerCase() === "dashboard"
    ? "dashboard"
    : "mate";
}

export async function POST(request: NextRequest) {
  let body: {
    code?: unknown;
    client?: unknown;
    app_version?: unknown;
    version_code?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const rawCode = typeof body.code === "string" ? body.code : String(body.code ?? "");
  const ipHash = hashClientIp(clientIpFromRequest(request));

  try {
    const result = await redeemVoltflowMateLinkCode(
      rawCode,
      ipHash,
      deviceKindFromBody(body.client),
      normalizeReportedAppVersion(body.app_version, body.version_code),
    );
    if (!result.ok) {
      const status = result.rateLimited ? 429 : 401;
      return NextResponse.json({ ok: false, error: result.error }, { status });
    }

    return NextResponse.json(
      {
        ok: true,
        api_key: result.apiKey,
        endpoint_url: result.endpointUrl,
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Redeem failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
