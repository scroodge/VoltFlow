import test from "node:test";
import assert from "node:assert/strict";
import { snapshotMeasurementIsFresh } from "./measurement-freshness.ts";
const NOW = Date.parse("2026-09-11T12:00:00Z");
const at = (offset) => new Date(NOW + offset).toISOString();
const fresh = (device, received) => snapshotMeasurementIsFresh({ device_time: device, received_at: received }, NOW, 90_000);

test("receipt of old telemetry does not make its measurement fresh", () => {
  assert.equal(fresh(at(-3600_000), at(0)), false);
  assert.equal(fresh(at(-90_000), at(0)), true);
  assert.equal(fresh(at(-90_001), at(0)), false);
});
test("both clocks must be valid and inside the freshness bounds", () => {
  assert.equal(fresh(at(0), at(-90_001)), false);
  assert.equal(fresh(undefined, at(0)), false);
  assert.equal(fresh("invalid", at(0)), false);
  assert.equal(fresh(at(0), "invalid"), false);
});
test("bounded future skew is accepted but a clock jump is rejected", () => {
  assert.equal(fresh(at(30_000), at(0)), true);
  assert.equal(fresh(at(30_001), at(0)), false);
  assert.equal(fresh(at(0), at(3600_000)), false);
});
