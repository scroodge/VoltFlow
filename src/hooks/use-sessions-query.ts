"use client";

import { useQuery } from "@tanstack/react-query";

import { createClient } from "@/lib/supabase/client";
import { devFetch, isDevAppRoute } from "@/lib/dev/dev-fetch";
import { mapChargingSession } from "@/lib/db-map";
import { queryKeys } from "@/lib/query-keys";
import type { ChargingSessionRow } from "@/types/database";

/**
 * Only the columns `mapChargingSession` actually reads. The list is polled at up
 * to 1Hz during the balance tail (see chargingSessionsRefetchInterval), so every
 * unused column is wasted egress on every poll — `select("*")` also pulled the
 * three home/commercial/fast_dc price columns this mapper never touches.
 */
const SESSION_COLUMNS =
  "id,user_id,car_id,start_percent,current_percent,target_percent,battery_capacity_kwh,charger_power_kw,efficiency_percent,tariff_type,provider_type,tariff_manual,price_per_kwh,charged_energy_kwh,estimated_cost,status,started_at,stopped_at,created_at,updated_at" as const;

export async function fetchSessions(): Promise<ChargingSessionRow[]> {
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
    .select(SESSION_COLUMNS)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw error;

  return (data ?? []).map((r) =>
    mapChargingSession(r as Record<string, unknown>),
  );
}

/**
 * Shared refetch cadence for ANY observer of the `queryKeys.sessions` list.
 *
 * TanStack Query refetches a shared query at the SHORTEST refetchInterval among
 * its currently-mounted observers. So every component that polls this list
 * (MobileShell background sync, dashboard, charging hub) MUST use this one
 * function — otherwise the most aggressive copy silently overrides the others.
 * (That divergence is exactly how a 1s dashboard poll defeated the tiering.)
 *
 * Tiered by SOC to control Supabase egress — the list is select("*") limit(100)
 * hit directly from the client per charging user:
 *   not visible / not charging → no poll
 *   <95%  → 60s (long flat phase, hours)
 *   95–98% → 5s (approaching the tail; ensures the 98% switch fires within ~5s)
 *   ≥98%  → 1s (balance tail: fine resolution to catch the exact completion/stop)
 * Live SOC stays fresh independently via the bydmate-live Realtime channel.
 */
export function chargingSessionsRefetchInterval(
  list: ChargingSessionRow[] | undefined,
  pageVisible: boolean,
): number | false {
  if (!pageVisible) return false;
  const charging = list?.filter((s) => s.status === "charging") ?? [];
  if (charging.length === 0) return false;
  const maxPercent = Math.max(...charging.map((s) => s.current_percent));
  if (maxPercent >= 98) return 1000;
  if (maxPercent >= 95) return 5000;
  return 60000;
}

export function useSessionsQuery() {
  return useQuery({
    queryKey: queryKeys.sessions,
    queryFn: fetchSessions,
  });
}
