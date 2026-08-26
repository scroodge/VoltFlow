import assert from "node:assert/strict";
import test from "node:test";
import { mapAuxVoltageDailyRows, normalizeAuxVoltage } from "./aux-voltage-history.ts";

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
