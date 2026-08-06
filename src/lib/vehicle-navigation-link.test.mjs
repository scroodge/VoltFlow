import assert from "node:assert/strict";
import { test } from "node:test";

import { buildWalkingDirectionsUrl } from "./vehicle-navigation-link.ts";

test("iOS gets an Apple Maps walking-directions link", () => {
  assert.equal(
    buildWalkingDirectionsUrl(53.9, 27.5667, true),
    "https://maps.apple.com/?daddr=53.9,27.5667&dirflg=w",
  );
});

test("non-iOS gets a Google Maps walking-directions link", () => {
  assert.equal(
    buildWalkingDirectionsUrl(53.9, 27.5667, false),
    "https://www.google.com/maps/dir/?api=1&destination=53.9,27.5667&travelmode=walking",
  );
});

test("neither link includes an origin — the native app resolves current location itself", () => {
  assert.ok(!buildWalkingDirectionsUrl(53.9, 27.5667, true).includes("saddr"));
  assert.ok(!buildWalkingDirectionsUrl(53.9, 27.5667, false).includes("origin"));
});
