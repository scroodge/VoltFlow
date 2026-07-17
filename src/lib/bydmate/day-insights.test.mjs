import test from "node:test";
import assert from "node:assert/strict";

import { totalMeasuredTripEnergyKwh } from "./day-insights.ts";

test("sums trip energy only when every trip has a measured value", () => {
  assert.equal(
    totalMeasuredTripEnergyKwh([
      { traction_energy_kwh: 1.25 },
      { traction_energy_kwh: 2.75 },
    ]),
    4,
  );
});

test("does not present a partial day energy total", () => {
  assert.equal(
    totalMeasuredTripEnergyKwh([
      { traction_energy_kwh: 1.25 },
      { traction_energy_kwh: null },
    ]),
    null,
  );
});
