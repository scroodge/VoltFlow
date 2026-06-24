"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  deleteServiceRecord,
  insertServiceRecord,
  updateServiceRecord,
} from "@/actions/service-records";
import { createClient } from "@/lib/supabase/client";
import { queryKeys } from "@/lib/query-keys";
import { useTranslation } from "@/hooks/use-translation";
import type { ServiceRecordRow } from "@/types/service";

async function fetchServiceRecords(carId: string): Promise<ServiceRecordRow[]> {
  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) throw new Error("Unauthorized");

  const { data, error } = await supabase
    .from("vehicle_service_records")
    .select("*")
    .eq("user_id", user.id)
    .eq("car_id", carId)
    .order("performed_date", { ascending: false });

  if (error) throw error;

  return (data ?? []).map((r) => ({
    ...r,
    photo_urls: typeof r.photo_urls === "string" ? JSON.parse(r.photo_urls) : (r.photo_urls ?? []),
  })) as ServiceRecordRow[];
}

export function useServiceRecordsQuery(carId: string | null) {
  return useQuery({
    queryKey: queryKeys.serviceRecords(carId ?? "_none"),
    queryFn: () => fetchServiceRecords(carId!),
    enabled: !!carId,
  });
}

type InsertInput = {
  carId: string;
  title: string;
  category: string;
  serviceType: string;
  performedDate: string;
  odometerKm?: number | null;
  vendorName?: string | null;
  vendorLocation?: string | null;
  partsCost: number;
  laborCost: number;
  totalCost: number;
  currency: string;
  notes?: string | null;
  nextDueDate?: string | null;
  nextDueKm?: number | null;
};

export function useInsertServiceRecordMutation() {
  const qc = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: async (input: InsertInput) => {
      const result = await insertServiceRecord(input);
      if (!result.ok) throw new Error(typeof result.error === "string" ? result.error : "Could not save");
      return result.id;
    },
    onSuccess: (_id, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.serviceRecords(vars.carId) });
      toast.success(t("service.recordSaved") as string);
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}

type UpdateInput = Partial<InsertInput> & { id: string };

export function useUpdateServiceRecordMutation() {
  const qc = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: async (input: UpdateInput) => {
      const result = await updateServiceRecord(input as Parameters<typeof updateServiceRecord>[0]);
      if (!result.ok) throw new Error(typeof result.error === "string" ? result.error : "Could not update");
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.serviceRecords("") });
      toast.success(t("service.recordUpdated") as string);
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}

export function useDeleteServiceRecordMutation() {
  const qc = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: async (input: { id: string; carId: string }) => {
      const result = await deleteServiceRecord(input.id);
      if (!result.ok) throw new Error(typeof result.error === "string" ? result.error : "Could not delete");
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.serviceRecords(vars.carId) });
      toast.success(t("service.recordDeleted") as string);
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}
