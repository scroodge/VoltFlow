import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { estimateVehicleRangeKm } from "./range-estimate.ts";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

function runtimeDependencyGraph(entryPath) {
  const visited = new Map();
  const visit = (path) => {
    if (visited.has(path)) return;
    const source = readFileSync(path, "utf8");
    visited.set(path, source);
    const imports = source.matchAll(/^(?!import\s+type\b)import[\s\S]*?from\s+["'](\.[^"']+)["'];/gm);
    for (const match of imports) visit(resolve(dirname(path), match[1]));
  };
  visit(entryPath);
  return visited;
}

const baseSnapshot = {
  id: "live",
  vehicle_id: "way",
  user_id: "user",
  source: "BYDMate",
  schema_version: 1,
  device_time: "2026-05-25T18:00:00.000Z",
  received_at: "2026-05-25T18:00:00.000Z",
  telemetry: {
    soc: 100,
    speed_kmh: 0,
    range_est_km: 122,
  },
  location: {},
  raw_payload: {},
  updated_at: "2026-05-25T18:00:00.000Z",
};

test("reported range has no direct or transitive path into the user-visible estimate", () => {
  const telemetry = {
    soc: 100,
    speed_kmh: 0,
    current_trip_consumption_kwh_100km: 14.3702,
    current_trip_distance_km: 12,
  };
  Object.defineProperty(telemetry, "range_est_km", {
    get() {
      throw new Error("range_est_km must never be read by the estimator dependency graph");
    },
  });
  const recentTrips = [
    {
      avg_consumption_kwh_100km: 14.3702,
      distance_km: 50,
      sample_count: 100,
    },
  ];

  const estimate = estimateVehicleRangeKm(
    { ...baseSnapshot, telemetry },
    recentTrips,
    { batteryCapacityKwh: 45.1 },
  );

  assert.ok(estimate.estimatedRangeKm >= 312);
  assert.ok(estimate.estimatedRangeKm <= 314);
});

test("the estimator runtime dependency graph cannot reference APK range", () => {
  const graph = runtimeDependencyGraph(resolve(MODULE_DIR, "range-estimate.ts"));

  for (const [path, source] of graph) {
    assert.doesNotMatch(source, /range_est_km|rangeEstKm/, `APK range dependency in ${path}`);
  }
});

test("user-visible range surfaces cannot consume the APK range field", () => {
  const userVisibleModules = [
    resolve(MODULE_DIR, "range-estimate.ts"),
    resolve(MODULE_DIR, "../telegram/live-widget.ts"),
    resolve(MODULE_DIR, "../telegram/live-widget-message.ts"),
    resolve(MODULE_DIR, "../push/live-status-notifications.ts"),
  ];

  for (const path of userVisibleModules) {
    assert.doesNotMatch(readFileSync(path, "utf8"), /range_est_km|rangeEstKm/, `APK range consumer in ${path}`);
  }
});

test("changing the APK range cannot change the shared estimate", () => {
  const input = {
    ...baseSnapshot,
    telemetry: {
      soc: 99.6,
      current_trip_consumption_kwh_100km: 14.63,
      current_trip_distance_km: 12,
    },
  };
  const trips = [
    { avg_consumption_kwh_100km: 14.3702, distance_km: 50, sample_count: 100 },
  ];
  const withoutReported = estimateVehicleRangeKm(input, trips, { batteryCapacityKwh: 45.1 });
  const withImpossibleReported = estimateVehicleRangeKm(
    { ...input, telemetry: { ...input.telemetry, range_est_km: 507.3 } },
    trips,
    { batteryCapacityKwh: 45.1 },
  );

  assert.deepEqual(withImpossibleReported, withoutReported);
});

test("omits range when authoritative car capacity is missing", () => {
  const estimate = estimateVehicleRangeKm(baseSnapshot, [], { batteryCapacityKwh: null });

  assert.deepEqual(estimate, { estimatedRangeKm: null, consumptionKwh100Km: null });
});

test("omits range when cars-row capacity is implausible", () => {
  const estimate = estimateVehicleRangeKm(baseSnapshot, [], { batteryCapacityKwh: 500 });

  assert.deepEqual(estimate, { estimatedRangeKm: null, consumptionKwh100Km: null });
});

test("uses car profile battery capacity when provided", () => {
  const estimate = estimateVehicleRangeKm(
    { ...baseSnapshot, telemetry: { soc: 82, speed_kmh: 0 } },
    [{ avg_consumption_kwh_100km: 16.87, distance_km: 26.9, sample_count: 100 }],
    { batteryCapacityKwh: 45 },
  );

  assert.ok(estimate.estimatedRangeKm > 209);
  assert.ok(estimate.estimatedRangeKm < 225);
});
