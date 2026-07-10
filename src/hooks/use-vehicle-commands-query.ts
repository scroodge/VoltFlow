"use client";

import { useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { devFetch, isDevAppRoute } from "@/lib/dev/dev-fetch";
import { usePageVisible } from "@/hooks/use-page-visible";
import { createClient } from "@/lib/supabase/client";
import { queryKeys } from "@/lib/query-keys";
import type { VehicleCommandRow } from "@/types/database";

async function fetchVehicleCommands(vehicleId: string | null): Promise<VehicleCommandRow[]> {
  const params = new URLSearchParams({ limit: "20" });
  if (vehicleId) params.set("vehicle_id", vehicleId);
  const response = await devFetch(`/api/vehicle/commands?${params.toString()}`);
  if (!response.ok) throw new Error("Failed to load commands");
  const payload = (await response.json()) as { commands?: VehicleCommandRow[] };
  return payload.commands ?? [];
}

export function useVehicleCommandsQuery(
  vehicleId: string | null,
  options?: { enabled?: boolean },
) {
  const queryClient = useQueryClient();
  const supabase = useMemo(() => createClient(), []);
  const devRoute = isDevAppRoute();
  const pageVisible = usePageVisible();
  const mountId = useRef(crypto.randomUUID()).current;

  const enabled = (options?.enabled ?? true) && Boolean(vehicleId) && pageVisible;

  useEffect(() => {
    if (!vehicleId || devRoute) return;

    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    void supabase.auth.getUser().then(({ data: userData }) => {
      if (cancelled) return;
      const user = userData.user;
      if (!user) return;

      channel = supabase
        .channel(`vehicle-commands:${user.id}:${vehicleId}:${mountId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "vehicle_commands",
            filter: `user_id=eq.${user.id}`,
          },
          () => {
            void queryClient.invalidateQueries({
              queryKey: queryKeys.vehicleCommands(vehicleId),
            });
          },
        )
        .subscribe();
    });

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [queryClient, supabase, vehicleId, devRoute]);

  return useQuery({
    queryKey: queryKeys.vehicleCommands(vehicleId),
    queryFn: () => fetchVehicleCommands(vehicleId),
    enabled,
    refetchInterval: enabled ? (devRoute ? 3_000 : 60_000) : false,
  });
}

export function useSendVehicleCommand(vehicleId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { type: string; params?: Record<string, unknown> }) => {
      if (!vehicleId) throw new Error("No vehicle selected");
      const response = await devFetch("/api/vehicle/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicle_id: vehicleId,
          type: input.type,
          params: input.params ?? {},
        }),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Command failed");
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.vehicleCommands(vehicleId) });
    },
  });
}
