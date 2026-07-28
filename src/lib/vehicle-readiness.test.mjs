import assert from "node:assert/strict";
import test from "node:test";

import { deriveVehiclePrimaryReadiness } from "./vehicle-readiness.ts";

const NOW = Date.UTC(2026, 6, 28, 12, 0, 0);
const snapshot = (receivedAt = NOW) => ({
  received_at: new Date(receivedAt).toISOString(),
  telemetry: { soc: 60 },
});

const base = {
  carsReady: true,
  hasMatchedCar: true,
  liveLoading: false,
  liveError: false,
  snapshot: snapshot(),
  nowMs: NOW,
};

test("primary cockpit waits for both car and live query readiness", () => {
  assert.equal(deriveVehiclePrimaryReadiness({ ...base, carsReady: false }), "loading");
  assert.equal(deriveVehiclePrimaryReadiness({ ...base, liveLoading: true }), "loading");
});

test("fresh matched car and snapshot reveal the primary cockpit", () => {
  assert.equal(deriveVehiclePrimaryReadiness(base), "ready");
});

test("settled empty data becomes no-contact, not an endless skeleton", () => {
  assert.equal(deriveVehiclePrimaryReadiness({ ...base, hasMatchedCar: false }), "no_contact");
  assert.equal(deriveVehiclePrimaryReadiness({ ...base, snapshot: null }), "no_contact");
});

test("settled old data becomes stale", () => {
  assert.equal(
    deriveVehiclePrimaryReadiness({ ...base, snapshot: snapshot(NOW - 90_001) }),
    "stale",
  );
});

test("live query errors are distinct from pending loading", () => {
  assert.equal(deriveVehiclePrimaryReadiness({ ...base, liveError: true }), "error");
});
