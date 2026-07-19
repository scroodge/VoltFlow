import test from "node:test";
import assert from "node:assert/strict";

import {
  liveStatusChargingPayload,
  liveStatusPhaseForSample,
  nextLiveStatusState,
} from "./live-status-notifications.ts";

const T0 = "2026-07-19T10:00:00.000Z";

function at(minutes, seconds = 0) {
  return new Date(Date.parse(T0) + minutes * 60_000 + seconds * 1000).toISOString();
}

test("charge start sends immediately, then throttles to one update per minute", () => {
  const start = nextLiveStatusState({
    previousState: null,
    phase: "charging",
    soc: 55,
    deviceTime: T0,
    mode: "charging",
  });
  assert.equal(start.action, "update");
  assert.equal(start.nextState.chargeStartedAt, T0);
  assert.equal(start.nextState.chargeStartSoc, 55);

  const tooSoon = nextLiveStatusState({
    previousState: start.nextState,
    phase: "charging",
    soc: 55,
    deviceTime: at(0, 30),
    mode: "charging",
  });
  assert.equal(tooSoon.action, "none");
  assert.equal(tooSoon.nextState.lastSentAt, T0);

  const due = nextLiveStatusState({
    previousState: tooSoon.nextState,
    phase: "charging",
    soc: 56,
    deviceTime: at(1),
    mode: "charging",
  });
  assert.equal(due.action, "update");
  assert.equal(due.nextState.lastSentAt, at(1));
  // Charge anchor survives across updates for delta/ETA math.
  assert.equal(due.nextState.chargeStartedAt, T0);
  assert.equal(due.nextState.chargeStartSoc, 55);
});

test("charge end sends one final and resets the charge anchor", () => {
  const charging = {
    lastState: "charging",
    lastSentAt: at(30),
    lastSoc: 70,
    chargeStartedAt: T0,
    chargeStartSoc: 55,
  };

  const final = nextLiveStatusState({
    previousState: charging,
    phase: "parked",
    soc: 80,
    deviceTime: at(60),
    mode: "charging",
  });
  assert.equal(final.action, "final");
  assert.equal(final.nextState.lastState, "parked");
  assert.equal(final.nextState.chargeStartedAt, null);
  assert.equal(final.nextState.chargeStartSoc, null);

  // Mode "charging": subsequent parked samples stay silent.
  const parkedAfter = nextLiveStatusState({
    previousState: final.nextState,
    phase: "parked",
    soc: 80,
    deviceTime: at(61),
    mode: "charging",
  });
  assert.equal(parkedAfter.action, "none");
});

test("drive-away during charge still sends the final", () => {
  const result = nextLiveStatusState({
    previousState: {
      lastState: "charging",
      lastSentAt: at(10),
      lastSoc: 62,
      chargeStartedAt: T0,
      chargeStartSoc: 55,
    },
    phase: "driving",
    soc: 62,
    deviceTime: at(11),
    mode: "charging",
  });
  assert.equal(result.action, "final");
  assert.equal(result.nextState.lastState, "driving");
});

test("parked mode sends on transition, SOC drift, and 30 min heartbeat only", () => {
  const transition = nextLiveStatusState({
    previousState: {
      lastState: "driving",
      lastSentAt: null,
      lastSoc: null,
      chargeStartedAt: null,
      chargeStartSoc: null,
    },
    phase: "parked",
    soc: 71,
    deviceTime: T0,
    mode: "charging_parked",
  });
  assert.equal(transition.action, "update");

  const steady = nextLiveStatusState({
    previousState: transition.nextState,
    phase: "parked",
    soc: 71,
    deviceTime: at(10),
    mode: "charging_parked",
  });
  assert.equal(steady.action, "none");

  const drifted = nextLiveStatusState({
    previousState: steady.nextState,
    phase: "parked",
    soc: 70,
    deviceTime: at(15),
    mode: "charging_parked",
  });
  assert.equal(drifted.action, "update");

  const heartbeat = nextLiveStatusState({
    previousState: drifted.nextState,
    phase: "parked",
    soc: 70,
    deviceTime: at(15 + 31),
    mode: "charging_parked",
  });
  assert.equal(heartbeat.action, "update");
});

test("parked is silent in charging-only mode; drive-away clears only in parked mode", () => {
  const parkedChargingOnly = nextLiveStatusState({
    previousState: null,
    phase: "parked",
    soc: 71,
    deviceTime: T0,
    mode: "charging",
  });
  assert.equal(parkedChargingOnly.action, "none");
  assert.equal(parkedChargingOnly.nextState.lastState, "parked");

  const parkedState = {
    lastState: "parked",
    lastSentAt: T0,
    lastSoc: 71,
    chargeStartedAt: null,
    chargeStartSoc: null,
  };

  const clearInParkedMode = nextLiveStatusState({
    previousState: parkedState,
    phase: "driving",
    soc: 71,
    deviceTime: at(5),
    mode: "charging_parked",
  });
  assert.equal(clearInParkedMode.action, "clear");

  const silentInChargingMode = nextLiveStatusState({
    previousState: parkedState,
    phase: "driving",
    soc: 71,
    deviceTime: at(5),
    mode: "charging",
  });
  assert.equal(silentInChargingMode.action, "none");
});

test("charging payload includes power, delta since start, and rate-based ETA", () => {
  const payload = liveStatusChargingPayload({
    vehicleId: "way",
    soc: 65,
    chargePowerKw: 6.6,
    state: {
      lastState: "charging",
      lastSentAt: at(30),
      lastSoc: 65,
      chargeStartedAt: T0,
      chargeStartSoc: 50,
    },
    deviceTime: at(30),
  });

  assert.equal(payload.title, "⚡ Charging · 65%");
  assert.equal(payload.tag, "voltflow-live:way");
  assert.equal(payload.renotify, false);
  assert.equal(payload.silent, true);
  // 15% in 30 min → 0.5 %/min → 35% remaining → 70 min.
  assert.equal(payload.body, "6.6 kW · +15% this charge · ~1 h 10 m to 100%");
});

test("phase detection: drive gear wins, then speed, then charging, else parked", () => {
  const base = { vehicle_id: "way", device_time: T0, source: "BYDMate", schema_version: 1 };

  assert.equal(
    liveStatusPhaseForSample({
      ...base,
      telemetry: { speed_kmh: 0, charge_power_kw: 6 },
      diplus: { gear: "D" },
    }),
    "driving",
  );
  assert.equal(
    liveStatusPhaseForSample({ ...base, telemetry: { speed_kmh: 30 } }),
    "driving",
  );
  assert.equal(
    liveStatusPhaseForSample({ ...base, telemetry: { speed_kmh: 0, charge_power_kw: 6.6 } }),
    "charging",
  );
  // Gun explicitly unplugged (1) with stale is_charging → parked, not charging.
  assert.equal(
    liveStatusPhaseForSample({
      ...base,
      telemetry: { speed_kmh: 0, is_charging: true, charge_power_kw: 0 },
      diplus: { charge_gun_state: 1 },
    }),
    "parked",
  );
  assert.equal(
    liveStatusPhaseForSample({ ...base, telemetry: { speed_kmh: 0 } }),
    "parked",
  );
});
