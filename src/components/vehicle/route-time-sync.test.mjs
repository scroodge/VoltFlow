import assert from "node:assert/strict";
import test from "node:test";

import {
  nearestRoutePointIndexByTime,
  ROUTE_SYNC_TOLERANCE_MS,
} from "./route-time-sync.ts";

const points = [{ time: 1_000 }, { time: 10_000 }, { time: 20_000 }];

test("selects an exact route timestamp", () => {
  assert.equal(nearestRoutePointIndexByTime(points, 10_000), 1);
});

test("selects the nearest route timestamp between samples", () => {
  assert.equal(nearestRoutePointIndexByTime(points, 16_000), 2);
});

test("returns null when the nearest GPS point is outside tolerance", () => {
  assert.equal(
    nearestRoutePointIndexByTime(points, 20_000 + ROUTE_SYNC_TOLERANCE_MS + 1),
    null,
  );
});

test("ignores invalid times and handles missing GPS safely", () => {
  assert.equal(nearestRoutePointIndexByTime([{ time: Number.NaN }], 10_000), null);
  assert.equal(nearestRoutePointIndexByTime([], 10_000), null);
  assert.equal(nearestRoutePointIndexByTime(points, null), null);
});
