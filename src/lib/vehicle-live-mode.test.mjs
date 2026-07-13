import assert from "node:assert/strict";
import test from "node:test";

import {
  canStartChargingSession,
  deriveDashboardVehicleMode,
  isChargingTelemetry,
  isDrivingTelemetry,
  isParkedTelemetry,
  vehicleStatusLabelKey,
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

test("unknown gear idle → parked (parking)", () => {
  const mode = deriveDashboardVehicleMode({
    snapshot: snapshot(),
    nowMs: NOW,
    hasActiveSession: false,
  });
  assert.equal(mode, "parked");
  assert.equal(vehicleStatusLabelKey(mode), "vehicle.status.parking");
  assert.equal(canStartChargingSession(mode), true);
});

test("gear P fresh not charging → parked", () => {
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

test("gear P fresh charging → live_charging", () => {
  const snap = snapshot({
    diplus: { gear: 1 },
    telemetry: { soc: 58, speed_kmh: 0, is_charging: true, charge_power_kw: 7.4 },
  });
  assert.equal(
    deriveDashboardVehicleMode({ snapshot: snap, nowMs: NOW, hasActiveSession: false }),
    "live_charging",
  );
});

test("gear P stale → stale", () => {
  const mode = deriveDashboardVehicleMode({
    snapshot: snapshot({
      diplus: { gear: 1 },
      received_at: new Date(NOW - 120_000).toISOString(),
      telemetry: { soc: 60, speed_kmh: 0, is_charging: false },
    }),
    nowMs: NOW,
    hasActiveSession: false,
  });
  assert.equal(mode, "stale");
});

test("gear D at zero speed → driving", () => {
  const snap = snapshot({
    diplus: { gear: 4 },
    telemetry: { soc: 60, speed_kmh: 0, is_charging: false },
  });
  assert.equal(isParkedTelemetry(snap), false);
  assert.equal(isDrivingTelemetry(snap), true);
});

test("gear R at zero speed → driving", () => {
  const snap = snapshot({
    diplus: { gear: 2 },
    telemetry: { soc: 60, speed_kmh: 0, is_charging: false },
  });
  assert.equal(isDrivingTelemetry(snap), true);
});

test("gear N at zero speed → driving", () => {
  const snap = snapshot({
    diplus: { gear: 3 },
    telemetry: { soc: 60, speed_kmh: 0, is_charging: false },
  });
  assert.equal(isDrivingTelemetry(snap), true);
});

test("speed above 5 km/h → driving without gear", () => {
  const snap = snapshot({ telemetry: { soc: 60, speed_kmh: 6, is_charging: false } });
  assert.equal(isDrivingTelemetry(snap), true);
});

test("no gear speed 0 charging → live_charging", () => {
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

test("gear D stale → stale", () => {
  const mode = deriveDashboardVehicleMode({
    snapshot: snapshot({
      diplus: { gear: 4 },
      received_at: new Date(NOW - 120_000).toISOString(),
      telemetry: { soc: 50, speed_kmh: 0, is_charging: false },
    }),
    nowMs: NOW,
    hasActiveSession: false,
  });
  assert.equal(mode, "stale");
});

test("stale driving speed → stale", () => {
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

test("fresh driving telemetry wins over open app session", () => {
  const mode = deriveDashboardVehicleMode({
    snapshot: snapshot({ telemetry: { soc: 73, speed_kmh: 38, is_charging: false } }),
    nowMs: NOW,
    hasActiveSession: true,
  });
  assert.equal(mode, "driving");
});

test("open app session wins when live telemetry is stale", () => {
  const mode = deriveDashboardVehicleMode({
    snapshot: snapshot({
      received_at: new Date(NOW - 120_000).toISOString(),
      telemetry: { soc: 73, speed_kmh: 38, is_charging: false },
    }),
    nowMs: NOW,
    hasActiveSession: true,
  });
  assert.equal(mode, "app_charging");
});

test("traction power_kw while driving → driving, not live_charging", () => {
  const mode = deriveDashboardVehicleMode({
    snapshot: snapshot({
      diplus: { gear: 4 },
      telemetry: { soc: 65, speed_kmh: 42, is_charging: false, power_kw: 28, charge_power_kw: 0 },
    }),
    nowMs: NOW,
    hasActiveSession: false,
  });
  assert.equal(mode, "driving");
});

test("charging in D → driving, not charging", () => {
  const snap = snapshot({
    diplus: { gear: 4 },
    telemetry: { soc: 65, speed_kmh: 20, is_charging: true, charge_power_kw: 7 },
  });
  assert.equal(isChargingTelemetry(snap), false);
  assert.equal(
    deriveDashboardVehicleMode({ snapshot: snap, nowMs: NOW, hasActiveSession: false }),
    "driving",
  );
});

test("gear P gun unplugged with stale is_charging flag → parked", () => {
  const snap = snapshot({
    diplus: { gear: 1, charge_gun_state: 1, charging_status: 1 },
    telemetry: { soc: 32, speed_kmh: 0, is_charging: true },
  });
  assert.equal(
    deriveDashboardVehicleMode({ snapshot: snap, nowMs: NOW, hasActiveSession: false }),
    "parked",
  );
});

test("parked AC charging blocks driving mode", () => {
  assert.equal(
    isDrivingTelemetry(
      snapshot({ telemetry: { speed_kmh: 0, is_charging: true, charge_power_kw: 7 } }),
    ),
    false,
  );
});

test("no snapshot at all → stale, not parked", () => {
  // A car that has never reported is out of contact. Reporting "parked" claimed a
  // state we had no evidence for, and showed "Parking" on a dashboard with no data.
  assert.equal(
    deriveDashboardVehicleMode({
      snapshot: null,
      nowMs: NOW,
      hasActiveSession: false,
    }),
    "stale",
  );
  assert.equal(
    deriveDashboardVehicleMode({
      snapshot: undefined,
      nowMs: NOW,
      hasActiveSession: false,
    }),
    "stale",
  );
});

test("no snapshot but an open app session still wins → app_charging", () => {
  assert.equal(
    deriveDashboardVehicleMode({
      snapshot: null,
      nowMs: NOW,
      hasActiveSession: true,
    }),
    "app_charging",
  );
});

test("stale still allows starting a charging session", () => {
  // The Start button must stay usable for a car we have not heard from.
  assert.equal(canStartChargingSession("stale"), true);
});
