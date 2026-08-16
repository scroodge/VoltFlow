import assert from "node:assert/strict";
import test from "node:test";

import {
  tripEnergyPerKm,
  tripNetConsumptionKwh100,
  tripTractionEnergyKwh,
  weightedAvgConsumptionKwh100,
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

test("weights the reported consumption average by distance", () => {
  const average = weightedAvgConsumptionKwh100([
    { distance_km: 90, avg_consumption_kwh_100km: 15 },
    { distance_km: 10, avg_consumption_kwh_100km: 25 },
  ]);

  // Distance-weighted, not the 20 an unweighted mean would give.
  assert.equal(average, 16);
});

test("drops sub-1 km trips, which are cold-start skew rather than driving", () => {
  const trips = [
    { distance_km: 20, avg_consumption_kwh_100km: 15 },
    { distance_km: 0.6, avg_consumption_kwh_100km: 30 },
  ];

  assert.equal(weightedAvgConsumptionKwh100(trips), 15);
  // Opt-out for callers that genuinely want every trip.
  assert.ok(weightedAvgConsumptionKwh100(trips, { minDistanceKm: 0 }) > 15);
});

test("drops non-positive consumption reported on long regen descents", () => {
  const average = weightedAvgConsumptionKwh100([
    { distance_km: 20, avg_consumption_kwh_100km: 15 },
    { distance_km: 20, avg_consumption_kwh_100km: -5 },
    { distance_km: 20, avg_consumption_kwh_100km: 0 },
  ]);

  assert.equal(average, 15);
});

test("returns null rather than falling back to a differently-weighted mean", () => {
  assert.equal(weightedAvgConsumptionKwh100([]), null);
  assert.equal(
    weightedAvgConsumptionKwh100([
      { distance_km: null, avg_consumption_kwh_100km: 18 },
      { distance_km: 0.4, avg_consumption_kwh_100km: 22 },
    ]),
    null,
  );
});
