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

test("stops an active session when charge_power_kw/SOC are frozen for 10+ minutes", () => {
  // Reproduces car `way`'s stuck-value glitch: charging genuinely ended, gun stays
  // plugged in, but Di+ keeps echoing the exact same last SOC/charge_power_kw on every
  // parked heartbeat (`is_charging` still reports charging throughout, since it too is
  // stale). Without frozen-value detection this would hold the session open forever.
  let state = null;
  let action = { type: "none" };
  for (let minute = 0; minute <= 11; minute += 1) {
    const step = nextAutoChargingSessionStep({
      state,
      isCharging: true,
      soc: 80,
      speedKmh: 0,
      hasActiveSession: true,
      chargerPowerKw: 5.8,
      rawChargePowerKw: 5.8,
      deviceTime: at(minute),
    });
    state = step.state;
    action = step.action;
    if (minute < 11) assert.equal(action.type, "none", `minute ${minute}`);
  }
  assert.equal(action.type, "stop");
  assert.equal(action.currentPercent, 80);
});

test("does not stop a genuinely stable charge whose SOC keeps advancing", () => {
  // Same unchanging charge_power_kw for a long stretch, but SOC keeps climbing — a real
  // flat-rate AC charge, not a stale reading. Must never be mistaken for frozen telemetry.
  let state = null;
  let action = { type: "none" };
  for (let minute = 0; minute <= 14; minute += 1) {
    const step = nextAutoChargingSessionStep({
      state,
      isCharging: true,
      soc: 70 + minute,
      speedKmh: 0,
      hasActiveSession: true,
      chargerPowerKw: 5.8,
      rawChargePowerKw: 5.8,
      deviceTime: at(minute),
    });
    state = step.state;
    action = step.action;
    assert.equal(action.type, "none", `minute ${minute}`);
  }
});

test("frozen-value detection is skipped without a raw charge_power_kw reading", () => {
  // Cars/firmware that never populate charge_power_kw rely on the is_charging boolean
  // alone; that path is unaffected by this fix and must keep behaving as before.
  let state = null;
  let action = { type: "none" };
  for (let minute = 0; minute <= 14; minute += 1) {
    const step = nextAutoChargingSessionStep({
      state,
      isCharging: true,
      soc: 80,
      speedKmh: 0,
      hasActiveSession: true,
      chargerPowerKw: null,
      deviceTime: at(minute),
    });
    state = step.state;
    action = step.action;
    assert.equal(action.type, "none", `minute ${minute}`);
  }
});

test("stops an open session after a sustained run of explicit zero charge power", () => {
  // Charger stopped with the gun still in the car (AC). Di+ keeps is_charging true, so
  // the keep-alive predicate holds the session open, and SOC drifts down from standby
  // draw — which defeats the frozen-reading check, since it needs SOC bit-identical.
  // Only the zero-power stall can end this. Car `way`, 2026-08-26.
  const socAt = (minute) => (minute < 2 ? 100 : minute < 4 ? 99.9 : 99.8);
  let state = null;
  let action = { type: "none" };
  let stoppedAtMinute = null;
  for (let minute = 0; minute <= 6 && stoppedAtMinute == null; minute += 1) {
    const step = nextAutoChargingSessionStep({
      state,
      isCharging: true,
      canStartSession: false,
      soc: socAt(minute),
      speedKmh: 0,
      hasActiveSession: true,
      chargerPowerKw: 4.4,
      rawChargePowerKw: 0,
      deviceTime: at(minute),
    });
    state = step.state;
    action = step.action;
    if (action.type === "stop") stoppedAtMinute = minute;
    else assert.equal(action.type, "none", `minute ${minute}`);
  }
  // AUTO_CHARGING_ZERO_POWER_STALL_MS is 5 minutes, measured from the first zero sample.
  assert.equal(stoppedAtMinute, 5);
  assert.equal(action.currentPercent, 99.8);
});

test("a brief zero-kW blip mid-charge does not stop the session", () => {
  // Genuine charges report the odd zero reading; only a sustained run may end a session.
  let state = null;
  for (let minute = 0; minute <= 12; minute += 1) {
    const blip = minute === 4 || minute === 5;
    const step = nextAutoChargingSessionStep({
      state,
      isCharging: true,
      canStartSession: !blip,
      soc: 70 + minute,
      speedKmh: 0,
      hasActiveSession: true,
      chargerPowerKw: 4.4,
      rawChargePowerKw: blip ? 0 : 4.4,
      deviceTime: at(minute),
    });
    state = step.state;
    assert.equal(step.action.type, "none", `minute ${minute}`);
  }
});

test("no charge power means no measurement, not zero — the stall must not fire", () => {
  // Firmware that never populates charge_power_kw must keep behaving as before.
  let state = null;
  for (let minute = 0; minute <= 12; minute += 1) {
    const step = nextAutoChargingSessionStep({
      state,
      isCharging: true,
      canStartSession: false,
      soc: 80,
      speedKmh: 0,
      hasActiveSession: true,
      chargerPowerKw: null,
      rawChargePowerKw: null,
      deviceTime: at(minute),
    });
    state = step.state;
    assert.equal(step.action.type, "none", `minute ${minute}`);
  }
});

test("plugged in at zero power never starts a session, however long it sits there", () => {
  let state = null;
  for (let minute = 0; minute <= 30; minute += 1) {
    const step = nextAutoChargingSessionStep({
      state,
      isCharging: true,
      canStartSession: false,
      soc: 99.8,
      speedKmh: 0,
      hasActiveSession: false,
      chargerPowerKw: 4.4,
      rawChargePowerKw: 0,
      deviceTime: at(minute),
    });
    state = step.state;
    assert.equal(step.action.type, "none", `minute ${minute}`);
  }
});

test("a delayed-start charger backdates to the SOC it sat at while plugged in and idle", () => {
  // Plugged in at 40% for hours with the charger idle, then real power arrives. The
  // plugged-but-idle samples are the correct pre-charge baseline, so the session must
  // start from 40 — not from whatever SOC the confirming sample happens to carry.
  let state = null;
  for (let minute = 0; minute <= 3; minute += 1) {
    state = nextAutoChargingSessionStep({
      state,
      isCharging: true,
      canStartSession: false,
      soc: 40,
      speedKmh: 0,
      hasActiveSession: false,
      chargerPowerKw: 4.4,
      rawChargePowerKw: 0,
      deviceTime: at(minute),
    }).state;
  }

  let action = { type: "none" };
  for (let minute = 4; minute <= 7; minute += 1) {
    const step = nextAutoChargingSessionStep({
      state,
      isCharging: true,
      canStartSession: true,
      soc: 40 + (minute - 4),
      speedKmh: 0,
      hasActiveSession: false,
      chargerPowerKw: 4.4,
      rawChargePowerKw: 4.4,
      deviceTime: at(minute),
    });
    state = step.state;
    action = step.action;
  }
  assert.equal(action.type, "start");
  assert.equal(action.startPercent, 40);
  assert.equal(action.startedAt, at(4));
});
