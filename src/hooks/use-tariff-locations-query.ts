"use client";

import { useQuery } from "@tanstack/react-query";

import { mapChargingTariffLocation } from "@/lib/db-map";
import { devFetch, isDevAppRoute } from "@/lib/dev/dev-fetch";
import { queryKeys } from "@/lib/query-keys";
import { createClient } from "@/lib/supabase/client";
import type { ChargingTariffLocationRow } from "@/types/database";

async function fetchTariffLocations(): Promise<ChargingTariffLocationRow[]> {
  if (isDevAppRoute()) {
    const response = await devFetch("/api/vehicle/profile");
    if (!response.ok) return [];
    const payload = (await response.json()) as {
      tariffLocations?: Record<string, unknown>[];
    };
    return (payload.tariffLocations ?? []).map((row) =>
      mapChargingTariffLocation(row),
    );
  }

  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return [];

  const { data, error } = await supabase
    .from("charging_tariff_locations")
    .select("*")
    .eq("user_id", user.id);
  if (error) throw error;

  return (data ?? []).map((row) =>
    mapChargingTariffLocation(row as Record<string, unknown>),
  );
}

export function useTariffLocationsQuery() {
  return useQuery({
    queryKey: queryKeys.tariffLocations,
    queryFn: fetchTariffLocations,
  });
}
