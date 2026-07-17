import assert from "node:assert/strict";
import test from "node:test";

import { buildChargeDeltaTrend } from "./charge-delta-trend.ts";

function session(overrides) {
  return {
    id: "s1",
    current_percent: 100,
    end_max_cell_delta_v: 0.011,
    end_delta_soc: 100,
    started_at: "2026-07-10T10:00:00.000Z",
    stopped_at: "2026-07-10T12:00:00.000Z",
    ...overrides,
  };
}

function sohPoint(deviceTime, soh) {
  return { device_time: deviceTime, telemetry: { soh_percent: soh } };
}

test("returns one point per session with a captured delta, oldest first", () => {
  const trend = buildChargeDeltaTrend([
    session({ id: "newer", stopped_at: "2026-07-12T12:00:00.000Z" }),
    session({ id: "older", stopped_at: "2026-07-08T12:00:00.000Z" }),
  ]);

  assert.deepEqual(
    trend.map((p) => p.sessionId),
    ["older", "newer"],
  );
});

test("skips sessions with no captured delta", () => {
  const trend = buildChargeDeltaTrend([
    session({ id: "captured" }),
    session({ id: "no-cell-data", end_max_cell_delta_v: null }),
    session({ id: "garbage", end_max_cell_delta_v: 0 }),
  ]);

  assert.deepEqual(
    trend.map((p) => p.sessionId),
    ["captured"],
  );
});

test("marks the balance tail as a full charge and partial charges as not", () => {
  const trend = buildChargeDeltaTrend([
    session({ id: "full", current_percent: 100 }),
    session({ id: "tail-edge", current_percent: 99 }),
    session({ id: "partial", current_percent: 84 }),
  ]);

  const byId = Object.fromEntries(trend.map((p) => [p.sessionId, p.isFullCharge]));
  assert.equal(byId.full, true);
  assert.equal(byId["tail-edge"], true);
  assert.equal(byId.partial, false);
});

test("annotates each point with the nearest SOH reading", () => {
  const trend = buildChargeDeltaTrend(
    [session({ stopped_at: "2026-07-10T12:00:00.000Z" })],
    [
      sohPoint("2026-07-01T12:00:00.000Z", 97.1),
      sohPoint("2026-07-09T12:00:00.000Z", 98.4),
      sohPoint("2026-07-20T12:00:00.000Z", 98.9),
    ],
  );

  assert.equal(trend[0].sohPercent, 98.4);
});

test("leaves SOH null when no reading is within the match window", () => {
  const trend = buildChargeDeltaTrend(
    [session({ stopped_at: "2026-07-10T12:00:00.000Z" })],
    [sohPoint("2026-05-01T12:00:00.000Z", 99)],
  );

  assert.equal(trend[0].sohPercent, null);
});

test("falls back to started_at when a session never recorded a stop time", () => {
  const trend = buildChargeDeltaTrend([
    session({ stopped_at: null, started_at: "2026-07-10T10:00:00.000Z" }),
  ]);

  assert.equal(trend.length, 1);
  assert.equal(trend[0].time, Date.parse("2026-07-10T10:00:00.000Z"));
});

test("ignores sessions with no usable timestamp", () => {
  const trend = buildChargeDeltaTrend([session({ stopped_at: null, started_at: null })]);

  assert.deepEqual(trend, []);
});
