"use client";

import { useQuery } from "@tanstack/react-query";

import { createClient } from "@/lib/supabase/client";
import { devFetch, isDevAppRoute } from "@/lib/dev/dev-fetch";
import { queryKeys } from "@/lib/query-keys";
import type { ChargeDeltaSession } from "@/lib/bydmate/charge-delta-trend";
import type { ChargingSessionRow } from "@/types/database";

/**
 * Deliberately NOT served by `useSessionsQuery`: that list is polled at up to 1Hz
 * during the balance tail, so the delta trend would re-fetch hundreds of times per
 * charge for a chart that only changes when a session closes. This query is its own
 * observer — few columns, no polling.
 */
const DELTA_COLUMNS =
  "id,status,end_max_cell_delta_v,end_delta_soc,started_at,stopped_at" as const;

const MAX_SESSIONS = 300;

function toNumberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Postgres `numeric` arrives as a string over PostgREST; the trend needs numbers. */
function toChargeDeltaSession(raw: Record<string, unknown>): ChargeDeltaSession {
  return {
    id: String(raw.id),
    status: raw.status as ChargingSessionRow["status"],
    end_max_cell_delta_v: toNumberOrNull(raw.end_max_cell_delta_v),
    end_delta_soc: toNumberOrNull(raw.end_delta_soc),
    started_at: raw.started_at ? String(raw.started_at) : null,
    stopped_at: raw.stopped_at ? String(raw.stopped_at) : null,
  };
}

async function fetchChargeDeltaHistory(): Promise<ChargeDeltaSession[]> {
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

  return (data ?? []).map((row) => toChargeDeltaSession(row as Record<string, unknown>));
}

export function useChargeDeltaHistoryQuery() {
  return useQuery({
    queryKey: queryKeys.chargeDeltaHistory,
    queryFn: fetchChargeDeltaHistory,
    staleTime: 60_000,
  });
}
