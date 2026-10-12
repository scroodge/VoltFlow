import test from "node:test";
import assert from "node:assert/strict";

import {
  newestActiveSessionByCar,
  resolveTelegramChargingMetrics,
} from "./live-widget-charging.ts";

const NOW = Date.parse("2026-08-06T09:00:00Z");
const AC_SESSION = {
  car_id: "car-1",
  start_percent: 40,
  target_percent: 100,
  battery_capacity_kwh: 49,
  efficiency_percent: 98,
  tariff_type: "home",
  started_at: "2026-08-06T08:17:08.571Z",
  created_at: "2026-08-06T08:17:08.571Z",
};

test("Telegram refines a mature truncated AC reading and uses it for ETA", () => {
  const metrics = resolveTelegramChargingMetrics({
    soc: 42,
    rawChargePowerKw: 1,
    defaultChargePowerKw: 1,
    batteryCapacityKwh: 49,
    chargeType: "AC",
    session: AC_SESSION,
    nowMs: NOW,
  });
  assert.ok(metrics.chargePowerKw != null && Math.abs(metrics.chargePowerKw - 1.4) < 1e-6);
  const remainingGridKwh = (49 * (100 - 42)) / 100 / 0.98;
  assert.ok(
    metrics.timeToFullHours != null &&
      Math.abs(metrics.timeToFullHours - remainingGridKwh / 1.4) < 1e-5,
  );
});

test("Telegram keeps live DC power", () => {
  const metrics = resolveTelegramChargingMetrics({
    soc: 70,
    rawChargePowerKw: 30,
    defaultChargePowerKw: 7,
    batteryCapacityKwh: 49,
    chargeType: "DC",
    session: { ...AC_SESSION, tariff_type: "fast_dc", efficiency_percent: 90 },
    nowMs: NOW,
  });
  assert.equal(metrics.chargePowerKw, 30);
});

// A measured pack V × I reading is battery-side. The time-to-full divides *grid* energy by the
// power, so it must be converted first — otherwise the efficiency is counted twice.
test("Telegram time-to-full uses a measured battery-side AC power without double efficiency", () => {
  const metrics = resolveTelegramChargingMetrics({
    soc: 78,
    rawChargePowerKw: 5.656, // car `way`, AC: 316 V × 17.9 A
    defaultChargePowerKw: 7,
    batteryCapacityKwh: 49,
    chargeType: "AC",
    session: AC_SESSION,
    nowMs: NOW,
    measuredLivePowerKw: 5.656,
  });
  // Display value is the measurement itself, unchanged.
  assert.equal(metrics.chargePowerKw, 5.656);
  // Battery energy left ÷ battery power, exactly.
  const expectedHours = (49 * (100 - 78)) / 100 / 5.656;
  assert.ok(metrics.timeToFullHours != null);
  assert.ok(Math.abs(metrics.timeToFullHours - expectedHours) < 1e-9);

  // Without the measured flag the old behaviour (≈ +2 % on AC) is unchanged.
  const legacy = resolveTelegramChargingMetrics({
    soc: 78,
    rawChargePowerKw: 5.656,
    defaultChargePowerKw: 7,
    batteryCapacityKwh: 49,
    chargeType: "AC",
    session: AC_SESSION,
    nowMs: NOW,
  });
  assert.ok(Math.abs(legacy.timeToFullHours / expectedHours - 1 / 0.98) < 1e-9);
});

test("Telegram time-to-full corrects a measured DC power by the wider DC efficiency gap", () => {
  const session = { ...AC_SESSION, tariff_type: "fast_dc", efficiency_percent: 90 };
  const metrics = resolveTelegramChargingMetrics({
    soc: 70,
    rawChargePowerKw: 65.902,
    defaultChargePowerKw: 7,
    batteryCapacityKwh: 49,
    chargeType: "DC",
    session,
    nowMs: NOW,
    measuredLivePowerKw: 65.902,
  });
  const expectedHours = (49 * (100 - 70)) / 100 / 65.902;
  assert.equal(metrics.chargePowerKw, 65.902);
  assert.ok(Math.abs(metrics.timeToFullHours - expectedHours) < 1e-9);
});

test("Telegram retains raw/default behavior without an active session", () => {
  const metrics = resolveTelegramChargingMetrics({
    soc: 50,
    rawChargePowerKw: null,
    defaultChargePowerKw: 7,
    batteryCapacityKwh: 49,
    chargeType: "AC",
    session: null,
    nowMs: NOW,
  });
  assert.equal(metrics.chargePowerKw, 7);
  assert.equal(metrics.timeToFullHours, 24.5 / 7);
});

test("newest active session wins per car", () => {
  const older = { ...AC_SESSION, started_at: "2026-08-06T07:00:00Z" };
  const newer = { ...AC_SESSION, started_at: "2026-08-06T08:30:00Z" };
  const other = { ...AC_SESSION, car_id: "car-2" };
  const map = newestActiveSessionByCar([older, other, newer]);
  assert.equal(map.get("car-1"), newer);
  assert.equal(map.get("car-2"), other);
});
