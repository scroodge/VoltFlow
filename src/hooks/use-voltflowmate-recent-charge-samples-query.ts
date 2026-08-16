"use client";

import { useQuery } from "@tanstack/react-query";

import { isDevAppRoute } from "@/lib/dev/dev-fetch";
import { createClient } from "@/lib/supabase/client";
import { queryKeys } from "@/lib/query-keys";
import { finiteTelemetryNumber } from "@/features/charging/_domain/telemetry-charging";
import type { ChargeReadingSample } from "@/features/charging/_domain/charging-live";

/** Must cover LIVE_CHARGE_FROZEN_STALE_MS (10 min) plus slack so a full unchanged run is visible. */
const LOOKBACK_MS = 15 * 60_000;

async function fetchRecentChargeSamples(vehicleId: string): Promise<ChargeReadingSample[]> {
  if (isDevAppRoute()) return [];

  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return [];

  const cutoffIso = new Date(Date.now() - LOOKBACK_MS).toISOString();
  const { data, error } = await supabase
    .from("bydmate_telemetry_samples")
    .select("device_time,telemetry")
    .eq("user_id", user.id)
    .eq("vehicle_id", vehicleId)
    .gte("device_time", cutoffIso)
    .order("device_time", { ascending: true });

  if (error) throw error;

  return ((data ?? []) as { device_time: string; telemetry: Record<string, unknown> | null }[])
    .map((row) => ({
      deviceTimeMs: Date.parse(row.device_time),
      soc: finiteTelemetryNumber(row.telemetry?.soc),
      chargePowerKw: finiteTelemetryNumber(row.telemetry?.charge_power_kw),
    }))
    .filter((sample) => Number.isFinite(sample.deviceTimeMs));
}

/**
 * Powers dashboard-only frozen-reading detection (isFrozenLiveChargeReading) — a read-side
 * check against already-stored telemetry history, deliberately not touching the shared
 * telemetry ingest RPC (see BACKLOG.md "Dashboard live-charging tile can still show a
 * stale kW..." for why option 1, an ingest-RPC tracker, was rejected). `enabled` should be
 * the dashboard's own "looks like charging" condition, so this stays a no-op otherwise.
 */
export function useVoltflowMateRecentChargeSamplesQuery(
  vehicleId: string | null | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: queryKeys.voltflowMateRecentChargeSamples(vehicleId ?? null),
    queryFn: () => fetchRecentChargeSamples(vehicleId as string),
    enabled: enabled && !!vehicleId,
    staleTime: 30_000,
    refetchInterval: enabled && vehicleId ? 30_000 : false,
  });
}
