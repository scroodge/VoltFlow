import { NextRequest, NextResponse } from "next/server";

import { validateVehicleCommand } from "@/lib/diplus/command-allowlist";
import { resolveVehicleApiAccess } from "@/lib/dev/dev-api-auth";

export const runtime = "nodejs";

const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_MAX = 10;
const COMMAND_TIMEOUT_MS = 60 * 1000;

type CommandRow = {
  id: string;
  vehicle_id: string;
  type: string;
  params: Record<string, unknown>;
  status: string;
  result: unknown;
  created_at: string;
  executed_at: string | null;
};

export async function GET(request: NextRequest) {
  const access = await resolveVehicleApiAccess(request);
  if (!access) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const vehicleId = request.nextUrl.searchParams.get("vehicle_id")?.trim();
  const limit = Math.min(
    50,
    Math.max(1, Number(request.nextUrl.searchParams.get("limit") ?? "20")),
  );

  let query = access.supabase
    .from("vehicle_commands")
    .select("id, vehicle_id, type, params, status, result, created_at, executed_at")
    .eq("user_id", access.userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (vehicleId) {
    query = query.eq("vehicle_id", vehicleId);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ ok: false, error: "Lookup failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, commands: (data ?? []) as CommandRow[] });
}

export async function POST(request: NextRequest) {
  const access = await resolveVehicleApiAccess(request);
  if (!access) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const payload = body as { vehicle_id?: string; type?: string; params?: Record<string, unknown> };
  const vehicleId = payload.vehicle_id?.trim();
  const type = payload.type?.trim();
  const params = payload.params ?? {};

  if (!vehicleId || !type) {
    return NextResponse.json({ ok: false, error: "vehicle_id and type required" }, { status: 400 });
  }

  const validated = validateVehicleCommand(type, params);
  if (!validated.ok) {
    return NextResponse.json({ ok: false, error: validated.error }, { status: 400 });
  }

  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const { count, error: countError } = await access.supabase
    .from("vehicle_commands")
    .select("id", { count: "exact", head: true })
    .eq("user_id", access.userId)
    .gte("created_at", since);

  if (countError) {
    return NextResponse.json({ ok: false, error: "Rate check failed" }, { status: 500 });
  }

  if ((count ?? 0) >= RATE_LIMIT_MAX) {
    return NextResponse.json(
      { ok: false, error: `Rate limit: max ${RATE_LIMIT_MAX} commands per 5 minutes` },
      { status: 429 },
    );
  }

  const { data: car, error: carError } = await access.supabase
    .from("cars")
    .select("vehicle_alias")
    .eq("user_id", access.userId)
    .eq("vehicle_alias", vehicleId)
    .maybeSingle();

  if (carError) {
    return NextResponse.json({ ok: false, error: "Vehicle lookup failed" }, { status: 500 });
  }

  if (!car?.vehicle_alias) {
    return NextResponse.json({ ok: false, error: "Unknown vehicle_id for user" }, { status: 400 });
  }

  const { data: inserted, error: insertError } = await access.supabase
    .from("vehicle_commands")
    .insert({
      user_id: access.userId,
      vehicle_id: vehicleId,
      type,
      params,
      status: "pending",
    })
    .select("id, vehicle_id, type, params, status, created_at")
    .single();

  if (insertError || !inserted) {
    return NextResponse.json({ ok: false, error: "Insert failed" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    command: inserted,
    timeout_ms: COMMAND_TIMEOUT_MS,
  });
}
