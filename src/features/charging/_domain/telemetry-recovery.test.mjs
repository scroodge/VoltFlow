import assert from "node:assert/strict";
import test from "node:test";

import { findTelemetryRecoveryCandidates } from "./telemetry-recovery.ts";

const car = {
  id: "car", user_id: "user", name: "Car", vehicle_alias: "vehicle",
  battery_capacity_kwh: 60, default_charger_power_kw: 7,
  default_efficiency_percent: 98, fast_dc_efficiency_percent: 90,
};
const at = (minutes) => new Date(Date.UTC(2026, 8, 1, 12, minutes)).toISOString();
const sample = (minute, telemetry) => ({ device_time: at(minute), telemetry });

test("recovers a closed four-sample telemetry charge", () => {
  const candidates = findTelemetryRecoveryCandidates(car, [
    sample(0, { soc: 40, charge_power_kw: 7, speed_kmh: 0 }),
    sample(1, { soc: 41, charge_power_kw: 7, speed_kmh: 0 }),
    sample(2, { soc: 42, charge_power_kw: 7, speed_kmh: 0 }),
    sample(3, { soc: 43, charge_power_kw: 7, speed_kmh: 0 }),
    sample(4, { soc: 43, charge_power_kw: 0, speed_kmh: 0 }),
  ]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].startPercent, 40);
  assert.equal(candidates[0].endPercent, 43);
  assert.equal(candidates[0].stoppedAt, at(4));
});

test("rejects an incomplete or non-rising signal", () => {
  const charging = [0, 1, 2, 3].map((minute) => sample(minute, {
    soc: 50, charge_power_kw: 7, speed_kmh: 0,
  }));
  assert.deepEqual(findTelemetryRecoveryCandidates(car, charging), []);
  assert.deepEqual(findTelemetryRecoveryCandidates(car, [...charging, sample(4, {
    soc: 50, charge_power_kw: 0, speed_kmh: 0,
  })]), []);
});

test("does not join charging samples across a stale telemetry gap", () => {
  const candidates = findTelemetryRecoveryCandidates(car, [
    sample(0, { soc: 40, charge_power_kw: 7, speed_kmh: 0 }),
    sample(1, { soc: 41, charge_power_kw: 7, speed_kmh: 0 }),
    sample(2, { soc: 42, charge_power_kw: 7, speed_kmh: 0 }),
    sample(10, { soc: 43, charge_power_kw: 7, speed_kmh: 0 }),
    sample(11, { soc: 43, charge_power_kw: 0, speed_kmh: 0 }),
  ]);
  assert.deepEqual(candidates, []);
});

test("ends at the last charging sample when telemetry stays silent afterwards", () => {
  const candidates = findTelemetryRecoveryCandidates(car, [
    sample(0, { soc: 40, charge_power_kw: 7, speed_kmh: 0 }),
    sample(1, { soc: 41, charge_power_kw: 7, speed_kmh: 0 }),
    sample(2, { soc: 42, charge_power_kw: 7, speed_kmh: 0 }),
    sample(3, { soc: 43, charge_power_kw: 7, speed_kmh: 0 }),
    // The car went silent for 14 h; the next reading is not evidence of when charging ended.
    sample(14 * 60 + 3, { soc: 43, charge_power_kw: 0, speed_kmh: 0 }),
  ]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].startedAt, at(0));
  assert.equal(candidates[0].stoppedAt, at(3));
});
