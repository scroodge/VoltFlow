import type { SupabaseClient } from "@supabase/supabase-js";

import type { BydmateLiveSnapshotRow, BydmateTelemetry } from "@/types/database";

export function validSohPercent(value: unknown): number | null {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;

  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 100 ? numeric : null;
}

export function snapshotNeedsSohBackfill(telemetry: BydmateTelemetry | null | undefined) {
  return validSohPercent(telemetry?.soh_percent) == null;
}

export function enrichSnapshotWithSoh<T extends Pick<BydmateLiveSnapshotRow, "telemetry">>(
  snapshot: T,
  sohPercent: number | null,
): T {
  if (!snapshotNeedsSohBackfill(snapshot.telemetry) || sohPercent == null) {
    return snapshot;
  }

  return {
    ...snapshot,
    telemetry: {
      ...snapshot.telemetry,
      soh_percent: sohPercent,
    },
  };
}

export async function fetchLastKnownSohForVehicle(
  supabase: SupabaseClient,
  vehicleId: string,
  userId?: string,
) {
  let query = supabase
    .from("bydmate_telemetry_samples")
    .select("telemetry")
    .eq("vehicle_id", vehicleId)
    .not("telemetry->>soh_percent", "is", null)
    .order("device_time", { ascending: false })
    .limit(20);

  if (userId) {
    query = query.eq("user_id", userId);
  }

  const { data, error } = await query;
  if (error) throw error;

  for (const row of data ?? []) {
    const soh = validSohPercent((row.telemetry as BydmateTelemetry | null)?.soh_percent);
    if (soh != null) return soh;
  }

  return null;
}

export async function backfillLiveSnapshotsWithSoh(
  supabase: SupabaseClient,
  snapshots: BydmateLiveSnapshotRow[],
  userId?: string,
) {
  const sohByVehicle = new Map<string, number | null>();
  const enriched: BydmateLiveSnapshotRow[] = [];

  for (const snapshot of snapshots) {
    if (!snapshotNeedsSohBackfill(snapshot.telemetry)) {
      enriched.push(snapshot);
      continue;
    }

    let soh = sohByVehicle.get(snapshot.vehicle_id);
    if (soh === undefined) {
      soh = await fetchLastKnownSohForVehicle(supabase, snapshot.vehicle_id, userId);
      sohByVehicle.set(snapshot.vehicle_id, soh);
    }

    enriched.push(enrichSnapshotWithSoh(snapshot, soh));
  }

  return enriched;
}
