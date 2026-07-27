import test from "node:test";
import assert from "node:assert/strict";

import { nextAutoChargingSessionStep } from "./charging-auto-session-step.ts";

/** Minutes past a fixed epoch, as an ISO device_time. */
const at = (minutes) => new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + minutes * 60_000).toISOString();

test("starts after four consecutive parked charging samples", () => {
  let state = null;
  for (let i = 0; i < 3; i += 1) {
    const step = nextAutoChargingSessionStep({
      state,
      isCharging: true,
      soc: 54 + i,
      speedKmh: 0,
      hasActiveSession: false,
      chargerPowerKw: 4,
      deviceTime: at(i),
    });
    assert.equal(step.action.type, "none");
    state = step.state;
  }
  const fourth = nextAutoChargingSessionStep({
    state,
    isCharging: true,
    soc: 57,
    speedKmh: 0,
    hasActiveSession: false,
    chargerPowerKw: 4,
    deviceTime: at(3),
  });
  assert.equal(fourth.action.type, "start");
  // Backdated to the streak's first charging sample, not the confirming one.
  assert.equal(fourth.action.startPercent, 54);
  assert.equal(fourth.action.startedAt, at(0));
});

test("backdates a 1 sample/min DC charge to the pre-charge SOC", () => {
  // Reproduces a real fast-DC session: the car arrives at 46%, telemetry drops out
  // while parking, then charging samples land once a minute. Without backdating the
  // session opened at 56% and lost ~10% SOC of energy.
  let state = nextAutoChargingSessionStep({
    state: null,
    isCharging: false,
    soc: 46,
    speedKmh: 61,
    hasActiveSession: false,
    chargerPowerKw: null,
    deviceTime: at(0),
  }).state;

  let action = { type: "none" };
  const chargingSocs = [
    [3, 49],
    [4, 51],
    [5, 54],
    [6, 56],
  ];
  for (const [minute, soc] of chargingSocs) {
    const step = nextAutoChargingSessionStep({
      state,
      isCharging: true,
      soc,
      speedKmh: 0,
      hasActiveSession: false,
      chargerPowerKw: 66,
      deviceTime: at(minute),
    });
    state = step.state;
    action = step.action;
  }

  assert.equal(action.type, "start");
  assert.equal(action.startPercent, 46);
  assert.equal(action.startedAt, at(3));
});

test("ignores a stale idle reading and falls back to the first charging sample", () => {
  let state = nextAutoChargingSessionStep({
    state: null,
    isCharging: false,
    soc: 46,
    speedKmh: 0,
    hasActiveSession: false,
    chargerPowerKw: null,
    deviceTime: at(0),
  }).state;

  let action = { type: "none" };
  // Telemetry resumes 45 minutes later — the car may have driven since, so the 46%
  // reading is no longer trustworthy as the pre-charge SOC.
  for (let i = 0; i < 4; i += 1) {
    const step = nextAutoChargingSessionStep({
      state,
      isCharging: true,
      soc: 60 + i,
      speedKmh: 0,
      hasActiveSession: false,
      chargerPowerKw: 50,
      deviceTime: at(45 + i),
    });
    state = step.state;
    action = step.action;
  }

  assert.equal(action.type, "start");
  assert.equal(action.startPercent, 60);
  assert.equal(action.startedAt, at(45));
});

test("never backdates to an idle SOC above the first charging sample", () => {
  let state = nextAutoChargingSessionStep({
    state: null,
    isCharging: false,
    soc: 80,
    speedKmh: 0,
    hasActiveSession: false,
    chargerPowerKw: null,
    deviceTime: at(0),
  }).state;

  let action = { type: "none" };
  // The car discharged to 40% before charging began; the 80% idle reading must not be
  // used as the start SOC or the session would claim energy that was never delivered.
  for (let i = 0; i < 4; i += 1) {
    const step = nextAutoChargingSessionStep({
      state,
      isCharging: true,
      soc: 40 + i,
      speedKmh: 0,
      hasActiveSession: false,
      chargerPowerKw: 7,
      deviceTime: at(1 + i),
    });
    state = step.state;
    action = step.action;
  }

  assert.equal(action.type, "start");
  assert.equal(action.startPercent, 40);
  assert.equal(action.startedAt, at(1));
});

test("driving resets charging sample counter before start", () => {
  const moving = nextAutoChargingSessionStep({
    state: {
      consecutiveChargingSamples: 3,
      consecutiveUnplugSamples: 0,
      lastIsCharging: true,
      streakStartPercent: 82,
      streakStartDeviceTime: at(0),
      lastIdlePercent: null,
      lastIdleDeviceTime: null,
    },
    isCharging: false,
    soc: 84,
    speedKmh: 40,
    hasActiveSession: false,
    chargerPowerKw: null,
    deviceTime: at(3),
  });
  assert.equal(moving.state.consecutiveChargingSamples, 0);
  assert.equal(moving.state.streakStartPercent, null);
  assert.equal(moving.action.type, "none");
});

test("stops active session after two consecutive unplug samples", () => {
  const first = nextAutoChargingSessionStep({
    state: null,
    isCharging: false,
    soc: 72,
    speedKmh: 0,
    hasActiveSession: true,
    chargerPowerKw: null,
    deviceTime: at(0),
  });
  assert.equal(first.action.type, "none");

  const second = nextAutoChargingSessionStep({
    state: first.state,
    isCharging: false,
    soc: 72,
    speedKmh: 0,
    hasActiveSession: true,
    chargerPowerKw: null,
    deviceTime: at(1),
  });
  assert.equal(second.action.type, "stop");
  assert.equal(second.action.currentPercent, 72);
});

test("stops immediately on drive-away during an active session", () => {
  const step = nextAutoChargingSessionStep({
    state: null,
    isCharging: false,
    soc: 68,
    speedKmh: 18,
    hasActiveSession: true,
    chargerPowerKw: null,
    deviceTime: at(0),
  });
  assert.equal(step.action.type, "stop");
  assert.equal(step.action.currentPercent, 68);
});
