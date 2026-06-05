import { NextRequest, NextResponse } from "next/server";

import { backfillLiveSnapshotsWithSoh } from "@/lib/bydmate/live-soh-backfill";
import { devVehicleId, resolveVehicleApiAccess } from "@/lib/dev/dev-api-auth";
import type { BydmateLiveSnapshotRow } from "@/types/database";

export async function GET(request: NextRequest) {
  const access = await resolveVehicleApiAccess(request);
  if (!access) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const vehicleId = devVehicleId(request);
  let query = access.supabase
    .from("bydmate_live_snapshots")
    .select("*")
    .eq("vehicle_id", vehicleId);

  if (!access.devMode) {
    query = query.eq("user_id", access.userId);
  }

  const { data, error } = await query
    .order("received_at", { ascending: false })
    .limit(1);

  if (error) {
    return NextResponse.json({ error: "Failed to load live snapshot" }, { status: 500 });
  }

  const rows = (data ?? []) as BydmateLiveSnapshotRow[];
  const enriched = await backfillLiveSnapshotsWithSoh(
    access.supabase,
    rows,
    access.devMode ? undefined : access.userId,
  );
  const snapshot = enriched[0] ?? null;
  return NextResponse.json({ snapshot, snapshots: snapshot ? [snapshot] : [] });
}
