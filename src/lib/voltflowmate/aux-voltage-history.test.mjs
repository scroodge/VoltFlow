import assert from "node:assert/strict";
import test from "node:test";
import { mapAuxVoltageDailyRows, normalizeAuxVoltage, resolveAuxTrendWindow } from "./aux-voltage-history.ts";

test("in-progress week trends over the last 7 completed days", () => {
  const week = { from: "2026-10-19T00:00:00.000Z", to: "2026-10-25T23:59:59.999Z" };
  const now = new Date("2026-10-20T08:44:00.000Z");
  assert.deepEqual(resolveAuxTrendWindow("week", week, now), {
    from: "2026-10-13T00:00:00.000Z",
    to: "2026-10-20T08:44:00.000Z",
  });
});

test("completed weeks and other ranges keep their window", () => {
  const pastWeek = { from: "2026-10-12T00:00:00.000Z", to: "2026-10-18T23:59:59.999Z" };
  const now = new Date("2026-10-20T08:44:00.000Z");
  assert.equal(resolveAuxTrendWindow("week", pastWeek, now), pastWeek);
  const month = { from: "2026-09-21T00:00:00.000Z", to: "2026-10-20T23:59:59.999Z" };
  assert.equal(resolveAuxTrendWindow("month", month, now), month);
});

test("aux voltage normalization defensively clamps to 6-18 V", () => {
  assert.equal(normalizeAuxVoltage("12.65"), 12.65);
  assert.equal(normalizeAuxVoltage(6), 6);
  assert.equal(normalizeAuxVoltage(18), 18);
  assert.equal(normalizeAuxVoltage(0), null);
  assert.equal(normalizeAuxVoltage(18.1), null);
});

test("daily mapper preserves bands and gaps malformed resting values", () => {
  assert.deepEqual(mapAuxVoltageDailyRows([
    { date: "2026-08-01", v_min: "12.1", v_max: 14.4, v_resting: "12.6", resting_sample_count: "8" },
    { date: "2026-08-02", v_min: 12, v_max: 14.2, v_resting: null, resting_sample_count: 0 },
    { date: "bad", v_min: 12, v_max: 14, v_resting: 12.5, resting_sample_count: 2 },
  ]), [
    { date: "2026-08-01", vMin: 12.1, vMax: 14.4, vResting: 12.6, restingSampleCount: 8 },
    { date: "2026-08-02", vMin: 12, vMax: 14.2, vResting: null, restingSampleCount: 0 },
  ]);
});
