import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateCumulativeRegenPoints,
  calculateRegenRecoverySegments,
  calculateTripEnergy,
  prepareRegenRecoveryBars,
} from "./trip-energy.ts";

function assertClose(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 0.001, `${actual} should be close to ${expected}`);
}

test("integrates negative power as recovered trip energy", () => {
  const summary = calculateTripEnergy([
    { device_time: "2026-05-26T10:00:00.000Z", power_kw: 10 },
    { device_time: "2026-05-26T10:01:00.000Z", power_kw: 20 },
    { device_time: "2026-05-26T10:02:00.000Z", power_kw: -12 },
    { device_time: "2026-05-26T10:03:00.000Z", power_kw: -18 },
  ]);

  assert.equal(summary.power_sample_count, 4);
  assertClose(summary.traction_energy_kwh, 0.354);
  assertClose(summary.regen_energy_kwh, 0.2875);
});

test("skips long telemetry gaps when integrating trip energy", () => {
  const summary = calculateTripEnergy([
    { device_time: "2026-05-26T10:00:00.000Z", power_kw: -30 },
    { device_time: "2026-05-26T10:10:00.000Z", power_kw: -30 },
  ]);

  assert.equal(summary.power_sample_count, 2);
  assert.equal(summary.regen_energy_kwh, 0);
});

test("builds cumulative recovered energy points", () => {
  const points = calculateCumulativeRegenPoints([
    { device_time: "2026-05-26T10:00:00.000Z", power_kw: -30 },
    { device_time: "2026-05-26T10:01:00.000Z", power_kw: -30 },
    { device_time: "2026-05-26T10:10:00.000Z", power_kw: 10 },
  ]);

  assert.equal(points.length, 3);
  assert.equal(points[1].value.toFixed(3), "0.500");
  assert.equal(points[2].value.toFixed(3), "0.500");
});

test("builds incremental regen recovery segments with trip distance", () => {
  const segments = calculateRegenRecoverySegments([
    { device_time: "2026-05-26T10:00:00.000Z", power_kw: -20, current_trip_distance_km: 0 },
    { device_time: "2026-05-26T10:01:00.000Z", power_kw: -10, current_trip_distance_km: 1.2 },
    { device_time: "2026-05-26T10:02:00.000Z", power_kw: 15, current_trip_distance_km: 2.4 },
  ]);

  assert.equal(segments.length, 2);
  assertClose(segments[0].regenKwh, 0.25);
  assert.equal(segments[0].distanceKm, 1.2);
  assertClose(segments[1].regenKwh, 0.0333);
  assert.equal(segments[1].distanceKm, 2.4);
});

test("prepareRegenRecoveryBars prefers distance axis when km is available", () => {
  const prepared = prepareRegenRecoveryBars([
    { time: 1, distanceKm: 1.2, regenKwh: 0.05, powerKw: -10 },
    { time: 2, distanceKm: 2.4, regenKwh: 0.03, powerKw: -8 },
  ]);

  assert.equal(prepared.xAxis, "distance");
  assert.equal(prepared.segments.length, 2);
  assert.equal(prepared.segments[0].x, 1.2);
});
