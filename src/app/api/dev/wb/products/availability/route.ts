import { NextResponse } from "next/server";

import { proxyBackendRequest } from "../../_proxy";

export const runtime = "nodejs";

export async function POST() {
  const params = new URLSearchParams({
    vehicle: "BYD Yuan Up",
    limit: "50",
  });
  const backendResponse = await proxyBackendRequest(
    `/api/marketplace/saved-items/availability/refresh?${params.toString()}`,
    { method: "POST" },
  );
  const backendPayload = await backendResponse.json();

  if (!backendResponse.ok) {
    return NextResponse.json(backendPayload, { status: backendResponse.status });
  }

  return NextResponse.json(backendPayload);
}
