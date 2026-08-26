import { NextRequest, NextResponse } from "next/server";

import { resolveEntitledProfileId } from "@/lib/voltflowmate/cluster-backgrounds";
import {
  MAX_LAYOUT_BYTES,
  getDashboardLayout,
  saveDashboardLayout,
} from "@/lib/voltflowmate/dashboard-layouts";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type Authorized = { userId: string; response?: undefined };
type Rejected = { userId?: undefined; response: NextResponse };

async function authorize(request: NextRequest): Promise<Authorized | Rejected> {
  const apiKey = request.headers.get("x-api-key")?.trim() ?? "";
  if (!apiKey) {
    return { response: NextResponse.json({ ok: false, error: "missing_api_key" }, { status: 401 }) };
  }

  // Re-checks entitlement on every call. The cluster caches its own entitlement for six
  // hours, so a lapsed subscription can still present a client that believes it is
  // premium; this is the check that is actually current.
  const auth = await resolveEntitledProfileId(getSupabaseAdmin(), apiKey);
  if ("error" in auth) {
    return {
      response: NextResponse.json({ ok: false, error: auth.error }, { status: auth.status }),
    };
  }

  return { userId: auth.userId };
}

export async function GET(request: NextRequest) {
  const auth = await authorize(request);
  if (auth.response) {
    return auth.response;
  }

  try {
    const stored = await getDashboardLayout(getSupabaseAdmin(), auth.userId);
    if (!stored) {
      // An account that has never backed up is not an error — the cluster shows
      // "no backup yet" rather than a failure.
      return NextResponse.json({ ok: true, layout: null, layout_version: null, updated_at: null });
    }

    return NextResponse.json({
      ok: true,
      layout: stored.layout,
      layout_version: stored.layoutVersion,
      updated_at: stored.updatedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "layout_load_failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const auth = await authorize(request);
  if (auth.response) {
    return auth.response;
  }

  // Read as text first so an oversized body is rejected before it is parsed.
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  }

  if (Buffer.byteLength(raw, "utf8") > MAX_LAYOUT_BYTES) {
    return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  }

  const { layout, layout_version: layoutVersion } = body as {
    layout?: unknown;
    layout_version?: unknown;
  };

  if (typeof layout !== "object" || layout === null || Array.isArray(layout)) {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  }

  const version = Number(layoutVersion);
  if (!Number.isInteger(version) || version < 1) {
    return NextResponse.json({ ok: false, error: "invalid_layout_version" }, { status: 400 });
  }

  try {
    const { updatedAt } = await saveDashboardLayout(
      getSupabaseAdmin(),
      auth.userId,
      layout as Record<string, unknown>,
      version,
    );
    return NextResponse.json({ ok: true, updated_at: updatedAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "layout_save_failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
