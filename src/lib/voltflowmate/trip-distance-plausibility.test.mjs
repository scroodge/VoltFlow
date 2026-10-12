import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_PLAUSIBLE_TRIP_KM,
  isPlausibleTripDistance,
  sanitizeTripDistances,
} from "./trip-distance-plausibility.ts";

const START = "2026-08-01T18:28:49.811Z";
const plus = (seconds) => new Date(Date.parse(START) + seconds * 1000).toISOString();

test("rejects an odometer-scale distance (44,123 km in 6 minutes)", () => {
  assert.equal(isPlausibleTripDistance({ distance_km: 44122.9 }), false);
});

test("the per-trip cap is the only hard rule: 1,500 km passes, 1,501 km does not", () => {
  assert.equal(isPlausibleTripDistance({ distance_km: MAX_PLAUSIBLE_TRIP_KM }), true);
  assert.equal(isPlausibleTripDistance({ distance_km: MAX_PLAUSIBLE_TRIP_KM + 1 }), false);
});

test("a truncated recorded duration does NOT make a correct distance implausible", () => {
  // Real trips seen on prod: 8.6 km stored (energy also says 8.6 km) with a 122 s duration,
  // 14.3 km with 84 s. The old implied-speed rule flagged these; all such flags were false positives.
  assert.equal(
    isPlausibleTripDistance({ distance_km: 8.6, started_at: START, ended_at: plus(122) }),
    true,
  );
  assert.equal(
    isPlausibleTripDistance({ distance_km: 14.3, started_at: START, ended_at: plus(84) }),
    true,
  );
  assert.equal(
    isPlausibleTripDistance({ distance_km: 90, started_at: START, ended_at: plus(300) }),
    true,
  );
});

test("keeps legitimate highway trips", () => {
  assert.equal(isPlausibleTripDistance({ distance_km: 90.6 }), true);
  // the longest healthy trip seen in prod
  assert.equal(isPlausibleTripDistance({ distance_km: 286 }), true);
});

test("does not judge missing or non-positive distances", () => {
  assert.equal(isPlausibleTripDistance({ distance_km: null }), true);
  assert.equal(isPlausibleTripDistance({ distance_km: undefined }), true);
  assert.equal(isPlausibleTripDistance({ distance_km: 0 }), true);
  assert.equal(isPlausibleTripDistance({ distance_km: -3 }), true);
  assert.equal(isPlausibleTripDistance({ distance_km: Number.NaN }), true);
});

test("sanitizeTripDistances nulls only the over-cap distance and keeps the trip", () => {
  const phantom = {
    id: "phantom",
    started_at: START,
    ended_at: plus(353),
    distance_km: 44122.9,
    avg_speed_kmh: 26,
  };
  const highway = { id: "highway", started_at: START, ended_at: plus(4025), distance_km: 90.6 };
  const longest = { id: "longest", started_at: START, ended_at: plus(10800), distance_km: 286 };
  const truncated = { id: "truncated", started_at: START, ended_at: plus(122), distance_km: 8.6 };
  const noDistance = { id: "none", started_at: START, ended_at: plus(60), distance_km: null };

  const result = sanitizeTripDistances([phantom, highway, longest, truncated, noDistance]);

  assert.deepEqual(
    result.map((trip) => [trip.id, trip.distance_km]),
    [
      ["phantom", null],
      ["highway", 90.6],
      ["longest", 286],
      ["truncated", 8.6],
      ["none", null],
    ],
  );
  // the drive itself survives with its other fields
  assert.equal(result[0].avg_speed_kmh, 26);
  assert.equal(result[0].started_at, START);
});

test("sanitizeTripDistances never mutates its input and reuses clean rows", () => {
  const phantom = { id: "p", started_at: START, ended_at: plus(353), distance_km: 44122.9 };
  const clean = { id: "c", started_at: START, ended_at: plus(3600), distance_km: 50 };
  const input = [phantom, clean];

  const result = sanitizeTripDistances(input);

  assert.equal(phantom.distance_km, 44122.9);
  assert.equal(input[0], phantom);
  assert.notEqual(result[0], phantom);
  assert.equal(result[1], clean);
});

test("sanitizeTripDistances catches an open odometer-scale trip (no ended_at yet)", () => {
  const open = {
    id: "open",
    started_at: START,
    ended_at: null,
    last_device_time: plus(1176),
    distance_km: 27582.8,
  };
  assert.equal(sanitizeTripDistances([open])[0].distance_km, null);

  const openOk = { ...open, id: "open-ok", distance_km: 12 };
  assert.equal(sanitizeTripDistances([openOk])[0].distance_km, 12);
});
