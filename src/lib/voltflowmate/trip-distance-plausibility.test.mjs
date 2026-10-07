import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_PLAUSIBLE_TRIP_KM,
  isPlausibleTripDistance,
} from "./trip-distance-plausibility.ts";

const START = "2026-08-01T18:28:49.811Z";
const plus = (seconds) => new Date(Date.parse(START) + seconds * 1000).toISOString();

test("rejects an odometer-scale distance (44,123 km in 6 minutes)", () => {
  assert.equal(
    isPlausibleTripDistance({ distance_km: 44122.9, started_at: START, ended_at: plus(353) }),
    false,
  );
});

test("rejects above the per-trip km cap even when the duration is unknown", () => {
  assert.equal(
    isPlausibleTripDistance({ distance_km: MAX_PLAUSIBLE_TRIP_KM + 1, started_at: START }),
    false,
  );
  assert.equal(
    isPlausibleTripDistance({ distance_km: MAX_PLAUSIBLE_TRIP_KM, started_at: START }),
    true,
  );
});

test("rejects an impossible implied speed below the km cap", () => {
  // 90 km in 5 minutes = 1080 km/h
  assert.equal(
    isPlausibleTripDistance({ distance_km: 90, started_at: START, ended_at: plus(300) }),
    false,
  );
});

test("keeps legitimate highway trips, including ones near the old Rule C 80 km/h edge", () => {
  // 90.6 km in 4025 s = ~81 km/h, a real trip the deployed Rule C fallback would match
  assert.equal(
    isPlausibleTripDistance({ distance_km: 90.6, started_at: START, ended_at: plus(4025) }),
    true,
  );
  // 286 km in 3 h = ~95 km/h, the longest healthy trip seen in prod
  assert.equal(
    isPlausibleTripDistance({ distance_km: 286, started_at: START, ended_at: plus(10800) }),
    true,
  );
});

test("does not judge missing or non-positive distances or unusable timestamps", () => {
  assert.equal(isPlausibleTripDistance({ distance_km: null, started_at: START }), true);
  assert.equal(isPlausibleTripDistance({ distance_km: 0, started_at: START }), true);
  assert.equal(isPlausibleTripDistance({ distance_km: -3, started_at: START }), true);
  assert.equal(
    isPlausibleTripDistance({ distance_km: 12, started_at: START, ended_at: START }),
    true,
  );
  assert.equal(
    isPlausibleTripDistance({ distance_km: 12, started_at: START, ended_at: "garbage" }),
    true,
  );
});

test("tiny distances skip the speed check (rounding noise)", () => {
  assert.equal(
    isPlausibleTripDistance({ distance_km: 0.9, started_at: START, ended_at: plus(2) }),
    true,
  );
});
