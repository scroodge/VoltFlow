import test from "node:test";
import assert from "node:assert/strict";

import {
  buildReconciledSessionPatch,
  buildSilenceClosePatch,
  measuredSocFromMate,
  OPEN_SESSION_SILENCE_MS,
  sessionNeedsReconcile,
  summarizeSessionTelemetry,
} from "./charging-session-reconcile-logic.ts";

const baseSession = {
  id: "s1",
  user_id: "u1",
  car_id: "c1",
  start_percent: 71,
  current_percent: 71,
  target_percent: 100,
  battery_capacity_kwh: 45,
  charger_power_kw: 4.4,
  efficiency_percent: 100,
  price_per_kwh: 0.3265,
  charged_energy_kwh: 0,
  estimated_cost: 0,
  status: "stopped",
  started_at: "2026-06-03T07:05:18.328+00:00",
  stopped_at: "2026-06-03T06:36:41.82+00:00",
  created_at: "2026-06-03T07:05:18.328+00:00",
  updated_at: "2026-06-03T07:05:18.328+00:00",
};

test("sessionNeedsReconcile detects stopped_at before started_at", () => {
  assert.equal(sessionNeedsReconcile(baseSession, Date.parse("2026-06-03T12:00:00Z")), true);
});

test("summarizeSessionTelemetry finds target SOC in samples", () => {
  const summary = summarizeSessionTelemetry(
    [
      {
        device_time: "2026-06-03T10:33:07.498+00:00",
        telemetry: { soc: 100, is_charging: true, charge_power_kw: 0 },
      },
    ],
    baseSession,
  );
  assert.equal(summary.maxSoc, 100);
  assert.equal(summary.firstTargetSocAt, "2026-06-03T10:33:07.498+00:00");
});

test("buildReconciledSessionPatch completes session to 100% from telemetry", () => {
  const summary = summarizeSessionTelemetry(
    [
      {
        device_time: "2026-06-03T10:33:07.498+00:00",
        telemetry: { soc: 100, is_charging: true, charge_power_kw: 0 },
      },
    ],
    baseSession,
  );
  const patch = buildReconciledSessionPatch({
    session: baseSession,
    summary,
    liveSoc: 100,
    nowMs: Date.parse("2026-06-03T10:40:00Z"),
  });
  assert.ok(patch);
  assert.equal(patch.status, "completed");
  assert.equal(patch.current_percent, 100);
  assert.ok(patch.charged_energy_kwh > 12);
  assert.equal(Date.parse(patch.stopped_at) >= Date.parse(baseSession.started_at), true);
});

test("buildReconciledSessionPatch lowers inflated math SOC and cost", () => {
  const inflated = {
    ...baseSession,
    start_percent: 11,
    current_percent: 90,
    charged_energy_kwh: 39.59,
    estimated_cost: 21.38,
    stopped_at: "2026-06-01T06:51:27.141+00:00",
    started_at: "2026-06-01T04:46:59.117+00:00",
  };
  const summary = summarizeSessionTelemetry(
    [
      { device_time: "2026-06-01T05:00:00+00:00", telemetry: { soc: 12, charge_power_kw: 7 } },
      { device_time: "2026-06-01T06:50:00+00:00", telemetry: { soc: 41, charge_power_kw: 7 } },
    ],
    inflated,
  );
  const patch = buildReconciledSessionPatch({
    session: inflated,
    summary,
    liveSoc: null,
    nowMs: Date.parse("2026-06-01T12:00:00Z"),
  });
  assert.ok(patch);
  assert.equal(patch.current_percent, 41);
  assert.ok(patch.charged_energy_kwh < 20);
  assert.ok(patch.estimated_cost < 12);
});

test("measuredSocFromMate ignores inflated persisted current_percent", () => {
  const summary = { maxSoc: 41 };
  assert.equal(
    measuredSocFromMate({ start_percent: 11, target_percent: 100 }, summary, null),
    41,
  );
});

