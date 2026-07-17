import assert from "node:assert/strict";
import test from "node:test";

import { calculatePhantomDrainDays } from "./phantom-drain.ts";

function sample(hour, soc, overrides = {}) {
  return {
    deviceTime: `2026-07-14T${String(hour).padStart(2, "0")}:00:00.000Z`,
    soc,
    speedKmh: 0,
    powerKw: 0,
    chargePowerKw: 0,
    isCharging: false,
    chargeGunState: "1",
    ...overrides,
  };
}

test("reports net SOC loss over a continuous four-hour parked interval", () => {
  assert.deepEqual(
    calculatePhantomDrainDays([
      sample(0, 80),
      sample(1, 80),
      sample(2, 79),
      sample(3, 78),
      sample(4, 77),
    ]),
    [{ date: "2026-07-14", socStart: 80, socEnd: 77, drainPercent: 3, idleHours: 4 }],
  );
});

test("does not turn same-day driving and charging into phantom drain", () => {
  assert.deepEqual(
    calculatePhantomDrainDays([
      sample(0, 92),
      sample(1, 92),
      sample(2, 92),
      sample(3, 92),
      sample(4, 92),
      sample(5, 92),
      sample(6, 83, { speedKmh: 70, powerKw: 12 }),
      sample(7, 89, { chargePowerKw: 7, isCharging: true, chargeGunState: "2" }),
      sample(8, 100, { chargePowerKw: 7, isCharging: true, chargeGunState: "2" }),
      sample(10, 96, { speedKmh: 60, powerKw: 10 }),
      sample(14, 81, { speedKmh: 100, powerKw: 20 }),
      sample(20, 49, { speedKmh: 80, powerKw: 15 }),
      sample(21, 49),
      sample(22, 49),
    ]),
    [],
  );
});

test("uses interval net loss instead of summing SOC jitter", () => {
  assert.deepEqual(
    calculatePhantomDrainDays([
      sample(0, 80),
      sample(1, 79),
      sample(2, 80),
      sample(3, 79),
      sample(4, 79),
    ]),
    [{ date: "2026-07-14", socStart: 80, socEnd: 79, drainPercent: 1, idleHours: 4 }],
  );
});

test("breaks parked intervals on a six-hour telemetry gap", () => {
  assert.deepEqual(
    calculatePhantomDrainDays([
      sample(0, 80),
      sample(1, 79),
      sample(7, 78),
      sample(8, 77),
      sample(9, 76),
    ]),
    [],
  );
});

test("sums multiple eligible parked intervals without counting the drive between them", () => {
  assert.deepEqual(
    calculatePhantomDrainDays([
      sample(0, 90),
      sample(1, 90),
      sample(2, 89),
      sample(3, 89),
      sample(4, 88),
      sample(5, 80, { speedKmh: 50, powerKw: 8 }),
      sample(6, 80),
      sample(7, 80),
      sample(8, 79),
      sample(9, 79),
      sample(10, 79),
    ]),
    [{ date: "2026-07-14", socStart: 90, socEnd: 79, drainPercent: 3, idleHours: 8 }],
  );
});

test("treats explicit unplugged gun state as stronger than stale charging state", () => {
  assert.deepEqual(
    calculatePhantomDrainDays([
      sample(0, 75, { isCharging: true }),
      sample(1, 75, { isCharging: true }),
      sample(2, 74, { isCharging: true }),
      sample(3, 74, { isCharging: true }),
      sample(4, 73, { isCharging: true }),
    ]),
    [{ date: "2026-07-14", socStart: 75, socEnd: 73, drainPercent: 2, idleHours: 4 }],
  );
});
