import assert from "node:assert/strict";
import test from "node:test";

import { pickWalkBackSessionPrice } from "./history-day-summary.ts";

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

test("pickWalkBackSessionPrice ignores trips at or before a candidate's stopped_at", () => {
  const candidates = [
    { stopped_at: "2026-07-10T08:00:00.000Z", charged_energy_kwh: 1, price_per_kwh: 0.6 },
  ];
  const trips = [
    { traction_energy_kwh: 50, distance_km: 300, avg_consumption_kwh_100km: null, started_at: "2026-07-10T08:00:00.000Z" },
  ];

  assert.equal(pickWalkBackSessionPrice(candidates, trips), 0.6);
});
