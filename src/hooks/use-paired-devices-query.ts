"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-keys";

export type PairedDeviceKind = "mate" | "dashboard";

export type PairedDevice = {
  kind: PairedDeviceKind;
  app_version: string | null;
  version_code: number | null;
  app_version_seen_at: string | null;
  api_key_fingerprint: string | null;
  created_at: string;
};

async function fetchPairedDevices(): Promise<PairedDevice[]> {
  const response = await fetch("/api/bydmate/devices", {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "include",
  });

  const payload = (await response.json()) as {
    ok?: boolean;
    devices?: PairedDevice[];
    error?: string;
  };

  if (!response.ok || !payload.ok) {
    throw new Error(payload.error ?? `Paired device fetch failed: ${response.status}`);
  }

  return payload.devices ?? [];
}

/**
 * Clients paired to this account — Mate and the Dashboard hold independent credentials,
 * so this can return either, both, or neither. Used by the settings cloud card to show
 * which head-unit build is linked.
 *
 * Pairing changes only when the user redeems a code in this same view, and a version
 * changes only when they update an APK on the car, so this stays cold on purpose.
 */
export function usePairedDevicesQuery() {
  return useQuery({
    queryKey: queryKeys.pairedDevices,
    queryFn: fetchPairedDevices,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
  });
}
