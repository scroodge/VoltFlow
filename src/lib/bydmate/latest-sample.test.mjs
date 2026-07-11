import assert from "node:assert/strict";
import test from "node:test";

import { latestDeviceTimeByVehicle } from "./latest-sample.ts";

test("latestDeviceTimeByVehicle keeps the last ordered sample for each vehicle", () => {
  const result = latestDeviceTimeByVehicle([
    { vehicle_id: "alpha", device_time: "2026-07-11T10:00:00.000Z" },
    { vehicle_id: "beta", device_time: "2026-07-11T10:00:01.000Z" },
    { vehicle_id: "alpha", device_time: "2026-07-11T10:00:02.000Z" },
  ]);

  assert.deepEqual([...result], [
    ["alpha", "2026-07-11T10:00:02.000Z"],
    ["beta", "2026-07-11T10:00:01.000Z"],
  ]);
});

test("latestDeviceTimeByVehicle handles an empty batch", () => {
  assert.equal(latestDeviceTimeByVehicle([]).size, 0);
});
