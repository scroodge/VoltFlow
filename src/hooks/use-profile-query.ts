"use client";

import { useQuery } from "@tanstack/react-query";

import { mapProfile } from "@/lib/db-map";
import { devFetch, isDevAppRoute } from "@/lib/dev/dev-fetch";
import { queryKeys } from "@/lib/query-keys";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/types/database";

async function fetchProfile(): Promise<Profile | null> {
  if (isDevAppRoute()) {
    const response = await devFetch("/api/vehicle/profile");
    if (!response.ok) throw new Error("Unauthorized");
    const payload = (await response.json()) as { profile?: Profile | null };
    return payload.profile ?? null;
  }

  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw error;

  return data ? mapProfile(data as Record<string, unknown>) : null;
}

export function useProfileQuery() {
  return useQuery({
    queryKey: queryKeys.profile,
    queryFn: fetchProfile,
    staleTime: 30_000,
  });
}
