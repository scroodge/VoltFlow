import assert from "node:assert/strict";
import test from "node:test";

import {
  LATE_DELIVERY_MS,
  LATE_RECOVERY_LOOKBACK_MS,
  lateDeliveryWindows,
} from "./late-delivery-window.ts";

const NOW = Date.UTC(2026, 8, 25, 12, 43, 0);
const ago = (ms) => new Date(NOW - ms).toISOString();
const sample = (ms, extra = {}) => ({ vehicle_id: "v1", device_time: ago(ms), ...extra });

test("prompt delivery produces no window", () => {
  assert.deepEqual(lateDeliveryWindows([sample(5_000), sample(1_000)], NOW), []);
  assert.deepEqual(lateDeliveryWindows([sample(LATE_DELIVERY_MS)], NOW), []);
});

test("a late burst scans from before its earliest late sample to its newest sample", () => {
  const windows = lateDeliveryWindows(
    [sample(82 * 60_000), sample(40 * 60_000), sample(2_000)],
    NOW,
  );
  assert.deepEqual(windows, [{
    vehicleId: "v1",
    fromIso: ago(82 * 60_000 + LATE_RECOVERY_LOOKBACK_MS),
    toIso: ago(2_000),
  }]);
});

test("live_only and unparsable samples are ignored", () => {
  assert.deepEqual(lateDeliveryWindows([
    sample(60 * 60_000, { live_only: true }),
    { vehicle_id: "v1", device_time: "not a date" },
  ], NOW), []);
});

test("windows are independent per vehicle", () => {
  const windows = lateDeliveryWindows([
    sample(30 * 60_000),
    { vehicle_id: "v2", device_time: ago(1_000) },
  ], NOW);
  assert.equal(windows.length, 1);
  assert.equal(windows[0].vehicleId, "v1");
});
