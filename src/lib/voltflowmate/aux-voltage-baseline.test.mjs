import assert from "node:assert/strict";
import test from "node:test";
import { computeAuxVoltageBaseline } from "./aux-voltage-baseline.ts";

const point = (day, resting) => ({ date: `2026-08-${String(day).padStart(2, "0")}`, vMin: 12, vMax: 14, vResting: resting, restingSampleCount: resting == null ? 0 : 5 });

test("requires 14 resting days and reports progress without baseline or delta", () => {
  const result = computeAuxVoltageBaseline(Array.from({ length: 13 }, (_, index) => point(index + 1, 12 + index / 100)));
  assert.deepEqual(result, { sufficient: false, restingDayCount: 13, restingNow: 12.12, baseline: null, change: null });
});

test("computes an interpolated p90 baseline and signed voltage change", () => {
  const result = computeAuxVoltageBaseline(Array.from({ length: 14 }, (_, index) => point(index + 1, 12 + index / 10)));
  assert.equal(result.sufficient, true);
  assert.equal(result.restingDayCount, 14);
  assert.equal(result.restingNow, 13.3);
  assert.ok(Math.abs(result.baseline - 13.17) < 1e-9);
  assert.ok(Math.abs(result.change - 0.13) < 1e-9);
});

test("uses only the trailing 90 days ending at the latest resting day", () => {
  const points = Array.from({ length: 100 }, (_, index) => ({ date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10), vMin: 12, vMax: 14, vResting: 12 + index / 100, restingSampleCount: 2 }));
  const result = computeAuxVoltageBaseline(points);
  assert.equal(result.restingDayCount, 90);
  assert.equal(result.restingNow, 12.99);
});
