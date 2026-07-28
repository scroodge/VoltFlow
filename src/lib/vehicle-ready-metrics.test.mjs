import assert from "node:assert/strict";
import test from "node:test";

import { vehicleReadyDurationBucket } from "./vehicle-ready-metrics.ts";

test("vehicle ready duration buckets retain the dashboard RUM thresholds", () => {
  assert.equal(vehicleReadyDurationBucket(0), "le_1s");
  assert.equal(vehicleReadyDurationBucket(1_000), "le_1s");
  assert.equal(vehicleReadyDurationBucket(1_001), "le_2_5s");
  assert.equal(vehicleReadyDurationBucket(2_500), "le_2_5s");
  assert.equal(vehicleReadyDurationBucket(2_501), "le_4s");
  assert.equal(vehicleReadyDurationBucket(4_000), "le_4s");
  assert.equal(vehicleReadyDurationBucket(4_001), "gt_4s");
});
