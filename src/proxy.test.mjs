import assert from "node:assert/strict";
import test from "node:test";

import proxyTesting from "next/experimental/testing/server.js";

const { unstable_doesMiddlewareMatch: doesProxyMatch } = proxyTesting;

// Next's proxy config must remain a build-time literal, so Node cannot import
// proxy.ts directly outside Next's resolver. Keep this test synchronized with it.
const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|apple-icon|icon|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
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
  ]) {
    assert.equal(doesProxyMatch({ config, nextConfig, url }), false, url);
  }
});
