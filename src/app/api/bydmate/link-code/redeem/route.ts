import { NextRequest, NextResponse } from "next/server";

import {
  clientIpFromRequest,
  hashClientIp,
  redeemBydmateLinkCode,
} from "@/lib/bydmate/link-code";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let body: { code?: unknown };
  try {
    body = (await request.json()) as { code?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const rawCode = typeof body.code === "string" ? body.code : String(body.code ?? "");
  const ipHash = hashClientIp(clientIpFromRequest(request));

  try {
    const result = await redeemBydmateLinkCode(rawCode, ipHash);
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
