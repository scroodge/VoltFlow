import type { SupabaseClient } from "@supabase/supabase-js";

// Server-side lookup of the latest published VoltFlow Mate APK. GitHub releases are the
// source of truth: the `mate_app_releases` catalog is only a fallback, because the publish
// script stopped keeping it current (2026-10-12: table top row 0.4.8, cars on 0.6.1).

const GITHUB_LATEST_RELEASE_URL =
  "https://api.github.com/repos/scroodge/BYDMate-own/releases/latest";

/** Next fetch-cache window for the GitHub call — about one request per 5 min. */
export const MATE_RELEASE_REVALIDATE_SECONDS = 300;

export type LatestMateRelease = {
  id: string;
  version: string;
  version_code: number | null;
  apk_url: string | null;
  release_notes: string | null;
  published_at: string;
  created_at: string;
  source: "github";
};

type GithubReleasePayload = {
  tag_name?: unknown;
  html_url?: unknown;
  body?: unknown;
  published_at?: unknown;
  created_at?: unknown;
};

export class MateReleaseError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "MateReleaseError";
  }
}

function normalizeVersionFromTag(tag: string): string | null {
  const normalized = tag.trim().replace(/^v/i, "");
  return /^\d+(?:\.\d+)*$/.test(normalized) ? normalized : null;
}

function parseVersionCode(body: string | null): number | null {
  if (!body) return null;
  const match = body.match(/versionCode\s+(\d+)/i);
  if (!match) return null;
  const parsed = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Latest GitHub release. Throws `MateReleaseError` on HTTP failure or a bad tag. */
export async function fetchLatestMateReleaseFromGithub(): Promise<LatestMateRelease> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(GITHUB_LATEST_RELEASE_URL, {
    headers,
    next: { revalidate: MATE_RELEASE_REVALIDATE_SECONDS },
  });
  if (!response.ok) {
    throw new MateReleaseError(
      "Could not fetch latest release from GitHub.",
      response.status,
    );
  }

  const payload = (await response.json()) as GithubReleasePayload;
  const tag = typeof payload.tag_name === "string" ? payload.tag_name : "";
  const version = normalizeVersionFromTag(tag);
  if (!version) {
    throw new MateReleaseError(
      "Latest GitHub release tag has invalid version format.",
    );
  }

  const releaseNotes = typeof payload.body === "string" ? payload.body : null;
  const publishedAt =
    typeof payload.published_at === "string"
      ? payload.published_at
      : typeof payload.created_at === "string"
        ? payload.created_at
        : new Date().toISOString();

  return {
    id: `github-release-${version}`,
    version,
    version_code: parseVersionCode(releaseNotes),
    apk_url: typeof payload.html_url === "string" ? payload.html_url : null,
    release_notes: releaseNotes,
    published_at: publishedAt,
    created_at: publishedAt,
    source: "github",
  };
}

async function loadLatestMateVersionFromCatalog(
  supabase: SupabaseClient,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("mate_app_releases")
    .select("version")
    .order("version_code", { ascending: false, nullsFirst: false })
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || typeof data?.version !== "string") return null;
  return data.version;
}

/**
 * Latest Mate version string: GitHub first, `mate_app_releases` on failure, `null` when
 * both fail. Never throws — callers must treat `null` as "unknown", not "up to date".
 */
export async function resolveLatestMateVersion(
  supabase: SupabaseClient,
): Promise<string | null> {
  try {
    return (await fetchLatestMateReleaseFromGithub()).version;
  } catch (error) {
    console.error("Latest Mate release (GitHub) failed:", error);
    return loadLatestMateVersionFromCatalog(supabase).catch(() => null);
  }
}
