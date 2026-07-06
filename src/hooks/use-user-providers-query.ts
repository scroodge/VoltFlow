"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { isDevAppRoute } from "@/lib/dev/dev-fetch";
import { createClient } from "@/lib/supabase/client";
import { mapUserProvider } from "@/lib/db-map";
import { userProvidersFromRows, type UserProviderMap } from "@/lib/charging-tariffs";
import { queryKeys } from "@/lib/query-keys";
import type { UserProviderRow } from "@/types/database";

async function fetchUserProviders(): Promise<UserProviderRow[]> {
  if (isDevAppRoute()) return [];
  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return [];

  const { data, error } = await supabase
    .from("user_providers")
    .select("*")
    .eq("user_id", user.id);
  if (error) throw error;

  return (data ?? []).map((row) => mapUserProvider(row as Record<string, unknown>));
}

export function useUserProvidersQuery() {
  return useQuery({
    queryKey: ["user-providers"] as const,
    queryFn: fetchUserProviders,
  });
}

export function useUserProviderMap(): UserProviderMap {
  const { data } = useUserProvidersQuery();
  return useMemo(() => userProvidersFromRows(data ?? []), [data]);
}
