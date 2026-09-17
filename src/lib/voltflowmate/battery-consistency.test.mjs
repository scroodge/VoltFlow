import assert from "node:assert/strict";
import test from "node:test";

import {
  CELL_DELTA_PROVISIONAL_THRESHOLDS_MV,
  buildBatteryConsistencySummary,
  buildBatteryConsistencyTrend,
  cellDeltaVoltsToMv,
  classifyCellConsistencyStatus,
  classifyConsistencyTrend,
  computeTemperatureSpread,
  describeSoh,
} from "./battery-consistency.ts";

function topChargeSession(overrides) {
  return {
    id: "session",
    status: "stopped",
    end_median_cell_delta_v: 0.007,
    end_delta_soc: 100,
    started_at: "2026-07-10T10:00:00.000Z",
    stopped_at: "2026-07-10T12:00:00.000Z",
    ...overrides,
  };
}

test("converts the spec's own worked example: 3.324V - 3.317V = 7mV", () => {
  const deltaVolts = 3.324 - 3.317;
  assert.equal(Math.round(cellDeltaVoltsToMv(deltaVolts) * 1e6) / 1e6, 7);
});

test("missing median delta (no Vmin/Vmax reading) yields no delta, never 0", () => {
  assert.equal(cellDeltaVoltsToMv(null), null);
  assert.equal(cellDeltaVoltsToMv(undefined), null);

  const trend = buildBatteryConsistencyTrend([
    topChargeSession({ end_median_cell_delta_v: null }),
  ]);
  assert.deepEqual(trend, []);
});

test("invalid negative voltage is rejected, not charted as a negative spread", () => {
  const trend = buildBatteryConsistencyTrend([
    topChargeSession({ end_median_cell_delta_v: -0.01 }),
  ]);
  assert.deepEqual(trend, []);
});

test("temperature spread is always reported as unavailable, never fabricated", () => {
  const result = computeTemperatureSpread();
  assert.equal(result.available, false);
  assert.equal(result.spreadC, null);
  assert.equal(result.reason, "not_supported_by_current_telemetry");
});

test("SOH is always labeled as the app's own estimate, never vehicle-reported", () => {
  assert.deepEqual(describeSoh(94), { sohPercent: 94, source: "app_estimate" });
  assert.deepEqual(describeSoh(null), { sohPercent: null, source: "app_estimate" });
  assert.deepEqual(describeSoh(undefined), { sohPercent: null, source: "app_estimate" });
});

test("only top-of-charge sessions are comparable points; partial charges are excluded, not mixed in", () => {
  const trend = buildBatteryConsistencyTrend([
    topChargeSession({ id: "top", end_delta_soc: 100 }),
    topChargeSession({ id: "partial", end_delta_soc: 82 }),
  ]);

  assert.deepEqual(
    trend.map((point) => point.sessionId),
    ["top"],
  );
  assert.equal(trend[0].diagnosticContext, "top_charge");
});

test("an in-progress session is never treated as a captured measurement", () => {
  const trend = buildBatteryConsistencyTrend([topChargeSession({ status: "charging" })]);
  assert.deepEqual(trend, []);
});

test("status classification follows the centralized provisional thresholds", () => {
  const { excellentMax, goodMax, watchMax } = CELL_DELTA_PROVISIONAL_THRESHOLDS_MV;
  assert.equal(classifyCellConsistencyStatus(excellentMax), "excellent");
  assert.equal(classifyCellConsistencyStatus(excellentMax + 1), "good");
  assert.equal(classifyCellConsistencyStatus(goodMax + 1), "watch");
  assert.equal(classifyCellConsistencyStatus(watchMax + 1), "poor");
  assert.equal(classifyCellConsistencyStatus(null), "insufficient_data");
});

test("trend needs enough comparable points before claiming a direction", () => {
  const trend = buildBatteryConsistencyTrend([
    topChargeSession({ id: "a", stopped_at: "2026-07-01T12:00:00.000Z" }),
    topChargeSession({ id: "b", stopped_at: "2026-07-02T12:00:00.000Z" }),
  ]);
  assert.equal(classifyConsistencyTrend(trend), "insufficient_data");
});

test("trend compares the latest point against the median of prior points, not just one", () => {
  const trend = buildBatteryConsistencyTrend([
    topChargeSession({ id: "a", end_median_cell_delta_v: 0.007, stopped_at: "2026-07-01T12:00:00.000Z" }),
    // A single noisy low reading must not flip a real rising trend to "improving".
    topChargeSession({ id: "b", end_median_cell_delta_v: 0.003, stopped_at: "2026-07-02T12:00:00.000Z" }),
    topChargeSession({ id: "c", end_median_cell_delta_v: 0.009, stopped_at: "2026-07-03T12:00:00.000Z" }),
    topChargeSession({ id: "d", end_median_cell_delta_v: 0.027, stopped_at: "2026-07-04T12:00:00.000Z" }),
  ]);
  assert.equal(classifyConsistencyTrend(trend), "worsening");
});

test("small fluctuations within tolerance read as stable, not noise-chasing", () => {
  const trend = buildBatteryConsistencyTrend([
    topChargeSession({ id: "a", end_median_cell_delta_v: 0.008, stopped_at: "2026-07-01T12:00:00.000Z" }),
    topChargeSession({ id: "b", end_median_cell_delta_v: 0.009, stopped_at: "2026-07-02T12:00:00.000Z" }),
    topChargeSession({ id: "c", end_median_cell_delta_v: 0.0085, stopped_at: "2026-07-03T12:00:00.000Z" }),
  ]);
  assert.equal(classifyConsistencyTrend(trend), "stable");
});

test("summary combines latest value, status and trend without recomputation drift", () => {
  const summary = buildBatteryConsistencySummary([
    topChargeSession({ id: "a", end_median_cell_delta_v: 0.006, stopped_at: "2026-07-01T12:00:00.000Z" }),
    topChargeSession({ id: "b", end_median_cell_delta_v: 0.007, stopped_at: "2026-07-02T12:00:00.000Z" }),
    topChargeSession({ id: "c", end_median_cell_delta_v: 0.008, stopped_at: "2026-07-03T12:00:00.000Z" }),
  ]);

  assert.equal(summary.latest?.sessionId, "c");
  assert.equal(summary.status, "excellent");
  assert.ok(["stable", "worsening", "improving"].includes(summary.trend));
});

test("no comparable sessions yields an honest empty summary, not a fabricated zero", () => {
  const summary = buildBatteryConsistencySummary([]);
  assert.deepEqual(summary.points, []);
  assert.equal(summary.latest, null);
  assert.equal(summary.status, "insufficient_data");
  assert.equal(summary.trend, "insufficient_data");
});
