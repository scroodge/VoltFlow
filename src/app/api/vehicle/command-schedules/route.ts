import { NextRequest, NextResponse } from "next/server";

import { validateVehicleCommand } from "@/lib/diplus/command-allowlist";
import { resolveVehicleApiAccess } from "@/lib/dev/dev-api-auth";

export const runtime = "nodejs";

type ScheduleInput = {
  vehicle_id?: string;
  type?: string;
  params?: Record<string, unknown>;
  run_time?: string;
  days_of_week?: unknown;
  time_zone?: string;
  enabled?: boolean;
};

function parseDays(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const days = [...new Set(value.map((day) => Number(day)))].sort((a, b) => a - b);
  return days.length >= 1 && days.length <= 7 && days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    ? days
    : null;
}

function parseRunTime(value: unknown): string | null {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  return value;
}

function parseTimeZone(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return null;
  }
}

async function requireKnownVehicle(
  supabase: Awaited<ReturnType<typeof resolveVehicleApiAccess>> extends infer Access
    ? Access extends { supabase: infer Client } ? Client : never
    : never,
  userId: string,
  vehicleId: string,
) {
  const { data, error } = await supabase
    .from("cars")
    .select("vehicle_alias")
    .eq("user_id", userId)
    .eq("vehicle_alias", vehicleId)
    .maybeSingle();
  return !error && Boolean(data?.vehicle_alias);
}

export async function GET(request: NextRequest) {
  const access = await resolveVehicleApiAccess(request);
  if (!access) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const vehicleId = request.nextUrl.searchParams.get("vehicle_id")?.trim();
  let query = access.supabase
    .from("vehicle_command_schedules")
    .select("*")
    .eq("user_id", access.userId)
    .order("next_run_at");
  if (vehicleId) query = query.eq("vehicle_id", vehicleId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ ok: false, error: "Lookup failed" }, { status: 500 });
  return NextResponse.json({ ok: true, schedules: data ?? [] });
}

export async function POST(request: NextRequest) {
  const access = await resolveVehicleApiAccess(request);
  if (!access) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body: ScheduleInput;
  try { body = await request.json() as ScheduleInput; } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const vehicleId = body.vehicle_id?.trim();
  const type = body.type?.trim();
  const params = body.params ?? {};
  const runTime = parseRunTime(body.run_time);
  const days = parseDays(body.days_of_week);
  const timeZone = parseTimeZone(body.time_zone);
  if (!vehicleId || !type || !runTime || !days || !timeZone) {
    return NextResponse.json({ ok: false, error: "vehicle_id, type, params, run_time, days_of_week and time_zone required" }, { status: 400 });
  }
  const command = validateVehicleCommand(type, params);
  if (!command.ok) return NextResponse.json({ ok: false, error: command.error }, { status: 400 });
  if (!await requireKnownVehicle(access.supabase, access.userId, vehicleId)) {
    return NextResponse.json({ ok: false, error: "Unknown vehicle_id for user" }, { status: 400 });
  }

  const { data: nextRunAt, error: nextError } = await access.supabase.rpc("next_vehicle_command_schedule_run", {
    p_run_time: runTime,
    p_days_of_week: days,
    p_time_zone: timeZone,
  });
  if (nextError || !nextRunAt) return NextResponse.json({ ok: false, error: "Schedule calculation failed" }, { status: 500 });

  const { data, error } = await access.supabase
    .from("vehicle_command_schedules")
    .insert({ user_id: access.userId, vehicle_id: vehicleId, type, params, run_time: runTime, days_of_week: days, time_zone: timeZone, next_run_at: nextRunAt, enabled: body.enabled !== false })
    .select("*")
    .single();
  if (error || !data) return NextResponse.json({ ok: false, error: "Insert failed" }, { status: 500 });
  return NextResponse.json({ ok: true, schedule: data }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const access = await resolveVehicleApiAccess(request);
  if (!access) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const id = request.nextUrl.searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  const { error } = await access.supabase
    .from("vehicle_command_schedules")
    .delete()
    .eq("id", id)
    .eq("user_id", access.userId);
  if (error) return NextResponse.json({ ok: false, error: "Delete failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
