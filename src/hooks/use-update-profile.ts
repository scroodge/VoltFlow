"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-keys";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/types/database";

export type ProfilePatch = Partial<
  Pick<
    Profile,
    | "preferred_currency"
    | "preferred_locale"
    | "preferred_pressure_unit"
    | "default_price_per_kwh"
    | "home_price_per_kwh"
    | "commercial_ac_price_per_kwh"
    | "fast_dc_price_per_kwh"
    | "notify_channel"
    | "live_status_mode"
    | "aux_battery_alerts_enabled"
  >
>;

export type ProfileUpdateResult =
  { ok: true; persisted: boolean } | { ok: false; error: string };

/**
 * Optimistically patches the cached profile, writes the same columns to Postgres and
 * rolls back only the patched keys on failure. `persisted: false` means there was no
 * signed-in profile to write to, so the change stayed local.
 */
export function useUpdateProfile() {
  const qc = useQueryClient();

  return useCallback(
    async (patch: ProfilePatch): Promise<ProfileUpdateResult> => {
      const previous = qc.getQueryData<Profile | null>(queryKeys.profile);
      if (!previous) return { ok: true, persisted: false };

      const keys = Object.keys(patch) as (keyof ProfilePatch)[];
      qc.setQueryData<Profile | null>(queryKeys.profile, {
        ...previous,
        ...patch,
      });

      const { error } = await createClient()
        .from("profiles")
        .update(patch)
        .eq("id", previous.id);

      if (error) {
        const revert = Object.fromEntries(
          keys.map((key) => [key, previous[key]]),
        );
        qc.setQueryData<Profile | null>(queryKeys.profile, (current) =>
          current ? { ...current, ...revert } : current,
        );
        return { ok: false, error: error.message };
      }
      return { ok: true, persisted: true };
    },
    [qc],
  );
}
