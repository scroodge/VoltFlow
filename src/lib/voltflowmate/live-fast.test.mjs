import assert from "node:assert/strict";
import test from "node:test";

import { LIVE_FAST_GRANT_SECONDS, liveFastSecondsFor } from "./live-fast.ts";

const inSeconds = (seconds) => new Date(Date.now() + seconds * 1000).toISOString();

test("grants nothing when no window has been stamped", () => {
  assert.equal(
    liveFastSecondsFor({ liveFastUntil: null, liveFastVehicleId: null }, "car-a"),
    0,
  );
});

test("grants nothing once the window has lapsed", () => {
  assert.equal(
    liveFastSecondsFor({ liveFastUntil: inSeconds(-1), liveFastVehicleId: "car-a" }, "car-a"),
    0,
  );
});

test("clamps a long remaining window to one grant", () => {
  assert.equal(
    liveFastSecondsFor({ liveFastUntil: inSeconds(300), liveFastVehicleId: "car-a" }, "car-a"),
    LIVE_FAST_GRANT_SECONDS,
  );
});

test("returns the shorter remainder when the window is about to lapse", () => {
  const granted = liveFastSecondsFor(
    { liveFastUntil: inSeconds(5), liveFastVehicleId: "car-a" },
    "car-a",
  );
  assert.ok(granted > 0 && granted <= 5, `expected 1-5s, got ${granted}`);
});

test("a window watching car A must not speed up car B", () => {
  assert.equal(
    liveFastSecondsFor({ liveFastUntil: inSeconds(300), liveFastVehicleId: "car-a" }, "car-b"),
    0,
  );
});

test("honours a window stamped before the watched car was known", () => {
  assert.equal(
    liveFastSecondsFor({ liveFastUntil: inSeconds(300), liveFastVehicleId: null }, "car-b"),
    LIVE_FAST_GRANT_SECONDS,
  );
});

test("treats an unparseable timestamp as no grant", () => {
  assert.equal(
    liveFastSecondsFor({ liveFastUntil: "not-a-date", liveFastVehicleId: null }, "car-a"),
    0,
  );
});
