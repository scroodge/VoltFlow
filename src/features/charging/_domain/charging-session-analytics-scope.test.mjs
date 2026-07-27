import assert from "node:assert/strict";
import test from "node:test";

import { chargingSessionAnalyticsScope } from "./charging-session-analytics-scope.ts";

test("scopes charging analytics to the resolved car for a vehicle alias", () => {
  assert.deepEqual(chargingSessionAnalyticsScope("second-car", "car-2"), { car_id: "car-2" });
});

test("does not fall back to all sessions when a requested vehicle alias has no car", () => {
  assert.equal(chargingSessionAnalyticsScope("unknown-car", null), null);
  assert.deepEqual(chargingSessionAnalyticsScope(null, null), {});
});
