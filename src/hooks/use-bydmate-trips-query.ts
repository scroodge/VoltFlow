"use client";

import { useEffect, useId, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { devFetch, isDevAppRoute } from "@/lib/dev/dev-fetch";
import { usePageVisible } from "@/hooks/use-page-visible";
import { attachTripEnergy } from "@/lib/bydmate/attach-trip-energy";
import { createClient } from "@/lib/supabase/client";
import { queryKeys } from "@/lib/query-keys";
import type { BydmateTripRow } from "@/types/database";

const TRIP_REFETCH_INTERVAL_MS = 60_000;
const TRIP_REALTIME_DEBOUNCE_MS = 5_000;

function localDateKeyFromIso(isoStr: string) {
  const d = new Date(isoStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function fetchBydmateTrips(date: string, vehicleId: string | null): Promise<BydmateTripRow[]> {
  if (isDevAppRoute()) {
    const response = await devFetch(`/api/vehicle/trips?${new URLSearchParams({ date })}`);
    if (!response.ok) throw new Error("Failed to load trips");
    const payload = (await response.json()) as { trips: BydmateTripRow[] };
    return payload.trips ?? [];
  }

  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) throw new Error("Unauthorized");

  const dayStart = `${date}T00:00:00.000Z`;
  const dayEnd = `${date}T23:59:59.999Z`;
  let query = supabase
    .from("bydmate_trips")
    .select("*")
    .lte("started_at", dayEnd)
    .or(`ended_at.is.null,ended_at.gte.${dayStart}`)
    .order("started_at", { ascending: false });

  if (vehicleId) query = query.eq("vehicle_id", vehicleId);

  const { data, error } = await query;
  if (error) throw error;

  return attachTripEnergy({
    supabase,
    userId: user.id,
    trips: (data ?? []) as BydmateTripRow[],
    vehicleId: vehicleId ?? undefined,
  });
}

async function fetchLatestBydmateTrips(
  vehicleId: string | null,
  limit: number,
  lite: boolean,
): Promise<BydmateTripRow[]> {
  if (isDevAppRoute()) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (vehicleId) params.set("vehicle_id", vehicleId);
    if (lite) params.set("lite", "1");
    const response = await devFetch(`/api/vehicle/trips?${params.toString()}`);
    if (!response.ok) throw new Error("Failed to load trips");
    const payload = (await response.json()) as { trips: BydmateTripRow[] };
    return payload.trips ?? [];
  }

  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) throw new Error("Unauthorized");

  let query = supabase
    .from("bydmate_trips")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(Math.min(limit * 2, 200));

  if (vehicleId) query = query.eq("vehicle_id", vehicleId);

  const { data, error } = await query;
  if (error) throw error;

  const trips = (data ?? []) as BydmateTripRow[];
  if (lite) return trips.slice(0, limit);

  return attachTripEnergy({
    supabase,
    userId: user.id,
    trips,
    vehicleId: vehicleId ?? undefined,
  }).then((rows) => rows.slice(0, limit));
}

async function fetchTripMonthDates(
  year: number,
  month: number,
  vehicleId: string | null,
): Promise<string[]> {
  const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
  let startedAt: string[];

  if (isDevAppRoute()) {
    const params = new URLSearchParams({ month: monthKey });
    if (vehicleId) params.set("vehicle_id", vehicleId);
    const response = await devFetch(`/api/vehicle/trips?${params.toString()}`);
    if (!response.ok) throw new Error("Failed to load trip dates");
    const payload = (await response.json()) as { startedAt?: string[] };
    startedAt = payload.startedAt ?? [];
  } else {
    const [yearText, monthText] = monthKey.split("-");
    const lastDay = new Date(Date.UTC(Number(yearText), Number(monthText), 0)).getUTCDate();
    let query = createClient()
      .from("bydmate_trips")
      .select("started_at")
      .gte("started_at", `${monthKey}-01T00:00:00.000Z`)
      .lte("started_at", `${monthKey}-${String(lastDay).padStart(2, "0")}T23:59:59.999Z`);

    if (vehicleId) query = query.eq("vehicle_id", vehicleId);

    const { data, error } = await query;
    if (error) throw error;
    startedAt = ((data ?? []) as Array<{ started_at: string }>).map((row) => row.started_at);
  }

  const dates = [
    ...new Set(startedAt.map((iso) => localDateKeyFromIso(iso))),
  ].sort();
  return dates;
}

function useBydmateTripRealtimeInvalidation() {
  const queryClient = useQueryClient();
  const supabase = useMemo(() => createClient(), []);
  const devRoute = isDevAppRoute();
  const mountId = useId();

  useEffect(() => {
    if (devRoute) return;

    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const invalidate = () => {
      if (debounceTimer) return;
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: ["bydmate-trips"] }),
          queryClient.invalidateQueries({ queryKey: ["bydmate-latest-trips"] }),
          queryClient.invalidateQueries({ queryKey: ["bydmate-trip-month-dates"] }),
        ]);
      }, TRIP_REALTIME_DEBOUNCE_MS);
    };

    void supabase.auth.getUser().then(({ data: userData }) => {
      if (cancelled || !userData.user) return;
      channel = supabase
        .channel(`bydmate-trips:${userData.user.id}:${mountId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "bydmate_trips",
            filter: `user_id=eq.${userData.user.id}`,
          },
          (payload) => {
            // Ingest updates an open trip on every telemetry batch. The live view
            // already owns that state; history needs the row when it starts or ends.
            if (payload.eventType === "UPDATE" && !payload.new.ended_at) return;
            invalidate();
          },
        )
        .subscribe();
    });

    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [devRoute, mountId, queryClient, supabase]);
}

export function useBydmateTripsQuery(
  date: string,
  vehicleId: string | null,
  enabled = true,
) {
  const pageVisible = usePageVisible();
  useBydmateTripRealtimeInvalidation();

  return useQuery({
    queryKey: queryKeys.bydmateTrips(date, vehicleId),
    queryFn: () => fetchBydmateTrips(date, vehicleId),
    enabled: enabled && Boolean(date) && pageVisible,
    refetchInterval: pageVisible ? TRIP_REFETCH_INTERVAL_MS : false,
  });
}

export function useLatestBydmateTripsQuery(
  vehicleId: string | null,
  limit = 1,
  enabled = true,
  lite = false,
) {
  const pageVisible = usePageVisible();
  useBydmateTripRealtimeInvalidation();

  return useQuery({
    queryKey: queryKeys.bydmateLatestTrips(vehicleId, limit, lite),
    queryFn: () => fetchLatestBydmateTrips(vehicleId, limit, lite),
    enabled: enabled && pageVisible,
    refetchInterval: pageVisible ? TRIP_REFETCH_INTERVAL_MS : false,
  });
}

export function useTripMonthDatesQuery(
  year: number,
  month: number,
  vehicleId: string | null,
  enabled = true,
) {
  const pageVisible = usePageVisible();
  useBydmateTripRealtimeInvalidation();

  return useQuery({
    queryKey: queryKeys.bydmateTripMonthDates(year, month, vehicleId),
    queryFn: () => fetchTripMonthDates(year, month, vehicleId),
    enabled: enabled && pageVisible,
    staleTime: 60_000,
  });
}
