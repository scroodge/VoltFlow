import { NextRequest, NextResponse } from "next/server";

import { validateVehicleCommand } from "@/lib/diplus/command-allowlist";
import { resolveVehicleApiAccess } from "@/lib/dev/dev-api-auth";
import {
  SENT_ACK_TIMEOUT_RESULT,
  staleSentCommandIds,
} from "@/lib/voltflowmate/command-ack-timeout";
import { REMOTE_COMMANDS_ENABLED } from "@/lib/voltflowmate/remote-commands";
import { createServiceClient } from "@/lib/supabase/service";
import {
  CAMERA_SNAPSHOT_TYPE,
  COUNTED_STATUSES,
  quotaBlock,
  quotaBucket,
  quotaMessage,
  quotaWindowMs,
  type QuotaRow,
} from "@/lib/vehicle/command-quota";
import { resolveCommandTier } from "@/lib/vehicle/command-tier-server";

export const runtime = "nodejs";

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
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const vehicleId = request.nextUrl.searchParams.get("vehicle_id")?.trim();
  const limit = Math.min(
    50,
    Math.max(1, Number(request.nextUrl.searchParams.get("limit") ?? "20")),
  );

  let query = access.supabase
    .from("vehicle_commands")
    .select(
      "id, vehicle_id, type, params, status, result, created_at, executed_at",
    )
    .eq("user_id", access.userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (vehicleId) {
    query = query.eq("vehicle_id", vehicleId);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { ok: false, error: "Lookup failed" },
      { status: 500 },
    );
  }

  const commands = (data ?? []) as CommandRow[];

  // Claimed by the car but never acked: settle it so the web stops waiting. Writes only when
  // such a row is actually in view; a late ack from the car still overwrites it.
  const staleIds = staleSentCommandIds(commands, Date.now());
  if (staleIds.length > 0) {
    const executedAt = new Date().toISOString();
    // No user UPDATE policy on vehicle_commands; scoped to this user's own sent rows.
    await createServiceClient()
      .from("vehicle_commands")
      .update({
        status: "failed",
        executed_at: executedAt,
        result: SENT_ACK_TIMEOUT_RESULT,
      })
      .in("id", staleIds)
      .eq("user_id", access.userId)
      .eq("status", "sent");
    for (const row of commands) {
      if (staleIds.includes(row.id)) {
        row.status = "failed";
        row.executed_at = executedAt;
        row.result = SENT_ACK_TIMEOUT_RESULT;
      }
    }
  }

  return NextResponse.json({ ok: true, commands });
}

export async function POST(request: NextRequest) {
  const access = await resolveVehicleApiAccess(request);
  if (!access) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  if (!REMOTE_COMMANDS_ENABLED) {
    return NextResponse.json(
      { ok: false, error: "remote_commands_disabled" },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON" },
      { status: 400 },
    );
  }

  const payload = body as {
    vehicle_id?: string;
    type?: string;
    params?: Record<string, unknown>;
  };
  const vehicleId = payload.vehicle_id?.trim();
  const type = payload.type?.trim();
  const params = payload.params ?? {};

  if (!vehicleId || !type) {
    return NextResponse.json(
      { ok: false, error: "vehicle_id and type required" },
      { status: 400 },
    );
  }

  const validated = validateVehicleCommand(type, params);
  if (!validated.ok) {
    return NextResponse.json(
      { ok: false, error: validated.error },
      { status: 400 },
    );
  }

  // Plan quota: free = 1 command / 5 min and 1 camera snapshot / 8 h; Premium and admins
  // unlimited (see command-quota.ts).
  const tier = await resolveCommandTier(access.supabase, access.userId);
  if (tier === "free") {
    const bucket = quotaBucket(type);
    const since = new Date(Date.now() - quotaWindowMs(bucket)).toISOString();
    let recentQuery = access.supabase
      .from("vehicle_commands")
      .select("created_at, status, result")
      .eq("user_id", access.userId)
      .in("status", [...COUNTED_STATUSES])
      .gte("created_at", since);
    recentQuery =
      bucket === "snapshot"
        ? recentQuery.eq("type", CAMERA_SNAPSHOT_TYPE)
        : recentQuery.neq("type", CAMERA_SNAPSHOT_TYPE);
    const { data: recent, error: recentError } = await recentQuery;
    if (recentError) {
      return NextResponse.json(
        { ok: false, error: "Rate check failed" },
        { status: 500 },
      );
    }
    const block = quotaBlock(
      tier,
      type,
      (recent ?? []) as QuotaRow[],
      Date.now(),
    );
    if (block) {
      return NextResponse.json(
        {
          ok: false,
          error: quotaMessage(block),
          code: "plan_quota",
          retry_after_seconds: block.retryAfterSeconds,
        },
        {
          status: 429,
          headers: { "Retry-After": String(block.retryAfterSeconds) },
        },
      );
    }
  }

  const { data: car, error: carError } = await access.supabase
    .from("cars")
    .select("vehicle_alias")
    .eq("user_id", access.userId)
    .eq("vehicle_alias", vehicleId)
    .maybeSingle();

  if (carError) {
    return NextResponse.json(
      { ok: false, error: "Vehicle lookup failed" },
      { status: 500 },
    );
  }

  if (!car?.vehicle_alias) {
    return NextResponse.json(
      { ok: false, error: "Unknown vehicle_id for user" },
      { status: 400 },
    );
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
    return NextResponse.json(
      { ok: false, error: "Insert failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    command: inserted,
    timeout_ms: COMMAND_TIMEOUT_MS,
  });
}
