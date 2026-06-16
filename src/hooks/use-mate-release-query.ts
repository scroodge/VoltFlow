"use client";

import { useQuery } from "@tanstack/react-query";

import { createClient } from "@/lib/supabase/client";
import { queryKeys } from "@/lib/query-keys";
import type { MateAppReleaseRow } from "@/types/database";

async function fetchLatestMateReleaseFromSupabase(): Promise<MateAppReleaseRow | null> {
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

async function fetchLatestMateReleaseFromGithub(): Promise<MateAppReleaseRow | null> {
  const response = await fetch("/api/bydmate/latest-release", {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`GitHub release fetch failed: ${response.status}`);

  const payload = (await response.json()) as Partial<MateAppReleaseRow>;
  if (!payload?.version || typeof payload.version !== "string") {
    throw new Error("GitHub release response missing version.");
  }

  return {
    id: payload.id ?? `github-release-${payload.version}`,
    version: payload.version,
    version_code:
      typeof payload.version_code === "number" ? payload.version_code : null,
    apk_url: typeof payload.apk_url === "string" ? payload.apk_url : null,
    release_notes:
      typeof payload.release_notes === "string" ? payload.release_notes : null,
    published_at:
      typeof payload.published_at === "string"
        ? payload.published_at
        : new Date().toISOString(),
    created_at:
      typeof payload.created_at === "string"
        ? payload.created_at
        : new Date().toISOString(),
  };
}

async function fetchLatestMateRelease(): Promise<MateAppReleaseRow | null> {
  try {
    return await fetchLatestMateReleaseFromGithub();
  } catch {
    // Fallback keeps current behavior when GitHub API is unavailable/rate-limited.
    return fetchLatestMateReleaseFromSupabase();
  }
}

/**
 * Latest published VoltFlow Mate APK release. Used to detect when the build
 * running on the car (live snapshot mate_version) is out of date. Refreshes
 * from GitHub releases first, with Supabase catalog as fallback.
 */
export function useMateReleaseQuery() {
  return useQuery({
    queryKey: queryKeys.mateLatestRelease,
    queryFn: fetchLatestMateRelease,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}
