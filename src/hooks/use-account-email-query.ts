"use client";

import { useQuery } from "@tanstack/react-query";

import { devFetch, isDevAppRoute } from "@/lib/dev/dev-fetch";
import { queryKeys } from "@/lib/query-keys";
import { createClient } from "@/lib/supabase/client";

// The Auth email is authoritative; `profiles.email` is client-writable and can diverge.
async function fetchAccountEmail(): Promise<string | null> {
  if (isDevAppRoute()) {
    const response = await devFetch("/api/vehicle/profile");
    if (!response.ok) return null;
    const payload = (await response.json()) as { email?: string | null };
    return payload.email ?? null;
  }

  const { data } = await createClient().auth.getUser();
  return data.user?.email ?? null;
}

export function useAccountEmailQuery() {
  return useQuery({
    queryKey: queryKeys.accountEmail,
    queryFn: fetchAccountEmail,
    staleTime: 60_000,
  });
}
