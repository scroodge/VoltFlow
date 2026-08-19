import test from "node:test";
import assert from "node:assert/strict";

import {
  explainAiRange,
  explainDistanceSinceCharge,
  explainKmPerPercent,
  explainMathRange,
  explainRecentEnergy,
} from "./metric-explain.ts";
import { estimateVehicleRangeKm } from "./range-estimate.ts";
import { resolveKmPerPercentSoc, sumDistanceSinceCharge } from "./hero-drive-metrics.ts";
import { weightedAvgConsumptionKwh100 } from "./trip-metrics.ts";

const snapshot = {
  id: "live", vehicle_id: "car", user_id: "user", source: "BYDMate", schema_version: 1,
  device_time: "2026-08-19T12:00:00Z", received_at: "2026-08-19T12:00:00Z", updated_at: "2026-08-19T12:00:00Z",
  raw_payload: {}, location: {}, diplus: { ac_status: false },
  telemetry: { soc: 64, soh_percent: 96, speed_kmh: 35, outside_temp_c: 18, current_trip_distance_km: 22, current_trip_consumption_kwh_100km: 17 },
};
const trips = [
  { id: "current", started_at: "2026-08-19T11:00:00Z", ended_at: null, last_device_time: null, distance_km: 20, soc_start: 70, soc_end: null, avg_consumption_kwh_100km: 17, sample_count: 50, traction_energy_kwh: 3.6, regen_energy_kwh: .2 },
  { id: "older", started_at: "2026-08-18T11:00:00Z", ended_at: "2026-08-18T12:00:00Z", last_device_time: null, distance_km: 30, soc_start: 80, soc_end: 70, avg_consumption_kwh_100km: 18, sample_count: 80, traction_energy_kwh: 5.5, regen_energy_kwh: .3 },
];
const result = (explanation) => explanation.rows.find((row) => row.kind === "result")?.value;

test("explanation results use the same canonical calculations as hero metrics", () => {
  const estimate = estimateVehicleRangeKm(snapshot, trips, { batteryCapacityKwh: 45 });
  assert.equal(result(explainAiRange({ snapshot, recentTrips: trips, batteryCapacityKwh: 45, estimate })), estimate.estimatedRangeKm);

  const kmPerPercent = resolveKmPerPercentSoc({ trips, liveSoc: 64, liveDistanceKm: 22, batteryCapacityKwh: 45, consumptionKwh100: 17 });
  assert.equal(result(explainKmPerPercent({ trips, liveSoc: 64, liveDistanceKm: 22, batteryCapacityKwh: 45, consumptionKwh100: 17 })), kmPerPercent);
  assert.equal(result(explainMathRange({ soc: 64, kmPerPercentSoc: kmPerPercent, trips, batteryCapacityKwh: 45 })), kmPerPercent * 64);

  const anchor = "2026-08-18T00:00:00Z";
  assert.equal(result(explainDistanceSinceCharge({ trips, anchorStoppedAt: anchor, liveDistanceKm: 22 })), sumDistanceSinceCharge(trips, anchor, 22));
  const average = weightedAvgConsumptionKwh100(trips);
  assert.equal(result(explainRecentEnergy({ trips, avgConsumptionKwh100: average })), average / 2);
});

test("missing telemetry still yields inspectable null rows without throwing", () => {
  const emptySnapshot = { ...snapshot, telemetry: { soc: null } };
  const explanations = [
    explainAiRange({ snapshot: emptySnapshot, recentTrips: [], batteryCapacityKwh: null }),
    explainMathRange({ soc: null, kmPerPercentSoc: null, trips: [], batteryCapacityKwh: null }),
    explainKmPerPercent({ trips: [], liveSoc: null, liveDistanceKm: null, batteryCapacityKwh: null, consumptionKwh100: null }),
    explainDistanceSinceCharge({ trips: [], anchorStoppedAt: null, liveDistanceKm: null }),
    explainRecentEnergy({ trips: [], avgConsumptionKwh100: null }),
  ];
  for (const explanation of explanations) {
    assert.ok(explanation.rows.length > 0);
    assert.equal(result(explanation), null);
    assert.ok(explanation.rows.some((row) => row.value === null));
  }
});
