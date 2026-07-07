"use client";

import { useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { isDevAppRoute } from "@/lib/dev/dev-fetch";
import { createClient } from "@/lib/supabase/client";
import { mapUserProvider } from "@/lib/db-map";
import {
  defaultUserProviderSeeds,
  userProvidersFromRows,
  type UserProviderMap,
} from "@/lib/charging-tariffs";
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

/**
 * Providers are user-owned rows, not app-wide hardcoded constants — every user's
 * `user_providers` table needs the 6 defaults (Home + 5 built-in providers)
 * seeded once before any selector has something to show. Existing users get
 * this via a one-time migration backfill; this covers new users, mounted
 * globally (MobileShell) so it fires regardless of which page they open first.
 */
export function useSeedDefaultUserProviders() {
  const qc = useQueryClient();
  const { data, isLoading } = useUserProvidersQuery();
  const seededRef = useRef(false);

  useEffect(() => {
    if (isDevAppRoute()) return;
    if (isLoading || data === undefined) return;
    if (data.length > 0 || seededRef.current) return;
    seededRef.current = true;

    void (async () => {
      const supabase = createClient();
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user) {
        seededRef.current = false;
        return;
      }
      const seeds = defaultUserProviderSeeds().map((seed) => ({
        ...seed,
        user_id: user.id,
      }));
      const { error } = await supabase.from("user_providers").insert(seeds);
      if (error) {
        seededRef.current = false;
        return;
      }
      void qc.invalidateQueries({ queryKey: queryKeys.userProviders });
    })();
  }, [data, isLoading, qc]);
}
