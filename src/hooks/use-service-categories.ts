"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  deleteUserServiceCategory,
  insertUserServiceCategory,
  listUserServiceCategories,
} from "@/actions/service-categories";
import { useTranslation } from "@/hooks/use-translation";
import { queryKeys } from "@/lib/query-keys";
import type { UserServiceCategory } from "@/types/service";

async function fetchCategories(): Promise<UserServiceCategory[]> {
  const result = await listUserServiceCategories();
  if (!result.ok) throw new Error(result.error);
  return result.categories;
}

export function useUserServiceCategoriesQuery() {
  return useQuery({
    queryKey: queryKeys.userServiceCategories(),
    queryFn: fetchCategories,
  });
}

export function useInsertUserServiceCategoryMutation() {
  const qc = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: async (name: string) => {
      const result = await insertUserServiceCategory({ name });
      if (!result.ok) throw new Error(result.error);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.userServiceCategories() });
      toast.success(t("service.categoryAdded") as string);
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}

export function useDeleteUserServiceCategoryMutation() {
  const qc = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: async (id: string) => {
      const result = await deleteUserServiceCategory(id);
      if (!result.ok) throw new Error(result.error);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.userServiceCategories() });
      toast.success(t("service.categoryDeleted") as string);
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}
