"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { applySuggestedEfficiency } from "@/actions/cars";
import {
  suggestEfficiency,
  tariffTypesForEfficiencyGroup,
  type ChargingEfficiencySuggestion,
} from "@/lib/charging-efficiency-learning";
import { createClient } from "@/lib/supabase/client";
import { queryKeys } from "@/lib/query-keys";
import { useTranslation } from "@/hooks/use-translation";
import type { Car } from "@/types/database";

export type CarEfficiencySuggestions = {
  ac: ChargingEfficiencySuggestion | null;
  fastDc: ChargingEfficiencySuggestion | null;
};

async function fetchSuggestions(car: Car): Promise<CarEfficiencySuggestions> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("charging_efficiency_observations")
    .select("tariff_type, measured_efficiency_percent, avg_battery_temp_c, avg_outside_temp_c, computed_at")
    .eq("car_id", car.id)
    .order("computed_at", { ascending: false });
  if (error) throw error;

  const rows = (data ?? []) as Array<{
    tariff_type: string;
    measured_efficiency_percent: number;
    avg_battery_temp_c: number | null;
    avg_outside_temp_c: number | null;
    computed_at: string;
  }>;

  const forGroup = (group: "ac" | "fast_dc") => {
    const types = tariffTypesForEfficiencyGroup(group);
    const observations = rows
      .filter((row) => types.includes(row.tariff_type as (typeof types)[number]))
      .map((row) => ({
        measuredEfficiencyPercent: row.measured_efficiency_percent,
        avgBatteryTempC: row.avg_battery_temp_c,
        avgOutsideTempC: row.avg_outside_temp_c,
        computedAt: row.computed_at,
      }));
    const currentPercent =
      group === "fast_dc" ? car.fast_dc_efficiency_percent : car.default_efficiency_percent;
    return suggestEfficiency(observations, currentPercent);
  };

  return { ac: forGroup("ac"), fastDc: forGroup("fast_dc") };
}

export function useCarEfficiencySuggestions(car: Car | undefined) {
  return useQuery({
    queryKey: queryKeys.chargingEfficiencySuggestions(car?.id ?? ""),
    queryFn: () => fetchSuggestions(car!),
    enabled: !!car,
  });
}

export function useApplySuggestedEfficiencyMutation(carId: string) {
  const qc = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: async ({ group, percent }: { group: "ac" | "fast_dc"; percent: number }) => {
      const result = await applySuggestedEfficiency({ carId, group, percent });
      if (!result.ok) throw new Error(result.error);
    },
    onSuccess: () => {
      toast.success(t("cars.efficiencyApplied") as string);
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: queryKeys.cars });
      await qc.invalidateQueries({ queryKey: queryKeys.chargingEfficiencySuggestions(carId) });
    },
  });
}
