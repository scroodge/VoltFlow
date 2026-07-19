import test from "node:test";
import assert from "node:assert/strict";

import {
  efficiencyGroupForTariffType,
  isPlausibleMeasuredEfficiency,
  measuredEfficiencyForSession,
  suggestEfficiency,
  summarizeTelemetryContext,
  tariffTypesForEfficiencyGroup,
} from "./charging-efficiency-learning.ts";

test("measuredEfficiencyForSession inverts the session energy formula", () => {
  // 46% -> 83% on a 45.1 kWh battery, billed 18.40 kWh by the provider (see
  // charging-efficiency.ts's own DC example) should read back ~90.7%.
  const batteryKwh = ((83 - 46) / 100) * 45.1;
  const percent = measuredEfficiencyForSession({
    socDeltaPercent: 83 - 46,
    batteryCapacityKwh: 45.1,
    billedEnergyKwh: 18.4,
  });
  assert.ok(percent != null);
  assert.ok(Math.abs(percent - (batteryKwh / 18.4) * 100) < 1e-6);
  assert.ok(Math.abs(percent - 90.7) < 0.2);
});

test("measuredEfficiencyForSession guards against non-positive inputs", () => {
  assert.equal(
    measuredEfficiencyForSession({ socDeltaPercent: 0, batteryCapacityKwh: 45.1, billedEnergyKwh: 18.4 }),
    null,
  );
  assert.equal(
    measuredEfficiencyForSession({ socDeltaPercent: 10, batteryCapacityKwh: 0, billedEnergyKwh: 18.4 }),
    null,
  );
  assert.equal(
    measuredEfficiencyForSession({ socDeltaPercent: 10, batteryCapacityKwh: 45.1, billedEnergyKwh: 0 }),
    null,
  );
  assert.equal(
    measuredEfficiencyForSession({ socDeltaPercent: -5, batteryCapacityKwh: 45.1, billedEnergyKwh: 18.4 }),
    null,
  );
});

test("isPlausibleMeasuredEfficiency flags obvious typos but allows the real range", () => {
  assert.equal(isPlausibleMeasuredEfficiency(90.7), true);
  assert.equal(isPlausibleMeasuredEfficiency(98), true);
  assert.equal(isPlausibleMeasuredEfficiency(49.9), false);
  assert.equal(isPlausibleMeasuredEfficiency(105.1), false);
  assert.equal(isPlausibleMeasuredEfficiency(9.07), false); // decimal-point typo
  assert.equal(isPlausibleMeasuredEfficiency(Number.NaN), false);
});

test("efficiencyGroupForTariffType / tariffTypesForEfficiencyGroup round-trip", () => {
  assert.equal(efficiencyGroupForTariffType("fast_dc"), "fast_dc");
  assert.equal(efficiencyGroupForTariffType("home"), "ac");
  assert.equal(efficiencyGroupForTariffType("commercial_ac"), "ac");
  assert.deepEqual(tariffTypesForEfficiencyGroup("fast_dc"), ["fast_dc"]);
  assert.deepEqual(tariffTypesForEfficiencyGroup("ac"), ["home", "commercial_ac"]);
});

test("summarizeTelemetryContext averages only charging samples", () => {
  const samples = [
    { device_time: "t0", telemetry: { charge_power_kw: 0, battery_temp_c: 10, outside_temp_c: 5 } }, // idle, excluded
    { device_time: "t1", telemetry: { charge_power_kw: 40, battery_temp_c: 28, outside_temp_c: 22 } },
    { device_time: "t2", telemetry: { charge_power_kw: 42, battery_temp_c: 30, outside_temp_c: 24 } },
    { device_time: "t3", telemetry: null },
  ];
  const summary = summarizeTelemetryContext(samples);
  assert.equal(summary.sampleCount, 2);
  assert.equal(summary.avgChargePowerKw, 41);
  assert.equal(summary.avgBatteryTempC, 29);
  assert.equal(summary.avgOutsideTempC, 23);
});

test("summarizeTelemetryContext returns nulls with no charging samples", () => {
  const summary = summarizeTelemetryContext([]);
  assert.deepEqual(summary, {
    avgBatteryTempC: null,
    avgOutsideTempC: null,
    avgChargePowerKw: null,
    sampleCount: 0,
  });
});

function observation(percent, computedAt, temp = 25) {
  return {
    measuredEfficiencyPercent: percent,
    avgBatteryTempC: temp,
    avgOutsideTempC: temp - 5,
    computedAt,
  };
}

test("suggestEfficiency withholds a suggestion below the minimum sample count", () => {
  const observations = [observation(88, "2026-07-01"), observation(89, "2026-07-05")];
  assert.equal(suggestEfficiency(observations, 90), null);
});

test("suggestEfficiency withholds a suggestion when the spread is too wide", () => {
  const observations = [
    observation(80, "2026-07-01"),
    observation(88, "2026-07-05"),
    observation(90, "2026-07-10"),
  ];
  // 80..90 = 10pt spread, over the 5pt cap
  assert.equal(suggestEfficiency(observations, 95), null);
});

test("suggestEfficiency withholds a suggestion within noise of the current value", () => {
  const observations = [
    observation(89.6, "2026-07-01"),
    observation(89.8, "2026-07-05"),
    observation(89.9, "2026-07-10"),
  ];
  assert.equal(suggestEfficiency(observations, 90), null);
});

test("suggestEfficiency surfaces the median of the recent window with evidence", () => {
  const observations = [
    observation(88, "2026-07-01", 20),
    observation(89, "2026-07-05", 24),
    observation(90, "2026-07-10", 28),
  ];
  const suggestion = suggestEfficiency(observations, 95);
  assert.ok(suggestion != null);
  assert.equal(suggestion.suggestedPercent, 89);
  assert.equal(suggestion.sampleCount, 3);
  assert.equal(suggestion.spread, 2);
  assert.equal(suggestion.avgBatteryTempC, 24);
  assert.equal(suggestion.avgOutsideTempC, 19);
});

test("suggestEfficiency caps the window at the 10 most recent observations", () => {
  // 12 old observations at 87%, then 3 newer ones creeping up to 91% — all within the
  // 5pt spread cap so windowing (not spread-gating) is what's under test here.
  const old = Array.from({ length: 12 }, (_, i) =>
    observation(87, `2026-01-${String(i + 1).padStart(2, "0")}`),
  );
  const recent = [observation(89, "2026-07-01"), observation(90, "2026-07-05"), observation(91, "2026-07-10")];
  const suggestion = suggestEfficiency([...old, ...recent], 95);
  assert.ok(suggestion != null);
  // window = 3 recent + the 7 newest of the old batch (2026-01-06..01-12), all at 87%.
  assert.equal(suggestion.sampleCount, 10);
  assert.equal(suggestion.spread, 4);
  assert.equal(suggestion.suggestedPercent, 87);
});
