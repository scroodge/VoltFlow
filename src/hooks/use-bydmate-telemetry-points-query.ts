"use client";

import { useQuery } from "@tanstack/react-query";

import { createClient } from "@/lib/supabase/client";
import { queryKeys } from "@/lib/query-keys";
import type { BydmateTelemetryPointRow } from "@/types/database";

async function fetchBydmateTelemetryPoints(): Promise<BydmateTelemetryPointRow[]> {
  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) throw new Error("Unauthorized");

  const { data, error } = await supabase
    .from("bydmate_telemetry_points")
    .select("*")
    .eq("user_id", user.id)
    .order("received_at", { ascending: false })
    .limit(240);

  if (error) throw error;

  return ((data ?? []) as BydmateTelemetryPointRow[]).reverse();
}

export function useBydmateTelemetryPointsQuery() {
  return useQuery({
    queryKey: queryKeys.bydmateTelemetryPoints,
    queryFn: fetchBydmateTelemetryPoints,
    refetchInterval: 15000,
  });
}
