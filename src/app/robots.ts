import type { MetadataRoute } from "next";

import { siteOrigin, siteUrl } from "@/lib/site-url";

/**
 * Emitted at `/robots.txt`.
 *
 * `src/proxy.ts` must keep excluding `robots.txt` from its matcher — otherwise
 * this route 307s to `/login` and the site cannot be crawled at all, which was
 * the state of production before 2026-08-19.
 *
 * Disallow only stops crawling; it does NOT deindex a URL that is linked from
 * elsewhere. The auth, search and admin routes also carry `robots: noindex`
 * metadata for that reason.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/admin",
          "/dev/",
          "/auth/",
          "/login",
          "/forgot-password",
          "/reset-password",
          "/onboarding",
          // Authenticated app surfaces: nothing here is useful in an index.
          "/dashboard",
          "/settings",
          "/vehicle",
          "/cars",
          "/charging",
          "/history",
          "/service",
          // Search results pages are classic index bloat.
          "/knowledge/search",
          "/telegram/service-preview",
        ],
      },
    ],
    sitemap: siteUrl("/sitemap.xml"),
    host: siteOrigin(),
  };
}
