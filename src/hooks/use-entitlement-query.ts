"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-keys";

async function fetchEntitlement(): Promise<{ isPremium: boolean }> {
  const response = await fetch("/api/account/entitlement", { credentials: "include" });
  if (!response.ok) throw new Error("Unauthorized");
  const payload = (await response.json()) as { ok?: boolean; isPremium?: boolean };
  return { isPremium: payload.isPremium === true };
}

/** Server-verified Premium status -- see AUD-02 (BACKLOG.md) for why this is never read
 * from a client-held profiles row instead. */
export function useEntitlementQuery() {
  return useQuery({
    queryKey: queryKeys.accountEntitlement,
    queryFn: fetchEntitlement,
    staleTime: 5 * 60_000,
  });
}
