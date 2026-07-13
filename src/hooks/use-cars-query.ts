"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { createCar, updateCar } from "@/actions/cars";
import { isCarGeneration } from "@/lib/car-generations";
import {
  DEFAULT_AC_EFFICIENCY_PERCENT,
  DEFAULT_FAST_DC_EFFICIENCY_PERCENT,
} from "@/lib/charging-efficiency";
import { devFetch, isDevAppRoute } from "@/lib/dev/dev-fetch";
import { createClient } from "@/lib/supabase/client";
import { mapCar } from "@/lib/db-map";
import { parseDecimalInput } from "@/lib/number-input";
import { queryKeys } from "@/lib/query-keys";
import { useTranslation } from "@/hooks/use-translation";
import type { Car } from "@/types/database";

export type CarsQueryResult = {
  cars: Car[];
  preferredCarId: string | null;
};

async function fetchCars(): Promise<CarsQueryResult> {
  if (isDevAppRoute()) {
    const response = await devFetch("/api/vehicle/cars");
    if (!response.ok) throw new Error("Unauthorized");
    const payload = (await response.json()) as {
      cars?: Car[];
      preferredCarId?: string | null;
    };
    return {
      cars: payload.cars ?? [],
      preferredCarId: payload.preferredCarId ?? null,
    };
  }

  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) throw new Error("Unauthorized");

  const { data, error } = await supabase
    .from("cars")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return {
    cars: (data ?? []).map((r) => mapCar(r as Record<string, unknown>)),
    preferredCarId: null,
  };
}

export function useCarsQuery() {
  return useQuery({
    queryKey: queryKeys.cars,
    queryFn: fetchCars,
  });
}

export function useCreateCarMutation() {
  const qc = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: async (vals: FormData) => {
      const result = await createCar(vals);
      if (!result.ok) {
        throw new Error(typeof result.error === "string" ? result.error : "Could not save");
      }
      return result.carId;
    },
    onMutate: async (formData) => {
      await qc.cancelQueries({ queryKey: queryKeys.cars });
      const previous = qc.getQueryData<CarsQueryResult>(queryKeys.cars);

      const generationRaw = formData.get("model_generation");
      const optimistic: Car = {
        id: crypto.randomUUID(),
        user_id: "local",
        name: String(formData.get("name") ?? "Vehicle"),
        model_generation: isCarGeneration(generationRaw) ? generationRaw : "gen1_2024",
        battery_capacity_kwh: parseDecimalInput(String(formData.get("battery_capacity_kwh") ?? "")) || 75,
        default_charger_power_kw: parseDecimalInput(String(formData.get("default_charger_power_kw") ?? "")) || 4.4,
        default_efficiency_percent:
          Number(formData.get("default_efficiency_percent")) || DEFAULT_AC_EFFICIENCY_PERCENT,
        fast_dc_efficiency_percent:
          Number(formData.get("fast_dc_efficiency_percent")) || DEFAULT_FAST_DC_EFFICIENCY_PERCENT,
        created_at: new Date().toISOString(),
      };

      qc.setQueryData<CarsQueryResult>(queryKeys.cars, (old) => ({
        cars: [optimistic, ...(old?.cars ?? [])],
        preferredCarId: old?.preferredCarId ?? null,
      }));

      return { previous, tempId: optimistic.id };
    },
    onError: (err: Error, _form, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKeys.cars, ctx.previous);
      toast.error(err.message);
    },
    onSuccess: () => {
      toast.success(t("cars.saved") as string);
    },
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: queryKeys.cars });
    },
  });
}

export function useUpdateCarMutation(carId: string) {
  const qc = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: async (vals: FormData) => {
      const result = await updateCar(carId, vals);
      if (!result.ok) {
        throw new Error(typeof result.error === "string" ? result.error : "Could not save");
      }
    },
    onMutate: async (formData) => {
      await qc.cancelQueries({ queryKey: queryKeys.cars });
      const previous = qc.getQueryData<CarsQueryResult>(queryKeys.cars);
      const generationRaw = formData.get("model_generation");

      qc.setQueryData<CarsQueryResult>(queryKeys.cars, (old) => ({
        cars: (old?.cars ?? []).map((car) =>
          car.id === carId
            ? {
                ...car,
                name: String(formData.get("name") ?? car.name),
                model_generation: isCarGeneration(generationRaw)
                  ? generationRaw
                  : car.model_generation,
                battery_capacity_kwh:
                  parseDecimalInput(String(formData.get("battery_capacity_kwh") ?? "")) ||
                  car.battery_capacity_kwh,
                default_charger_power_kw:
                  parseDecimalInput(String(formData.get("default_charger_power_kw") ?? "")) ||
                  car.default_charger_power_kw,
                default_efficiency_percent:
                  Number(formData.get("default_efficiency_percent")) ||
                  car.default_efficiency_percent,
                fast_dc_efficiency_percent:
                  Number(formData.get("fast_dc_efficiency_percent")) ||
                  car.fast_dc_efficiency_percent,
              }
            : car,
        ),
        preferredCarId: old?.preferredCarId ?? null,
      }));

      return { previous };
    },
    onError: (err: Error, _form, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKeys.cars, ctx.previous);
      toast.error(err.message);
    },
    onSuccess: () => {
      toast.success(t("cars.updated") as string);
    },
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: queryKeys.cars });
    },
  });
}
