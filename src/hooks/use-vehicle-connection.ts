"use client";

import { useQuery } from "@tanstack/react-query";

import { createClient } from "@/lib/supabase/client";

export type VehicleConnection = {
  /** Whether a signed-in user could be resolved at all. */
  authenticated: boolean;
  /** True once the car's APK has ever streamed telemetry for this user. */
  connected: boolean;
};

const VEHICLE_CONNECTION_KEY = ["vehicle-connection"] as const;

async function fetchVehicleConnection(): Promise<VehicleConnection> {
  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return { authenticated: false, connected: false };

  const { data, error } = await supabase
    .from("profiles")
    .select("vehicle_connected_at")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw error;
  return { authenticated: true, connected: Boolean(data?.vehicle_connected_at) };
}

/**
 * Resolves whether the user's car APK has ever sent telemetry. Drives the
 * onboarding gate + the "connect your car" nudge banner. Polls every 5s while
 * not yet connected (so the "waiting for car" step auto-advances), then stops.
 * Cheap: a single one-row profile read; self-hosted Supabase egress is unmetered.
 */
export function useVehicleConnection() {
  return useQuery({
    queryKey: VEHICLE_CONNECTION_KEY,
    queryFn: fetchVehicleConnection,
    staleTime: 30_000,
    refetchInterval: (query) =>
      query.state.data?.connected ? false : 5_000,
  });
}
