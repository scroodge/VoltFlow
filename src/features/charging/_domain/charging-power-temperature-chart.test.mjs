import test from "node:test";
import assert from "node:assert/strict";

import { chargingPowerTemperaturePoints } from "./charging-power-temperature-chart.ts";

test("keeps measured charge power including zero and independently optional battery temperature", () => {
  const points = chargingPowerTemperaturePoints([
    {
      device_time: "2026-11-17T10:02:00.000Z",
      telemetry: { charge_power_kw: 0, battery_temp_c: 31.5 },
    },
    {
      device_time: "2026-11-17T10:01:00.000Z",
      telemetry: { charge_power_kw: 6.7, battery_temp_c: null },
    },
    {
      device_time: "2026-11-17T10:03:00.000Z",
      telemetry: { charge_power_kw: null, battery_temp_c: 32 },
    },
  ]);

  assert.deepEqual(points, [
    { time: Date.parse("2026-11-17T10:01:00.000Z"), powerKw: 6.7, batteryTempC: null },
    { time: Date.parse("2026-11-17T10:02:00.000Z"), powerKw: 0, batteryTempC: 31.5 },
    { time: Date.parse("2026-11-17T10:03:00.000Z"), powerKw: null, batteryTempC: 32 },
  ]);
});

test("drops invalid timestamps and impossible negative charging power without fabricating values", () => {
  const points = chargingPowerTemperaturePoints([
    {
      device_time: "not-a-time",
      telemetry: { charge_power_kw: 7, battery_temp_c: 25 },
    },
    {
      device_time: "2026-11-17T10:00:00.000Z",
      telemetry: { charge_power_kw: -3, battery_temp_c: null },
    },
    {
      device_time: "2026-11-17T10:01:00.000Z",
      telemetry: { charge_power_kw: -2, battery_temp_c: 26 },
    },
  ]);

  assert.deepEqual(points, [
    { time: Date.parse("2026-11-17T10:01:00.000Z"), powerKw: null, batteryTempC: 26 },
  ]);
});
