import test from "node:test";
import assert from "node:assert/strict";

import {
  buildReconciledSessionPatch,
  buildSilenceClosePatch,
  liveSocWithinSessionWindow,
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

// Regression cases modeled on the July-6 shape: a DC session (16→38%) that got inflated
// to 16→68% and its stopped_at dragged into the following drive, because reconcile
// (a) used the car's current live SOC regardless of the session's own timeframe and
// (b) counted driving samples (positive power_kw, no charge_power_kw) as charging evidence.
const dcSession = {
  ...baseSession,
  start_percent: 16,
  current_percent: 38,
  target_percent: 100,
  battery_capacity_kwh: 45.1,
  charger_power_kw: 28,
  price_per_kwh: 0.65,
  charged_energy_kwh: 9.922,
  estimated_cost: 6.4493,
  status: "stopped",
  started_at: "2026-07-06T05:56:56.676Z",
  stopped_at: "2026-07-06T06:10:05.802Z",
};

test("summarizeSessionTelemetry ignores driving samples (positive power_kw, no charge_power_kw) as charging evidence", () => {
  const summary = summarizeSessionTelemetry(
    [
      { device_time: "2026-07-06T05:56:56.676Z", telemetry: { soc: 16, charge_power_kw: 28 } },
      { device_time: "2026-07-06T06:10:05.802Z", telemetry: { soc: 38, charge_power_kw: 0 } },
      // driving home: no charge_power_kw, positive traction power_kw, highway speed
      { device_time: "2026-07-06T06:35:19.414Z", telemetry: { soc: 30, power_kw: 15, speed_kmh: 105 } },
    ],
    dcSession,
  );
  assert.equal(summary.lastAcChargeAt, "2026-07-06T05:56:56.676Z");
  assert.equal(summary.maxSoc, 38);
});

test("buildReconciledSessionPatch does not extend stopped_at into a later drive", () => {
  const summary = summarizeSessionTelemetry(
    [
      { device_time: "2026-07-06T05:56:56.676Z", telemetry: { soc: 16, charge_power_kw: 28 } },
      { device_time: "2026-07-06T06:10:05.802Z", telemetry: { soc: 38, charge_power_kw: 0 } },
      { device_time: "2026-07-06T06:35:19.414Z", telemetry: { soc: 30, power_kw: 15, speed_kmh: 105 } },
    ],
    dcSession,
  );
  const patch = buildReconciledSessionPatch({
    session: dcSession,
    summary,
    liveSoc: null,
    nowMs: Date.parse("2026-07-06T09:00:00Z"),
  });
  // Already matches (stored values derived from SOC 38, stopped_at valid) → no-op.
  assert.equal(patch, null);
});

test("buildReconciledSessionPatch does not absorb a later session's live SOC outside its window", () => {
  // Simulates the orchestrator-level scoping: a live snapshot from the *next* (AC) charge,
  // hours after this DC session closed, must not be passed in as this session's liveSoc.
  const summary = summarizeSessionTelemetry(
    [
      { device_time: "2026-07-06T05:56:56.676Z", telemetry: { soc: 16, charge_power_kw: 28 } },
      { device_time: "2026-07-06T06:10:05.802Z", telemetry: { soc: 38, charge_power_kw: 0 } },
    ],
    dcSession,
  );
  // liveSoc: null represents the scoped-out result (snapshot's received_at was outside
  // [started_at, stopped_at + 5min], so the caller passes null instead of 68).
  const patch = buildReconciledSessionPatch({
    session: { ...dcSession, current_percent: 68, charged_energy_kwh: 23.452, estimated_cost: 15.2438 },
    summary,
    liveSoc: null,
    nowMs: Date.parse("2026-07-06T09:00:00Z"),
  });
  assert.ok(patch);
  assert.equal(patch.current_percent, 38);
  assert.ok(patch.charged_energy_kwh < 15);
});

test("buildReconciledSessionPatch does not collapse a session with no SOC telemetry in window and no live SOC", () => {
  const summary = summarizeSessionTelemetry([], dcSession);
  const patch = buildReconciledSessionPatch({
    session: { ...dcSession, current_percent: 68, charged_energy_kwh: 23.452, estimated_cost: 15.2438 },
    summary,
    liveSoc: null,
    nowMs: Date.parse("2026-07-06T09:00:00Z"),
  });
  assert.equal(patch, null);
});

test("buildReconciledSessionPatch still trusts live SOC captured within the session's own window", () => {
  // The AC session (85e619d9…): closed at 68% while telemetry only reached 63 — the live
  // snapshot at close time is legitimate evidence and should still win.
  const acSession = {
    ...baseSession,
    start_percent: 31,
    current_percent: 68,
    target_percent: 100,
    battery_capacity_kwh: 45.1,
    charger_power_kw: 4,
    price_per_kwh: 0.2,
    charged_energy_kwh: 16.687,
    estimated_cost: 3.3374,
    status: "stopped",
    started_at: "2026-07-06T06:44:00Z",
    stopped_at: "2026-07-06T10:10:59Z",
  };
  const summary = summarizeSessionTelemetry(
    [
      { device_time: "2026-07-06T06:44:00Z", telemetry: { soc: 31, charge_power_kw: 4 } },
      { device_time: "2026-07-06T09:54:50Z", telemetry: { soc: 63, charge_power_kw: 4 } },
    ],
    acSession,
  );
  const patch = buildReconciledSessionPatch({
    session: acSession,
    summary,
    liveSoc: 68, // scoped-in: snapshot received_at fell within [started_at, stopped_at+5min]
    nowMs: Date.parse("2026-07-06T10:12:00Z"),
  });
  assert.equal(patch, null); // matches stored values already
});

// ── liveSocWithinSessionWindow: corrupt stopped_at shapes ─────────────────────
// A closed session's window end anchors on stopped_at when it's sane, else on
// updated_at (the moment of the botched close). Unparseable everything → no window.

const windowSession = {
  started_at: "2026-07-06T06:44:00Z",
  stopped_at: "2026-07-06T10:10:59Z",
  updated_at: "2026-07-06T10:11:00Z",
};

test("liveSocWithinSessionWindow accepts a snapshot inside a valid window", () => {
  const hit = liveSocWithinSessionWindow(windowSession, {
    received_at: "2026-07-06T10:12:00Z", // within stopped_at + 5min pad
    telemetry: { soc: 68 },
  });
  assert.ok(hit);
  assert.equal(hit.soc, 68);
  assert.equal(hit.receivedMs, Date.parse("2026-07-06T10:12:00Z"));
});

test("liveSocWithinSessionWindow rejects a later charge's snapshot with a corrupt stopped_at string", () => {
  // Regression: stoppedMs = NaN used to collapse the window end to the snapshot's own
  // received_at, so ANY later snapshot passed and a later charge's SOC bled in.
  const hit = liveSocWithinSessionWindow(
    { ...windowSession, stopped_at: "not-a-date" },
    { received_at: "2026-07-08T09:00:00Z", telemetry: { soc: 97 } }, // 2 days later
  );
  assert.equal(hit, null);
});

test("liveSocWithinSessionWindow accepts a close-time snapshot despite stopped_at < started_at", () => {
  // Regression: the backwards-stopped_at corruption (the exact shape reconcile repairs)
  // used to reject every snapshot received after started_at.
  const hit = liveSocWithinSessionWindow(
    { ...windowSession, stopped_at: "2026-07-06T06:00:00Z" }, // before started_at
    { received_at: "2026-07-06T10:12:00Z", telemetry: { soc: 68 } }, // near updated_at
  );
  assert.ok(hit);
  assert.equal(hit.soc, 68);
});

test("liveSocWithinSessionWindow still rejects later snapshots when stopped_at is backwards", () => {
  const hit = liveSocWithinSessionWindow(
    { ...windowSession, stopped_at: "2026-07-06T06:00:00Z" },
    { received_at: "2026-07-08T09:00:00Z", telemetry: { soc: 97 } },
  );
  assert.equal(hit, null);
});

// ── stopped_at candidate bounds ───────────────────────────────────────────────

test("buildReconciledSessionPatch ignores a clock-skewed future stopped_at", () => {
  // Regression: a future stopped_at passed the >= startMs filter, won Math.max, and was
  // written back — the session appeared to run for days.
  const future = {
    ...bmsSession,
    stopped_at: "2026-06-06T07:00:00.000+00:00", // 3 days in the future vs nowMs
  };
  const summary = summarizeSessionTelemetry(
    [
      { device_time: "2026-06-03T07:10:00Z", telemetry: { soc: 40, charge_power_kw: 4 } },
      { device_time: "2026-06-03T07:30:00Z", telemetry: { soc: 49, charge_power_kw: 4 } },
    ],
    future,
  );
  const patch = buildReconciledSessionPatch({
    session: future,
    summary,
    liveSoc: null,
    nowMs: Date.parse("2026-06-03T08:00:00Z"),
  });
  assert.ok(patch);
  assert.equal(patch.stopped_at, new Date(Date.parse("2026-06-03T07:30:00Z")).toISOString());
});

test("buildReconciledSessionPatch returns null instead of inventing a 1-minute duration", () => {
  // Regression: no valid stopped_at, no post-start telemetry, no live SOC → the old
  // fallback stamped stopped_at = started_at + 60s regardless of actual charging time.
  const summary = summarizeSessionTelemetry(
    // Only a pre-start sample (telemetry loads from started_at - 5min).
    [{ device_time: "2026-06-03T07:03:00Z", telemetry: { soc: 71 } }],
    baseSession, // stopped_at is backwards → invalid
  );
  const patch = buildReconciledSessionPatch({
    session: baseSession,
    summary,
    liveSoc: null,
    nowMs: Date.parse("2026-06-03T12:00:00Z"),
  });
  assert.equal(patch, null);
});

test("buildReconciledSessionPatch anchors stopped_at to the live snapshot when it is the only evidence", () => {
  const receivedMs = Date.parse("2026-06-03T10:05:00Z");
  const summary = summarizeSessionTelemetry([], baseSession); // no telemetry at all
  const patch = buildReconciledSessionPatch({
    session: baseSession, // backwards stopped_at → invalid
    summary,
    liveSoc: 100,
    liveSocReceivedMs: receivedMs,
    nowMs: Date.parse("2026-06-03T12:00:00Z"),
  });
  assert.ok(patch);
  assert.equal(patch.status, "completed");
  assert.equal(patch.stopped_at, new Date(receivedMs).toISOString());
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
