import test from "node:test";
import assert from "node:assert/strict";

import {
  pickVehicleBatteryCapacityKwh,
  pickVehicleRangeProfile,
  vehicleRangeProfileFields,
} from "./vehicle-battery-capacity.ts";

test("uses the car whose alias matches the vehicle", () => {
  const rows = [
    { vehicle_alias: "other", battery_capacity_kwh: 60.48 },
    { vehicle_alias: "way", battery_capacity_kwh: 45.1 },
  ];
  assert.equal(pickVehicleBatteryCapacityKwh(rows, "way"), 45.1);
});

test("accepts PostgREST numeric strings", () => {
  assert.equal(pickVehicleBatteryCapacityKwh([{ vehicle_alias: "way", battery_capacity_kwh: "45.1" }], "way"), 45.1);
});

test("falls back to the only car when it has no alias", () => {
  assert.equal(pickVehicleBatteryCapacityKwh([{ vehicle_alias: null, battery_capacity_kwh: 45.1 }], "way"), 45.1);
});

test("a lone car aliased to another vehicle is not this vehicle", () => {
  assert.equal(pickVehicleBatteryCapacityKwh([{ vehicle_alias: "other", battery_capacity_kwh: 45.1 }], "way"), null);
});

test("several unaliased cars are ambiguous", () => {
  const rows = [
    { vehicle_alias: null, battery_capacity_kwh: 45.1 },
    { vehicle_alias: null, battery_capacity_kwh: 60.48 },
  ];
  assert.equal(pickVehicleBatteryCapacityKwh(rows, "way"), null);
});

test("implausible capacity is not sent", () => {
  assert.equal(pickVehicleBatteryCapacityKwh([{ vehicle_alias: "way", battery_capacity_kwh: 4.2 }], "way"), null);
  assert.equal(pickVehicleBatteryCapacityKwh([{ vehicle_alias: "way", battery_capacity_kwh: 500 }], "way"), null);
});

test("range profile carries the reserve of the matched car", () => {
  const rows = [
    { vehicle_alias: "other", battery_capacity_kwh: 60.48, range_reserve_soc_percent: 0 },
    { vehicle_alias: "way", battery_capacity_kwh: "45.1", range_reserve_soc_percent: "15" },
  ];
  assert.deepEqual(pickVehicleRangeProfile(rows, "way"), {
    batteryCapacityKwh: 45.1,
    rangeReserveSocPercent: 15,
  });
});

test("zero reserve is sent, a missing one is omitted", () => {
  assert.deepEqual(
    vehicleRangeProfileFields({ batteryCapacityKwh: 45.1, rangeReserveSocPercent: 0 }),
    { battery_capacity_kwh: 45.1, range_reserve_soc_percent: 0 },
  );
  assert.deepEqual(
    vehicleRangeProfileFields({ batteryCapacityKwh: null, rangeReserveSocPercent: null }),
    {},
  );
  assert.deepEqual(vehicleRangeProfileFields(null), {});
});

test("unresolved car yields no reserve", () => {
  assert.deepEqual(
    pickVehicleRangeProfile([{ vehicle_alias: "other", battery_capacity_kwh: 45.1, range_reserve_soc_percent: 10 }], "way"),
    { batteryCapacityKwh: null, rangeReserveSocPercent: null },
  );
});
