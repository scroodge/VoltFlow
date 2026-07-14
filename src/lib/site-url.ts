/**
 * Canonical public origin. `voltflow.life` (apex) is the Vercel production domain;
 * `www.voltflow.life` and the legacy `volt-flow-beige.vercel.app` both 308 here.
 *
 * The legacy vercel.app host must keep resolving forever: installed BYDMate Mate
 * builds persist their telemetry endpoint and cannot be force-updated.
 */
export const DEFAULT_SITE_URL = "https://voltflow.life";

/** Canonical origin, no trailing slash. */
export function siteOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  return (configured || DEFAULT_SITE_URL).replace(/\/$/, "");
}

/** Absolute URL on the canonical origin. */
export function siteUrl(path: string): string {
  return `${siteOrigin()}${path.startsWith("/") ? path : `/${path}`}`;
}
