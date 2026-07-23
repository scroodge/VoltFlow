import test from "node:test";
import assert from "node:assert/strict";

import { resolveChargingSessionSampleWindow } from "./telemetry-session-window.ts";
import {
  enumerateCalendarDays,
  fetchChargingSessionSamples,
  parseSohPercent,
} from "./telemetry-history.ts";
import { medianSampleGapSeconds } from "./telemetry-ranges.ts";

test("extends completed charging sample window to include delayed target samples", () => {
  const window = resolveChargingSessionSampleWindow({
    status: "completed",
    startedAt: "2026-05-26T06:28:59.855Z",
    stoppedAt: "2026-05-26T09:20:49.834Z",
    updatedAt: "2026-05-26T09:20:49.915Z",
    currentPercent: 100,
    targetPercent: 100,
  });

  assert.equal(window.from, "2026-05-26T06:28:59.855Z");
  assert.equal(window.to, "2026-05-26T09:30:49.834Z");
});

test("does not extend manually stopped charging sample windows", () => {
  const window = resolveChargingSessionSampleWindow({
    status: "stopped",
    startedAt: "2026-05-26T06:28:59.855Z",
    stoppedAt: "2026-05-26T09:20:49.834Z",
    updatedAt: "2026-05-26T09:20:49.915Z",
    currentPercent: 99,
    targetPercent: 100,
  });

  assert.equal(window.to, "2026-05-26T09:20:49.834Z");
});

test("medianSampleGapSeconds returns null for fewer than two timestamps", () => {
  assert.equal(medianSampleGapSeconds([]), null);
  assert.equal(medianSampleGapSeconds(["2026-05-31T10:00:00.000Z"]), null);
});

test("parseSohPercent accepts numeric and string SOH values", () => {
  assert.equal(parseSohPercent({ soh_percent: 99 }), 99);
  assert.equal(parseSohPercent({ soh_percent: "98.5" }), 98.5);
  assert.equal(parseSohPercent({ soh_percent: null }), null);
  assert.equal(parseSohPercent({ soh_percent: 120 }), null);
});

test("enumerateCalendarDays includes inclusive UTC day bounds", () => {
  const days = enumerateCalendarDays("2026-06-08T12:00:00.000Z", "2026-06-10T01:00:00.000Z");
  assert.deepEqual(days, ["2026-06-08", "2026-06-09", "2026-06-10"]);
});

test("medianSampleGapSeconds computes median gap in seconds", () => {
  const gap = medianSampleGapSeconds([
    "2026-05-31T10:00:00.000Z",
    "2026-05-31T10:00:01.000Z",
    "2026-05-31T10:00:03.000Z",
  ]);

  assert.equal(gap, 2);
});

test("charging-session history excludes traction power and stale unplugged samples", async () => {
  const session = {
    id: "session-1",
    user_id: "user-1",
    status: "stopped",
    started_at: "2026-07-23T10:00:00.000Z",
    stopped_at: "2026-07-23T10:10:00.000Z",
    updated_at: "2026-07-23T10:10:00.000Z",
    created_at: "2026-07-23T10:00:00.000Z",
    current_percent: 60,
    target_percent: 80,
  };
  const samples = [
    {
      device_time: "2026-07-23T10:01:00.000Z",
      telemetry: { power_kw: 32, charge_power_kw: null, is_charging: false },
      diplus_charge_gun_state: null,
    },
    {
      device_time: "2026-07-23T10:02:00.000Z",
      telemetry: { power_kw: 0, charge_power_kw: 4.2, is_charging: true },
      diplus_charge_gun_state: 2,
    },
    {
      device_time: "2026-07-23T10:03:00.000Z",
      telemetry: { power_kw: 0, charge_power_kw: 1, is_charging: true },
      diplus_charge_gun_state: 1,
    },
  ];
  const supabase = {
    from(table) {
      const query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        match() {
          return query;
        },
        gte() {
          return query;
        },
        lte() {
          return query;
        },
        order() {
          return query;
        },
        maybeSingle: async () => ({ data: table === "charging_sessions" ? session : null, error: null }),
        range: async () => ({ data: table === "bydmate_telemetry_samples" ? samples : [], error: null }),
      };
      return query;
    },
  };

  const points = await fetchChargingSessionSamples({
    supabase,
    userId: "user-1",
    sessionId: "session-1",
    vehicleId: "car-1",
  });

  assert.deepEqual(points.map((point) => point.device_time), ["2026-07-23T10:02:00.000Z"]);
  assert.equal(Object.hasOwn(points[0], "diplus_charge_gun_state"), false);
});

test("charging-session history excludes traction power and stale unplugged samples", async () => {
  const session = {
    id: "session-1",
    user_id: "user-1",
    status: "stopped",
    started_at: "2026-07-23T10:00:00.000Z",
    stopped_at: "2026-07-23T10:10:00.000Z",
    updated_at: "2026-07-23T10:10:00.000Z",
    created_at: "2026-07-23T10:00:00.000Z",
    current_percent: 60,
    target_percent: 80,
  };
  const samples = [
    {
      device_time: "2026-07-23T10:01:00.000Z",
      telemetry: { power_kw: 32, charge_power_kw: null, is_charging: false },
      diplus_charge_gun_state: null,
    },
    {
      device_time: "2026-07-23T10:02:00.000Z",
      telemetry: { power_kw: 0, charge_power_kw: 4.2, is_charging: true },
      diplus_charge_gun_state: 2,
    },
    {
      device_time: "2026-07-23T10:03:00.000Z",
      telemetry: { power_kw: 0, charge_power_kw: 1, is_charging: true },
      diplus_charge_gun_state: 1,
    },
  ];
  const supabase = {
    from(table) {
      const query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        match() {
          return query;
        },
        gte() {
          return query;
        },
        lte() {
          return query;
        },
        order() {
          return query;
        },
        maybeSingle: async () => ({ data: table === "charging_sessions" ? session : null, error: null }),
        range: async () => ({ data: table === "bydmate_telemetry_samples" ? samples : [], error: null }),
      };
      return query;
    },
  };

  const points = await fetchChargingSessionSamples({
    supabase,
    userId: "user-1",
    sessionId: "session-1",
    vehicleId: "car-1",
  });

  assert.deepEqual(points.map((point) => point.device_time), ["2026-07-23T10:02:00.000Z"]);
});
