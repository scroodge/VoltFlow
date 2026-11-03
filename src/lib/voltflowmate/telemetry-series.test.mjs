import assert from "node:assert/strict";
import test from "node:test";

import { seriesToTelemetryPoints, shouldUseDistilledSeries } from "./telemetry-series.ts";

test("seriesToTelemetryPoints rebuilds history points from columnar arrays", () => {
  const points = seriesToTelemetryPoints({
    t: [1762156800000, 1762156801000],
    soc: [80.5, 80.4],
    power_kw: [12.3, null],
    is_charging: [false, true],
    charge_type: [null, "DC"],
    odometer_km: [5425.7, 5425.8],
    diplus_charge_gun_state: ["1", "2"],
    diplus_min_cell_voltage_v: [3.301, null],
    diplus_max_cell_voltage_v: [3.322, null],
    diplus_cell_delta_v: [0.021, null],
  });

  assert.deepEqual(points, [
    {
      device_time: "2025-11-03T08:00:00.000Z",
      telemetry: { soc: 80.5, power_kw: 12.3, odometer_km: 5425.7, is_charging: false },
      diplus_charge_gun_state: "1",
      diplus_min_cell_voltage_v: 3.301,
      diplus_max_cell_voltage_v: 3.322,
      diplus_cell_delta_v: 0.021,
    },
    {
      device_time: "2025-11-03T08:00:01.000Z",
      telemetry: { soc: 80.4, odometer_km: 5425.8, is_charging: true, charge_type: "DC" },
      diplus_charge_gun_state: "2",
      diplus_min_cell_voltage_v: null,
      diplus_max_cell_voltage_v: null,
      diplus_cell_delta_v: null,
    },
  ]);
});

test("seriesToTelemetryPoints tolerates empty and malformed series", () => {
  assert.deepEqual(seriesToTelemetryPoints(null), []);
  assert.deepEqual(seriesToTelemetryPoints({}), []);
  assert.equal(seriesToTelemetryPoints({ t: ["x", 1762156800000] }).length, 1);
});

test("shouldUseDistilledSeries prefers raw samples while they are complete", () => {
  const row = { source_sample_count: 3600, point_count: 1200, series: {} };
  assert.equal(shouldUseDistilledSeries(3600, row), false);
  assert.equal(shouldUseDistilledSeries(1800, row), true);
  assert.equal(shouldUseDistilledSeries(0, row), true);
  assert.equal(shouldUseDistilledSeries(0, null), false);
  assert.equal(shouldUseDistilledSeries(0, { ...row, point_count: 0 }), false);
});
