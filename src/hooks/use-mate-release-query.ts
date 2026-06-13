"use client";

import { useQuery } from "@tanstack/react-query";

import { createClient } from "@/lib/supabase/client";
import { queryKeys } from "@/lib/query-keys";
import type { MateAppReleaseRow } from "@/types/database";

async function fetchLatestMateRelease(): Promise<MateAppReleaseRow | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("mate_app_releases")
    .select("*")
    .order("version_code", { ascending: false, nullsFirst: false })
    .order("published_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  return ((data ?? [])[0] as MateAppReleaseRow | undefined) ?? null;
}

/**
 * Latest published VoltFlow Mate APK release. Used to detect when the build
 * running on the car (live snapshot mate_version) is out of date. Refreshes
 * rarely — releases change at most a few times a day.
 */
export function useMateReleaseQuery() {
  return useQuery({
    queryKey: queryKeys.mateLatestRelease,
    queryFn: fetchLatestMateRelease,
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
