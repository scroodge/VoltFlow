import type { NextConfig } from "next";

import { REMOTE_COMMANDS_DISABLED } from "./src/lib/voltflowmate/remote-commands";

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), payment=(), usb=(), geolocation=(self)",
  },
  // Enforced independently of the broader report-only policy below, so public
  // pages cannot be framed by an arbitrary hostile site while Telegram embeds
  // continue to work.
  {
    key: "Content-Security-Policy",
    value: "base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'self' https://web.telegram.org https://*.telegram.org",
  },
  // Start the larger policy in report-only mode: this covers third-party map,
  // Telegram, Supabase, and Vercel development surfaces without silently
  // breaking production. It can be enforced after the reports are reviewed.
  {
    key: "Content-Security-Policy-Report-Only",
    value: "default-src 'self'; script-src 'self' 'unsafe-inline' https://telegram.org https://*.telegram.org https://vercel.live; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https: wss:; frame-src 'self' https://www.openstreetmap.org https://web.telegram.org https://*.telegram.org; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self' https://web.telegram.org https://*.telegram.org; upgrade-insecure-requests",
  },
];

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "20mb",
    },
  },
  /**
   * The public knowledge base moved from `/telegram/*` to `/knowledge/*`: the
   * `telegram` segment was the most prominent token in the SERP URL line and
   * told Google each page was about Telegram rather than EV charging.
   *
   * `/telegram` itself is deliberately NOT redirected — it remains the Mini App
   * entry gate that BotFather points at, and now carries `robots: noindex`.
   * A sitemap must never list a redirect source, so `sitemap.ts` emits only the
   * `/knowledge/*` forms.
   *
   * `permanent: true` emits 308, matching the existing host canonicalization.
   */
  async redirects() {
    return [
      { source: "/telegram/article/:slug", destination: "/knowledge/article/:slug", permanent: true },
      { source: "/telegram/category/:slug", destination: "/knowledge/category/:slug", permanent: true },
      { source: "/telegram/accessory/:id", destination: "/knowledge/accessory/:id", permanent: true },
      { source: "/telegram/spare-part/:id", destination: "/knowledge/spare-part/:id", permanent: true },
      { source: "/telegram/service/:id", destination: "/knowledge/service/:id", permanent: true },
      { source: "/telegram/service-preview", destination: "/knowledge?tab=buy", permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  async rewrites() {
    return {
      beforeFiles: REMOTE_COMMANDS_DISABLED
        ? [
            {
              source: "/api/bydmate/commands",
              destination: "/bydmate-commands-disabled.json",
            },
          ]
        : [],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
