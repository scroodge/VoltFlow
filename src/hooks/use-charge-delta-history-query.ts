"use client";

import { useQuery } from "@tanstack/react-query";

import { createClient } from "@/lib/supabase/client";
import { devFetch, isDevAppRoute } from "@/lib/dev/dev-fetch";
import { queryKeys } from "@/lib/query-keys";
import { mapChargingSession } from "@/lib/db-map";
import type { ChargingSessionRow } from "@/types/database";

/**
 * Deliberately NOT served by `useSessionsQuery`: that list is polled at up to 1Hz
 * during the balance tail, so the delta trend would re-fetch hundreds of times per
 * charge for a chart that only changes when a session closes. This query is its own
 * observer — few columns, no polling.
 */
const DELTA_COLUMNS =
  "id,user_id,car_id,current_percent,end_max_cell_delta_v,end_delta_soc,started_at,stopped_at,status,created_at,updated_at" as const;

const MAX_SESSIONS = 300;

async function fetchChargeDeltaHistory(): Promise<ChargingSessionRow[]> {
  if (isDevAppRoute()) {
    const response = await devFetch("/api/vehicle/sessions");
    if (!response.ok) return [];
    const payload = (await response.json()) as { sessions?: ChargingSessionRow[] };
    return payload.sessions ?? [];
  }

  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) throw new Error("Unauthorized");

  const { data, error } = await supabase
    .from("charging_sessions")
    .select(DELTA_COLUMNS)
    .eq("user_id", user.id)
    .not("end_max_cell_delta_v", "is", null)
    .order("started_at", { ascending: false })
    .limit(MAX_SESSIONS);

  if (error) throw error;

  return (data ?? []).map((row) => mapChargingSession(row as Record<string, unknown>));
}

export function useChargeDeltaHistoryQuery() {
  return useQuery({
    queryKey: queryKeys.chargeDeltaHistory,
    queryFn: fetchChargeDeltaHistory,
    staleTime: 60_000,
  });
}
