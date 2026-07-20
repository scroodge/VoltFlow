"use client";

import { useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { requestLiveFastStatus } from "@/actions/live-status";
import { usePageVisible } from "@/hooks/use-page-visible";
import { backfillLiveSnapshotsWithSoh } from "@/lib/bydmate/live-soh-backfill";
import { devFetch, isDevAppRoute } from "@/lib/dev/dev-fetch";
import { createClient } from "@/lib/supabase/client";
import { queryKeys } from "@/lib/query-keys";
import type { BydmateLiveSnapshotRow } from "@/types/database";

/**
 * Coalesce a burst of ~1Hz ingest Realtime events into one heavy refetch.
 *
 * This is also the floor on how fast a status change can surface, so it has to stay well
 * under the 2-5s target the live view promises. A driving car still bursts at 1Hz, so the
 * debounce continues to earn its keep — it just no longer dominates the latency budget.
 */
const BYDMATE_LIVE_REFETCH_DEBOUNCE_MS = 1_000;

/**
 * How often to tell the car someone is watching. Comfortably inside the server's window
 * (`LIVE_FAST_WINDOW_SECONDS`) so an occasional dropped beat never interrupts fast mode,
 * while a closed tab lets it lapse within seconds.
 */
const LIVE_FAST_HEARTBEAT_MS = 8_000;

async function fetchBydmateLiveDev(): Promise<BydmateLiveSnapshotRow[]> {
  const response = await devFetch("/api/vehicle/live");
  if (!response.ok) throw new Error("Unauthorized");
  const payload = (await response.json()) as { snapshots?: BydmateLiveSnapshotRow[] };
  return payload.snapshots ?? [];
}

async function fetchBydmateLive(): Promise<BydmateLiveSnapshotRow[]> {
  if (isDevAppRoute()) {
    return fetchBydmateLiveDev();
  }

  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) throw new Error("Unauthorized");

  const { data, error } = await supabase
    .from("bydmate_live_snapshots")
    .select("*")
    .eq("user_id", user.id)
    .order("received_at", { ascending: false });

  if (error) throw error;

  return backfillLiveSnapshotsWithSoh(
    supabase,
    (data ?? []) as BydmateLiveSnapshotRow[],
    user.id,
  );
}

export function useBydmateLiveQuery() {
  const queryClient = useQueryClient();
  const supabase = useMemo(() => createClient(), []);
  const devRoute = isDevAppRoute();
  const pageVisible = usePageVisible();
  const mountId = useRef(crypto.randomUUID()).current;

  useEffect(() => {
    if (devRoute) return;

    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleInvalidate = () => {
      if (debounceTimer) return;
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void queryClient.invalidateQueries({ queryKey: queryKeys.bydmateLive });
      }, BYDMATE_LIVE_REFETCH_DEBOUNCE_MS);
    };

    void supabase.auth.getUser().then(({ data: userData }) => {
      if (cancelled) return;
      const user = userData.user;
      if (!user) return;

      channel = supabase
        .channel(`bydmate-live:${user.id}:${mountId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "bydmate_live_snapshots",
            filter: `user_id=eq.${user.id}`,
          },
          scheduleInvalidate,
        )
        .subscribe();
    });

    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [queryClient, supabase, devRoute]);

  const query = useQuery({
    queryKey: queryKeys.bydmateLive,
    queryFn: fetchBydmateLive,
    staleTime: 15_000,
    refetchInterval: pageVisible ? (devRoute ? 30_000 : 60_000) : false,
  });

  // Snapshots come back newest-received first, so the head is the car actually being
  // watched — the one worth speeding up on a multi-car account.
  const watchedVehicleId = query.data?.[0]?.vehicle_id ?? null;

  useEffect(() => {
    if (devRoute || !pageVisible) return;

    let cancelled = false;
    const beat = () => {
      if (cancelled) return;
      // Best-effort: a missed beat costs latency until the next one, never correctness.
      void requestLiveFastStatus(watchedVehicleId).catch(() => {});
    };

    beat();
    const timer = setInterval(beat, LIVE_FAST_HEARTBEAT_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [devRoute, pageVisible, watchedVehicleId]);

  return query;
}
