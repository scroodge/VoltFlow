import assert from "node:assert/strict";
import test from "node:test";

import {
  canStartChargingSession,
  deriveDashboardVehicleMode,
  isDrivingTelemetry,
  isParkedTelemetry,
} from "./vehicle-live-mode.ts";

const NOW = Date.UTC(2026, 4, 30, 12, 0, 0);

function snapshot(overrides = {}) {
  return {
    id: "snap-1",
    user_id: "user-1",
    vehicle_id: "way",
    device_time: new Date(NOW).toISOString(),
    received_at: new Date(NOW).toISOString(),
    telemetry: {
      soc: 73,
      speed_kmh: 0,
      is_charging: false,
      charge_power_kw: 0,
    },
    ...overrides,
  };
}

test("moving-live → driving", () => {
  const mode = deriveDashboardVehicleMode({
    snapshot: snapshot({ telemetry: { soc: 73, speed_kmh: 38, is_charging: false } }),
    nowMs: NOW,
    hasActiveSession: false,
  });
  assert.equal(mode, "driving");
  assert.equal(canStartChargingSession(mode), false);
});

test("parked-idle → parked", () => {
  const mode = deriveDashboardVehicleMode({
    snapshot: snapshot(),
    nowMs: NOW,
    hasActiveSession: false,
  });
  assert.equal(mode, "parked");
  assert.equal(canStartChargingSession(mode), true);
});

test("gear P at zero speed → parked", () => {
  const snap = snapshot({
    diplus: { gear: 1 },
    telemetry: { soc: 60, speed_kmh: 0, is_charging: false },
  });
  assert.equal(isParkedTelemetry(snap), true);
  assert.equal(isDrivingTelemetry(snap), false);
  assert.equal(
    deriveDashboardVehicleMode({ snapshot: snap, nowMs: NOW, hasActiveSession: false }),
    "parked",
  );
});

test("gear D at zero speed → driving", () => {
  const snap = snapshot({
    diplus: { gear: 4 },
    telemetry: { soc: 60, speed_kmh: 0, is_charging: false },
  });
  assert.equal(isParkedTelemetry(snap), false);
  assert.equal(isDrivingTelemetry(snap), true);
});

test("speed above 5 km/h → driving without gear", () => {
  const snap = snapshot({ telemetry: { soc: 60, speed_kmh: 6, is_charging: false } });
  assert.equal(isDrivingTelemetry(snap), true);
});

test("stationary-charging → live_charging", () => {
  const mode = deriveDashboardVehicleMode({
    snapshot: snapshot({
      telemetry: { soc: 58, speed_kmh: 0, is_charging: true, charge_power_kw: 7.4 },
    }),
    nowMs: NOW,
    hasActiveSession: false,
  });
  assert.equal(mode, "live_charging");
  assert.equal(canStartChargingSession(mode), true);
});

test("stale-driving → stale", () => {
  const mode = deriveDashboardVehicleMode({
    snapshot: snapshot({
      received_at: new Date(NOW - 120_000).toISOString(),
      telemetry: { soc: 50, speed_kmh: 50, is_charging: false },
    }),
    nowMs: NOW,
    hasActiveSession: false,
  });
  assert.equal(mode, "stale");
  assert.equal(canStartChargingSession(mode), true);
});

test("app-session-wins over driving telemetry", () => {
  const mode = deriveDashboardVehicleMode({
    snapshot: snapshot({ telemetry: { soc: 73, speed_kmh: 38, is_charging: false } }),
    nowMs: NOW,
    hasActiveSession: true,
  });
  assert.equal(mode, "app_charging");
});

test("isDrivingTelemetry respects charging flag", () => {
  assert.equal(
    isDrivingTelemetry(
      snapshot({ telemetry: { speed_kmh: 40, is_charging: true, charge_power_kw: 7 } }),
    ),
    false,
  );
});