test("sessionNeedsReconcile detects completed session with math-only grid energy", () => {
  const completed = {
    ...baseSession,
    status: "completed",
    start_percent: 68,
    current_percent: 100,
    target_percent: 100,
    efficiency_percent: 90,
    charged_energy_kwh: 14.432,
    estimated_cost: 7.79,
  };
  assert.equal(sessionNeedsReconcile(completed, Date.parse("2026-06-04T12:00:00Z")), true);
});

const bmsSession = {
  ...baseSession,
  start_percent: 30,
  current_percent: 30,
  target_percent: 100,
  battery_capacity_kwh: 45,
  efficiency_percent: 100, // grid == battery so the BMS kWh maps 1:1
  price_per_kwh: 0.2,
  charged_energy_kwh: 0,
  estimated_cost: 0,
  status: "stopped",
  started_at: "2026-06-03T07:00:00.000+00:00",
  stopped_at: "2026-06-03T07:00:00.000+00:00", // < started? equal — needs reconcile via energy<=0
};

test("summarizeSessionTelemetry extracts the max BMS kwh_charged over the window", () => {
  const summary = summarizeSessionTelemetry(
    [
      { device_time: "2026-06-03T07:10:00Z", telemetry: { soc: 40, charge_power_kw: 4, kwh_charged: 1.2 } },
      { device_time: "2026-06-03T07:20:00Z", telemetry: { soc: 49, charge_power_kw: 4 } }, // intermittent: no kwh
      { device_time: "2026-06-03T07:30:00Z", telemetry: { soc: 49, charge_power_kw: 4, kwh_charged: 2.559 } },
    ],
    bmsSession,
  );
  assert.equal(summary.maxKwhCharged, 2.559);
  assert.equal(summary.maxSoc, 49);
});

test("buildReconciledSessionPatch uses SOC estimate, ignores BMS kwh_charged", () => {
  const summary = summarizeSessionTelemetry(
    [
      { device_time: "2026-06-03T07:10:00Z", telemetry: { soc: 40, charge_power_kw: 4, kwh_charged: 1.2 } },
      { device_time: "2026-06-03T07:30:00Z", telemetry: { soc: 49, charge_power_kw: 4, kwh_charged: 2.559 } },
    ],
    bmsSession,
  );
  const patch = buildReconciledSessionPatch({
    session: bmsSession,
    summary,
    liveSoc: null,
    nowMs: Date.parse("2026-06-03T08:00:00Z"),
  });
  assert.ok(patch);
  // SOC estimate: 45 * (49-30)/100 = 8.55 — BMS counter is cell-only, not used for cost/grid energy.
  assert.ok(Math.abs(patch.charged_energy_kwh - 8.55) < 1e-9);
  assert.ok(Math.abs(patch.estimated_cost - 8.55 * 0.2) < 1e-9);
  assert.equal(patch.current_percent, 49);
});

test("buildReconciledSessionPatch falls back to SOC estimate when no kwh_charged present", () => {
  const summary = summarizeSessionTelemetry(
    [
      { device_time: "2026-06-03T07:10:00Z", telemetry: { soc: 40, charge_power_kw: 4 } },
      { device_time: "2026-06-03T07:30:00Z", telemetry: { soc: 49, charge_power_kw: 4 } },
    ],
    bmsSession,
  );
  assert.equal(summary.maxKwhCharged, null);
  const patch = buildReconciledSessionPatch({
    session: bmsSession,
    summary,
    liveSoc: null,
    nowMs: Date.parse("2026-06-03T08:00:00Z"),
  });
  assert.ok(patch);
  // SOC estimate: 45 * (49-30)/100 = 8.55
  assert.ok(Math.abs(patch.charged_energy_kwh - 8.55) < 1e-9);
});

