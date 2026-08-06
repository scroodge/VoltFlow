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
