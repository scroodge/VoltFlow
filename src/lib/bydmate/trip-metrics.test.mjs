import assert from "node:assert/strict";
import test from "node:test";

import {
  tripEnergyPerKm,
  tripNetConsumptionKwh100,
  tripTractionEnergyKwh,
} from "./trip-metrics.ts";

test("calculates per-km and net consumption from traction and regen", () => {
  const trip = {
    traction_energy_kwh: 12,
    regen_energy_kwh: 2,
    distance_km: 50,
    avg_consumption_kwh_100km: 24,
  };

  assert.equal(tripTractionEnergyKwh(trip), 12);
  assert.equal(tripEnergyPerKm(trip), 0.24);
  assert.equal(tripNetConsumptionKwh100(trip), 20);
});

test("uses reported consumption only when a trip has no direct traction energy", () => {
  const trip = {
    traction_energy_kwh: null,
    regen_energy_kwh: 1,
    distance_km: 40,
    avg_consumption_kwh_100km: 20,
  };

  assert.equal(tripTractionEnergyKwh(trip), 8);
  assert.equal(tripEnergyPerKm(trip), 0.2);
  assert.equal(tripNetConsumptionKwh100(trip), 17.5);
});

test("does not calculate a rate without distance or regen", () => {
  assert.equal(
    tripNetConsumptionKwh100({
      traction_energy_kwh: 8,
      regen_energy_kwh: null,
      distance_km: 40,
      avg_consumption_kwh_100km: 20,
    }),
    null,
  );
  assert.equal(
    tripEnergyPerKm({
      traction_energy_kwh: 8,
      regen_energy_kwh: 1,
      distance_km: 0,
      avg_consumption_kwh_100km: 20,
    }),
    null,
  );
});
