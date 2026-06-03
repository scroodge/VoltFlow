import test from "node:test";
import assert from "node:assert/strict";

import { nextAutoChargingSessionStep } from "./charging-auto-session-step.ts";

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
  });
  assert.equal(fourth.action.type, "start");
  assert.equal(fourth.action.startPercent, 57);
});

test("driving resets charging sample counter before start", () => {
  const moving = nextAutoChargingSessionStep({
    state: { consecutiveChargingSamples: 3, consecutiveUnplugSamples: 0, lastIsCharging: true },
    isCharging: false,
    soc: 84,
    speedKmh: 40,
    hasActiveSession: false,
    chargerPowerKw: null,
  });
  assert.equal(moving.state.consecutiveChargingSamples, 0);
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
  });
  assert.equal(first.action.type, "none");

  const second = nextAutoChargingSessionStep({
    state: first.state,
    isCharging: false,
    soc: 72,
    speedKmh: 0,
    hasActiveSession: true,
    chargerPowerKw: null,
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
  });
  assert.equal(step.action.type, "stop");
  assert.equal(step.action.currentPercent, 68);
});
