import test from "node:test";
import assert from "node:assert/strict";

import {
  CHARGING_PERSIST_SLACK_MS,
  chargingPersistIntervalMs,
} from "./charging-live.ts";

test("persist interval tiers by SOC like the read cadence", () => {
  // Long flat phase — coarse persists.
  assert.equal(chargingPersistIntervalMs(0), 30_000);
  assert.equal(chargingPersistIntervalMs(50), 30_000);
  assert.equal(chargingPersistIntervalMs(94.9), 30_000);

  // Approaching the tail.
  assert.equal(chargingPersistIntervalMs(95), 5_000);
  assert.equal(chargingPersistIntervalMs(97.9), 5_000);

  // Balance tail — fine resolution to catch exact completion.
  assert.equal(chargingPersistIntervalMs(98), 1_000);
  assert.equal(chargingPersistIntervalMs(100), 1_000);
});

test("non-finite percent falls back to the coarsest tier", () => {
  assert.equal(chargingPersistIntervalMs(null), 30_000);
  assert.equal(chargingPersistIntervalMs(undefined), 30_000);
  assert.equal(chargingPersistIntervalMs(Number.NaN), 30_000);
});

test("slack keeps a 1Hz tick clearing the ≥98% tier", () => {
  // The tick fires every ~1000ms; the effective threshold must be < 1000ms so a
  // tick landing a few ms early still persists at the balance tail.
  assert.ok(chargingPersistIntervalMs(99) - CHARGING_PERSIST_SLACK_MS < 1_000);
  assert.ok(CHARGING_PERSIST_SLACK_MS > 0);
});
