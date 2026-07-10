"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { devFetch } from "@/lib/dev/dev-fetch";
import { queryKeys } from "@/lib/query-keys";
import type { VehicleCommandScheduleRow } from "@/types/database";

export type CommandScheduleInput = {
  type: string;
  params: Record<string, unknown>;
  run_time: string;
  days_of_week: number[];
  time_zone: string;
};

export function useVehicleCommandSchedulesQuery(vehicleId: string | null, enabled = true) {
  return useQuery({
    queryKey: [...queryKeys.vehicleCommands(vehicleId), "schedules"],
    enabled: enabled && Boolean(vehicleId),
    queryFn: async (): Promise<VehicleCommandScheduleRow[]> => {
      const response = await devFetch(`/api/vehicle/command-schedules?vehicle_id=${encodeURIComponent(vehicleId ?? "")}`);
      const payload = await response.json() as { ok?: boolean; schedules?: VehicleCommandScheduleRow[] };
      if (!response.ok || !payload.ok) throw new Error("Failed to load schedules");
      return payload.schedules ?? [];
    },
  });
}

export function useVehicleCommandSchedules(vehicleId: string | null) {
  const queryClient = useQueryClient();
  const queryKey = [...queryKeys.vehicleCommands(vehicleId), "schedules"];
  const invalidate = () => void queryClient.invalidateQueries({ queryKey });

  const create = useMutation({
    mutationFn: async (input: CommandScheduleInput) => {
      if (!vehicleId) throw new Error("No vehicle selected");
      const response = await devFetch("/api/vehicle/command-schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicle_id: vehicleId, ...input }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Failed to create schedule");
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const response = await devFetch(`/api/vehicle/command-schedules?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Failed to delete schedule");
    },
    onSuccess: invalidate,
  });

  return { create, remove };
}
