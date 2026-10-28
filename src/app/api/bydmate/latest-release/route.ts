import { after, NextResponse } from "next/server";

import {
  fetchLatestMateReleaseFromGithub,
  MateReleaseError,
  syncMateReleaseCatalog,
} from "@/lib/mate-latest-release";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const RELEASE_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
};

export async function GET() {
  try {
    const release = await fetchLatestMateReleaseFromGithub();
    after(() => syncMateReleaseCatalog(getSupabaseAdmin(), release));
    return NextResponse.json(release, { headers: RELEASE_CACHE_HEADERS });
  } catch (error) {
    if (error instanceof MateReleaseError) {
      return NextResponse.json(
        error.status != null
          ? { error: error.message, status: error.status }
          : { error: error.message },
        { status: 502, headers: RELEASE_CACHE_HEADERS },
      );
    }
    console.error("Latest BYDMate release API error:", error);
    return NextResponse.json(
      { error: "Could not fetch latest release from GitHub." },
      { status: 502, headers: RELEASE_CACHE_HEADERS },
    );
  }
}
