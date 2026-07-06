"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { isDevAppRoute } from "@/lib/dev/dev-fetch";
import { createClient } from "@/lib/supabase/client";
import { mapProviderTariff } from "@/lib/db-map";
import { providerTariffsFromRows, type ProviderTariffOverrides } from "@/lib/charging-tariffs";
import { queryKeys } from "@/lib/query-keys";
import type { ProviderTariffRow } from "@/types/database";

async function fetchProviderTariffs(): Promise<ProviderTariffRow[]> {
  if (isDevAppRoute()) return [];
  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return [];

  const { data, error } = await supabase
    .from("provider_tariffs")
    .select("*")
    .eq("user_id", user.id);
  if (error) throw error;

  return (data ?? []).map((row) => mapProviderTariff(row as Record<string, unknown>));
}

export function useProviderTariffsQuery() {
  return useQuery({
    queryKey: queryKeys.providerTariffs,
    queryFn: fetchProviderTariffs,
  });
}

/** Convenience: the raw rows collapsed into the `{provider: {home, commercial_ac,
 * fast_dc}}` shape resolveTariffPrice/resolveSessionTariff expect. */
export function useProviderTariffOverrides(): ProviderTariffOverrides {
  const { data } = useProviderTariffsQuery();
  return useMemo(() => providerTariffsFromRows(data ?? []), [data]);
}
