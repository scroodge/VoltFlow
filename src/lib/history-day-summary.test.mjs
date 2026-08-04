import assert from "node:assert/strict";
import test from "node:test";

import { computeHistoryPeriodSummary, pickWalkBackSessionPrice } from "./history-day-summary.ts";

test("pickWalkBackSessionPrice uses the most recent session when its kWh still covers driving since it stopped", () => {
  const candidates = [
    { stopped_at: "2026-07-10T08:00:00.000Z", charged_energy_kwh: 20, price_per_kwh: 0.6 },
    { stopped_at: "2026-07-05T08:00:00.000Z", charged_energy_kwh: 40, price_per_kwh: 0.15 },
  ];
  const trips = [
    { traction_energy_kwh: 5, distance_km: 30, avg_consumption_kwh_100km: null, started_at: "2026-07-10T12:00:00.000Z" },
    { traction_energy_kwh: 3, distance_km: 20, avg_consumption_kwh_100km: null, started_at: "2026-07-11T09:00:00.000Z" },
  ];

  assert.equal(pickWalkBackSessionPrice(candidates, trips), 0.6);
});

test("pickWalkBackSessionPrice falls back to an older session once the newest one's kWh is exhausted", () => {
  const candidates = [
    { stopped_at: "2026-07-10T08:00:00.000Z", charged_energy_kwh: 5, price_per_kwh: 0.6 },
    { stopped_at: "2026-07-01T08:00:00.000Z", charged_energy_kwh: 40, price_per_kwh: 0.15 },
  ];
  const trips = [
    { traction_energy_kwh: 8, distance_km: 50, avg_consumption_kwh_100km: null, started_at: "2026-07-11T09:00:00.000Z" },
  ];

  assert.equal(pickWalkBackSessionPrice(candidates, trips), 0.15);
});

test("pickWalkBackSessionPrice returns null when every candidate is exhausted", () => {
  const candidates = [
    { stopped_at: "2026-07-10T08:00:00.000Z", charged_energy_kwh: 5, price_per_kwh: 0.6 },
    { stopped_at: "2026-07-01T08:00:00.000Z", charged_energy_kwh: 5, price_per_kwh: 0.15 },
  ];
  const trips = [
    { traction_energy_kwh: 50, distance_km: 300, avg_consumption_kwh_100km: null, started_at: "2026-07-11T09:00:00.000Z" },
  ];

  assert.equal(pickWalkBackSessionPrice(candidates, trips), null);
});

test("pickWalkBackSessionPrice returns null with no candidates", () => {
  assert.equal(pickWalkBackSessionPrice([], []), null);
});

test("pickWalkBackSessionPrice skips a session with zero charged energy or price", () => {
  const candidates = [
    { stopped_at: "2026-07-10T08:00:00.000Z", charged_energy_kwh: 0, price_per_kwh: 0.6 },
    { stopped_at: "2026-07-05T08:00:00.000Z", charged_energy_kwh: 40, price_per_kwh: 0.15 },
  ];
  const trips = [];

  assert.equal(pickWalkBackSessionPrice(candidates, trips), 0.15);
});

test("computeHistoryPeriodSummary derives avgConsumptionKwh100 from total driveKwh over total distanceKm", () => {
  const sessions = [];
  const trips = [
    {
      started_at: "2026-07-10T08:00:00.000Z",
      distance_km: 30,
      traction_energy_kwh: 6,
      avg_consumption_kwh_100km: null,
      regen_energy_kwh: 0,
    },
    {
      started_at: "2026-07-10T18:00:00.000Z",
      distance_km: 10,
      traction_energy_kwh: 2,
      avg_consumption_kwh_100km: null,
      regen_energy_kwh: 0,
    },
  ];

  const summary = computeHistoryPeriodSummary(
    sessions,
    trips,
    "2026-07-10T00:00:00.000Z",
    "2026-07-10T23:59:59.999Z",
  );

  assert.equal(summary.distanceKm, 40);
  assert.equal(summary.driveKwh, 8);
  assert.equal(summary.avgConsumptionKwh100, 20);
});

test("computeHistoryPeriodSummary returns null avgConsumptionKwh100 when there are no trips", () => {
  const summary = computeHistoryPeriodSummary(
    [],
    [],
    "2026-07-10T00:00:00.000Z",
    "2026-07-10T23:59:59.999Z",
  );

  assert.equal(summary.distanceKm, 0);
  assert.equal(summary.avgConsumptionKwh100, null);
});

test("pickWalkBackSessionPrice ignores trips at or before a candidate's stopped_at", () => {
  const candidates = [
    { stopped_at: "2026-07-10T08:00:00.000Z", charged_energy_kwh: 1, price_per_kwh: 0.6 },
  ];
  const trips = [
    { traction_energy_kwh: 50, distance_km: 300, avg_consumption_kwh_100km: null, started_at: "2026-07-10T08:00:00.000Z" },
  ];

  assert.equal(pickWalkBackSessionPrice(candidates, trips), 0.6);
});
