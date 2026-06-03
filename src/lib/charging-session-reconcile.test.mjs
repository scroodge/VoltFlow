import test from "node:test";
import assert from "node:assert/strict";

import {
  buildReconciledSessionPatch,
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
