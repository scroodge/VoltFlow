import { NextResponse } from "next/server";

export const runtime = "nodejs";

const GITHUB_LATEST_RELEASE_URL =
  "https://api.github.com/repos/scroodge/BYDMate-own/releases/latest";
const RELEASE_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
};

type GithubReleasePayload = {
  tag_name?: unknown;
  html_url?: unknown;
  body?: unknown;
  published_at?: unknown;
  created_at?: unknown;
};

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

export async function GET() {
  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
    };
    const token = process.env.GITHUB_TOKEN?.trim();
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(GITHUB_LATEST_RELEASE_URL, {
      headers,
      next: { revalidate: 300 },
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          error: "Could not fetch latest release from GitHub.",
          status: response.status,
        },
        { status: 502, headers: RELEASE_CACHE_HEADERS },
      );
    }

    const payload = (await response.json()) as GithubReleasePayload;
    const tag = typeof payload.tag_name === "string" ? payload.tag_name : "";
    const version = normalizeVersionFromTag(tag);

    if (!version) {
      return NextResponse.json(
        { error: "Latest GitHub release tag has invalid version format." },
        { status: 502, headers: RELEASE_CACHE_HEADERS },
      );
    }

    const releaseNotes = typeof payload.body === "string" ? payload.body : null;
    const publishedAt =
      typeof payload.published_at === "string"
        ? payload.published_at
        : typeof payload.created_at === "string"
          ? payload.created_at
          : new Date().toISOString();
    const apkUrl = typeof payload.html_url === "string" ? payload.html_url : null;

    return NextResponse.json(
      {
        id: `github-release-${version}`,
        version,
        version_code: parseVersionCode(releaseNotes),
        apk_url: apkUrl,
        release_notes: releaseNotes,
        published_at: publishedAt,
        created_at: publishedAt,
        source: "github",
      },
      { headers: RELEASE_CACHE_HEADERS },
    );
  } catch (error) {
    console.error("Latest BYDMate release API error:", error);
    return NextResponse.json(
      { error: "Could not fetch latest release from GitHub." },
      { status: 502, headers: RELEASE_CACHE_HEADERS },
    );
  }
}