const NOW2 = Date.parse("2026-06-19T17:56:00Z");
const openSession = {
  ...baseSession,
  status: "charging",
  start_percent: 32,
  current_percent: 77.9, // wall-clock overshoot
  target_percent: 100,
  battery_capacity_kwh: 45.1,
  charger_power_kw: 4.4,
  efficiency_percent: 100,
  price_per_kwh: 0.3265,
  energy_overridden: false,
  started_at: "2026-06-19T07:52:00Z",
  stopped_at: null,
};

test("buildSilenceClosePatch closes a silent open session at last real SOC", () => {
  const lastSampleMs = NOW2 - 60 * 60_000; // last telemetry 1h ago
  const summary = summarizeSessionTelemetry(
    [{ device_time: new Date(lastSampleMs).toISOString(), telemetry: { soc: 64 } }],
    openSession,
  );
  const patch = buildSilenceClosePatch({
    session: openSession,
    summary,
    lastSampleMs,
    liveSocFresh: false,
    liveSoc: null,
    nowMs: NOW2,
  });
  assert.ok(patch);
  assert.equal(patch.status, "stopped");
  assert.equal(patch.current_percent, 64); // last real SOC, not the 77.9 overshoot
  // energy from SOC: (64-32)% * 45.1 = 14.432
  assert.ok(Math.abs(patch.charged_energy_kwh - 14.432) < 0.01);
  assert.equal(patch.stopped_at, new Date(lastSampleMs).toISOString());
});

test("buildSilenceClosePatch completes when last SOC reached target", () => {
  const lastSampleMs = NOW2 - 60 * 60_000;
  const summary = summarizeSessionTelemetry(
    [{ device_time: new Date(lastSampleMs).toISOString(), telemetry: { soc: 100 } }],
    openSession,
  );
  const patch = buildSilenceClosePatch({
    session: openSession, summary, lastSampleMs, liveSocFresh: false, liveSoc: null, nowMs: NOW2,
  });
  assert.equal(patch.status, "completed");
  assert.equal(patch.current_percent, 100);
});

test("buildSilenceClosePatch is a no-op while telemetry is still fresh", () => {
  const lastSampleMs = NOW2 - 60_000; // 1 min ago, well within silence window
  assert.ok(NOW2 - lastSampleMs < OPEN_SESSION_SILENCE_MS);
  const summary = summarizeSessionTelemetry([], openSession);
  assert.equal(
    buildSilenceClosePatch({
      session: openSession, summary, lastSampleMs, liveSocFresh: false, liveSoc: null, nowMs: NOW2,
    }),
    null,
  );
});

test("buildSilenceClosePatch is a no-op while live SOC is fresh (car awake)", () => {
  const lastSampleMs = NOW2 - 60 * 60_000;
  const summary = summarizeSessionTelemetry([], openSession);
  assert.equal(
    buildSilenceClosePatch({
      session: openSession, summary, lastSampleMs, liveSocFresh: true, liveSoc: 64, nowMs: NOW2,
    }),
    null,
  );
});

test("buildSilenceClosePatch is a no-op for an already-closed session", () => {
  const summary = summarizeSessionTelemetry([], baseSession);
  assert.equal(
    buildSilenceClosePatch({
      session: baseSession, summary, lastSampleMs: NOW2 - 60 * 60_000, liveSocFresh: false, liveSoc: null, nowMs: NOW2,
    }),
    null,
  );
});

test("buildSilenceClosePatch preserves overridden energy", () => {
  const lastSampleMs = NOW2 - 60 * 60_000;
  const summary = summarizeSessionTelemetry(
    [{ device_time: new Date(lastSampleMs).toISOString(), telemetry: { soc: 64 } }],
    openSession,
  );
  const patch = buildSilenceClosePatch({
    session: { ...openSession, energy_overridden: true },
    summary, lastSampleMs, liveSocFresh: false, liveSoc: null, nowMs: NOW2,
  });
  assert.ok(patch);
  assert.equal("charged_energy_kwh" in patch, false);
  assert.equal("estimated_cost" in patch, false);
  assert.equal(patch.current_percent, 64);
});
