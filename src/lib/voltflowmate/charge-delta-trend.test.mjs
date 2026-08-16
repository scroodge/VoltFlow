import assert from "node:assert/strict";
import test from "node:test";

import { buildChargeDeltaTrend } from "./charge-delta-trend.ts";

function fullCharge(overrides) {
  return {
    id: "full",
    status: "stopped",
    current_percent: 100,
    end_max_cell_delta_v: 0.272,
    end_delta_soc: 100,
    started_at: "2026-07-10T10:00:00.000Z",
    stopped_at: "2026-07-10T12:00:00.000Z",
    ...overrides,
  };
}

function partialCharge(overrides) {
  return fullCharge({
    id: "partial",
    current_percent: 80,
    end_max_cell_delta_v: 0.007,
    end_delta_soc: 80,
    ...overrides,
  });
}

function sohPoint(deviceTime, soh) {
  return { device_time: deviceTime, telemetry: { soh_percent: soh } };
}

test("charts only charges that reached the balance tail, oldest first", () => {
  const trend = buildChargeDeltaTrend([
    fullCharge({ id: "newer", stopped_at: "2026-07-12T12:00:00.000Z" }),
    partialCharge({ id: "skipped", stopped_at: "2026-07-11T12:00:00.000Z" }),
    fullCharge({ id: "older", stopped_at: "2026-07-08T12:00:00.000Z" }),
  ]);

  assert.deepEqual(
    trend.fullCharges.map((p) => p.sessionId),
    ["older", "newer"],
  );
});

test("keeps partial charges as context marks rather than delta points", () => {
  const trend = buildChargeDeltaTrend([partialCharge({ id: "p1", end_delta_soc: 84 })]);

  assert.deepEqual(trend.fullCharges, []);
  assert.equal(trend.partialCharges.length, 1);
  assert.equal(trend.partialCharges[0].endSoc, 84);
});

test("counts the partial charges that preceded each full charge", () => {
  const trend = buildChargeDeltaTrend([
    fullCharge({ id: "first", stopped_at: "2026-07-01T12:00:00.000Z" }),
    partialCharge({ id: "p1", stopped_at: "2026-07-02T12:00:00.000Z" }),
    partialCharge({ id: "p2", stopped_at: "2026-07-03T12:00:00.000Z" }),
    fullCharge({ id: "second", stopped_at: "2026-07-04T12:00:00.000Z" }),
    fullCharge({ id: "third", stopped_at: "2026-07-05T12:00:00.000Z" }),
  ]);

  assert.deepEqual(
    trend.fullCharges.map((p) => [p.sessionId, p.partialChargesSincePrevious]),
    [
      ["first", 0],
      ["second", 2],
      ["third", 0],
    ],
  );
});

test("classifies by the SOC telemetry measured, not the session's own end percent", () => {
  // Seen in prod: a session row stuck at 86% whose samples charged into the tail.
  const trend = buildChargeDeltaTrend([
    fullCharge({ id: "stale-row", current_percent: 86, end_delta_soc: 100 }),
  ]);

  assert.deepEqual(
    trend.fullCharges.map((p) => p.sessionId),
    ["stale-row"],
  );
  assert.deepEqual(trend.partialCharges, []);
});

test("skips charges with no captured cell data entirely", () => {
  const trend = buildChargeDeltaTrend([
    fullCharge({ id: "captured" }),
    fullCharge({ id: "no-cell-data", end_max_cell_delta_v: null }),
    fullCharge({ id: "no-soc", end_delta_soc: null }),
    fullCharge({ id: "garbage", end_max_cell_delta_v: 0 }),
  ]);

  assert.deepEqual(
    trend.fullCharges.map((p) => p.sessionId),
    ["captured"],
  );
  assert.deepEqual(trend.partialCharges, []);
});

test("ignores a charge that is still running", () => {
  const trend = buildChargeDeltaTrend([fullCharge({ status: "charging" })]);

  assert.deepEqual(trend.fullCharges, []);
});

test("annotates each point with the nearest SOH reading", () => {
  const trend = buildChargeDeltaTrend(
    [fullCharge({ stopped_at: "2026-07-10T12:00:00.000Z" })],
    [
      sohPoint("2026-07-01T12:00:00.000Z", 97.1),
      sohPoint("2026-07-09T12:00:00.000Z", 98.4),
      sohPoint("2026-07-20T12:00:00.000Z", 98.9),
    ],
  );

  assert.equal(trend.fullCharges[0].sohPercent, 98.4);
});

test("leaves SOH null when no reading is within the match window", () => {
  const trend = buildChargeDeltaTrend(
    [fullCharge({ stopped_at: "2026-07-10T12:00:00.000Z" })],
    [sohPoint("2026-05-01T12:00:00.000Z", 99)],
  );

  assert.equal(trend.fullCharges[0].sohPercent, null);
});

test("falls back to started_at when a charge never recorded a stop time", () => {
  const trend = buildChargeDeltaTrend([
    fullCharge({ stopped_at: null, started_at: "2026-07-10T10:00:00.000Z" }),
  ]);

  assert.equal(trend.fullCharges.length, 1);
  assert.equal(trend.fullCharges[0].time, Date.parse("2026-07-10T10:00:00.000Z"));
});

test("ignores charges with no usable timestamp", () => {
  const trend = buildChargeDeltaTrend([fullCharge({ stopped_at: null, started_at: null })]);

  assert.deepEqual(trend.fullCharges, []);
});
