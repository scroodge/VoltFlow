import assert from "node:assert/strict";
import test from "node:test";

import proxyTesting from "next/experimental/testing/server.js";

const { unstable_doesMiddlewareMatch: doesProxyMatch } = proxyTesting;

// Next's proxy config must remain a build-time literal, so Node cannot import
// proxy.ts directly outside Next's resolver. Keep this test synchronized with it.
const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|robots\\.txt|sitemap.*\\.xml|google[0-9a-f]+\\.html|yandex_[0-9a-f]+\\.html|apple-icon|icon|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

const nextConfig = {};

test("proxy only matches application page requests", () => {
  for (const url of ["/dashboard", "/charging", "/login"]) {
    assert.equal(doesProxyMatch({ config, nextConfig, url }), true, url);
  }

  for (const url of [
    "/api/vehicle/trips",
    "/api/bydmate/telemetry",
    "/_next/static/chunk.js",
    "/favicon.ico",
    "/sw.js",
    "/manifest.webmanifest",
    "/apple-icon",
    "/icon",
    "/icons/icon-192.png",
    // SEO metadata routes. If the proxy matches these it redirects anonymous
    // requests to /login, which is exactly what made the site uncrawlable.
    "/robots.txt",
    "/sitemap.xml",
    "/sitemap/0.xml",
    // Search-console ownership tokens served from public/. If the proxy matches
    // these it 307s them to /login and site verification fails.
    "/google5b3c992f8d75e883.html",
    "/yandex_1234abcd5678ef90.html",
  ]) {
    assert.equal(doesProxyMatch({ config, nextConfig, url }), false, url);
  }
});
