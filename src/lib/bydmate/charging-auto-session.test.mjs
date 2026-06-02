import test from "node:test";
import assert from "node:assert/strict";

import { nextAutoChargingSessionStep } from "./charging-auto-session-step.ts";

test("starts after two consecutive charging samples without an active session", () => {
  const first = nextAutoChargingSessionStep({
    state: null,
    isCharging: true,
    soc: 54,
    speedKmh: 0,
    hasActiveSession: false,
    chargerPowerKw: 4,
  });
  assert.equal(first.action.type, "none");
  assert.equal(first.state.consecutiveChargingSamples, 1);

  const second = nextAutoChargingSessionStep({
    state: first.state,
    isCharging: true,
    soc: 55,
    speedKmh: 0,
    hasActiveSession: false,
    chargerPowerKw: 4,
  });
  assert.equal(second.action.type, "start");
  assert.equal(second.action.startPercent, 55);
  assert.equal(second.action.chargerPowerKw, 4);
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
