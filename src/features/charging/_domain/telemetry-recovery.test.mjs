import assert from "node:assert/strict";
import test from "node:test";

import { findTelemetryRecoveryCandidates } from "./telemetry-recovery.ts";

const car = {
  id: "car", user_id: "user", name: "Car", vehicle_alias: "vehicle",
  battery_capacity_kwh: 60, default_charger_power_kw: 7,
  default_efficiency_percent: 98, fast_dc_efficiency_percent: 90,
};
// Fixture "minutes" are 2 real minutes apart so a four-sample run clears the 5 min floor
// while consecutive samples stay inside the 3 min continuity gap.
const at = (minutes) => new Date(Date.UTC(2026, 8, 1, 12, 0) + minutes * 2 * 60_000).toISOString();
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

test("rejects a blip too short or too small to be a real charge", () => {
  // Observed on prod: plug-in for under a minute, SOC 33.2 -> 33.3.
  const blip = [0, 0.2, 0.4, 0.6, 0.8, 1].map((minute, index) => sample(minute, {
    soc: 33.2 + (index === 5 ? 0.1 : 0), charge_power_kw: 2, speed_kmh: 0,
  }));
  assert.deepEqual(findTelemetryRecoveryCandidates(car, [
    ...blip, sample(1.5, { soc: 33.3, charge_power_kw: 0, speed_kmh: 0 }),
  ]), []);
  // Long enough but SOC barely moved.
  const slow = [0, 2, 4, 6].map((minute) => sample(minute, { soc: 50, charge_power_kw: 1, speed_kmh: 0 }));
  slow[3] = sample(6, { soc: 50.4, charge_power_kw: 1, speed_kmh: 0 });
  assert.deepEqual(findTelemetryRecoveryCandidates(car, [
    ...slow, sample(7, { soc: 50.4, charge_power_kw: 0, speed_kmh: 0 }),
  ]), []);
  // Short but a real gain is still too short to trust.
  const quick = [0, 0.5, 1, 1.5].map((minute, index) => sample(minute, { soc: 40 + index, charge_power_kw: 7, speed_kmh: 0 }));
  assert.deepEqual(findTelemetryRecoveryCandidates(car, [
    ...quick, sample(2, { soc: 43, charge_power_kw: 0, speed_kmh: 0 }),
  ]), []);
});
