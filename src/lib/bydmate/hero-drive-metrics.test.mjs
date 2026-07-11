import assert from "node:assert/strict";
import test from "node:test";

import {
  computeHeroDriveMetrics,
  dedupeTripsBySource,
  findLastFinishedChargeSession,
  formatHeroDistanceKm,
  formatKmPerPercent,
  resolveKmPerPercentSoc,
  sumDistanceSinceCharge,
  tripDistanceKm,
} from "./hero-drive-metrics.ts";

const baseTrip = {
  id: "trip-1",
  user_id: "user-1",
  vehicle_id: "way",
  started_at: "2026-06-16T10:00:00.000Z",
  ended_at: "2026-06-16T10:30:00.000Z",
  last_device_time: "2026-06-16T10:30:00.000Z",
  sample_count: 10,
  track_point_count: 5,
  distance_km: 12,
  soc_start: 90,
  soc_end: 85,
  max_speed_kmh: 80,
  avg_speed_kmh: 40,
  avg_consumption_kwh_100km: 16,
};

test("findLastFinishedChargeSession picks newest finished session for car", () => {
  const sessions = [
    {
      id: "s1",
      car_id: "car-a",
      status: "stopped",
      stopped_at: "2026-06-15T08:00:00.000Z",
      started_at: "2026-06-15T07:00:00.000Z",
      created_at: "2026-06-15T07:00:00.000Z",
    },
    {
      id: "s2",
      car_id: "car-a",
      status: "completed",
      stopped_at: "2026-06-16T06:00:00.000Z",
      started_at: "2026-06-16T05:00:00.000Z",
      created_at: "2026-06-16T05:00:00.000Z",
    },
    {
      id: "s3",
      car_id: "car-b",
      status: "completed",
      stopped_at: "2026-06-16T07:00:00.000Z",
      started_at: "2026-06-16T06:30:00.000Z",
      created_at: "2026-06-16T06:30:00.000Z",
    },
  ];

  const latest = findLastFinishedChargeSession(sessions, "car-a");
  assert.equal(latest?.id, "s2");
});

test("sumDistanceSinceCharge sums trips after anchor and uses live distance for open trip", () => {
  const trips = [
    {
      ...baseTrip,
      id: "old",
      started_at: "2026-06-15T12:00:00.000Z",
      distance_km: 50,
    },
    {
      ...baseTrip,
      id: "after",
      started_at: "2026-06-16T08:00:00.000Z",
      ended_at: "2026-06-16T08:20:00.000Z",
      distance_km: 8,
    },
    {
      ...baseTrip,
      id: "open",
      started_at: "2026-06-16T09:00:00.000Z",
      ended_at: null,
      distance_km: 3,
    },
  ];

  const total = sumDistanceSinceCharge(trips, "2026-06-16T06:00:00.000Z", 5.5);
  assert.equal(total, 13.5);
});

test("tripDistanceKm prefers live distance for ongoing trip", () => {
  const ongoing = { ...baseTrip, ended_at: null, distance_km: 4 };
  assert.equal(tripDistanceKm(ongoing, 6.2), 6.2);
});

test("resolveKmPerPercentSoc uses SOC delta for closed trip", () => {
  const kmPerPercent = resolveKmPerPercentSoc({
    trip: baseTrip,
    liveSoc: null,
    liveDistanceKm: null,
    batteryCapacityKwh: 45,
    consumptionKwh100: null,
  });
  assert.ok(kmPerPercent != null && Math.abs(kmPerPercent - 2.4) < 0.001);
});

test("resolveKmPerPercentSoc falls back to consumption when SOC delta is too small", () => {
  const trip = { ...baseTrip, soc_start: 80, soc_end: 79.5, distance_km: 2 };
  const kmPerPercent = resolveKmPerPercentSoc({
    trip,
    liveSoc: null,
    liveDistanceKm: null,
    batteryCapacityKwh: 45,
    consumptionKwh100: 15,
  });
  assert.ok(kmPerPercent != null && Math.abs(kmPerPercent - 3) < 0.001);
});

test("dedupeTripsBySource drops energydata twins for gen2_2025", () => {
  const telemetryTrip = {
    ...baseTrip,
    id: "tel-1",
    source: "telemetry",
    started_at: "2026-07-06T04:25:45.000Z",
    ended_at: "2026-07-06T04:40:17.000Z",
    distance_km: 5.1,
  };
  const energydataTwin = {
    ...baseTrip,
    id: "byd-1",
    source: "byd_energydata",
    started_at: "2026-07-06T04:23:24.000Z",
    ended_at: "2026-07-06T04:40:34.000Z",
    distance_km: 5,
    soc_start: null,
    soc_end: null,
    sample_count: 0,
  };
  const energydataOrphan = {
    ...baseTrip,
    id: "byd-2",
    source: "byd_energydata",
    started_at: "2026-07-05T10:00:00.000Z",
    ended_at: "2026-07-05T10:20:00.000Z",
    distance_km: 4,
    soc_start: null,
    soc_end: null,
    sample_count: 0,
  };
  const trips = [telemetryTrip, energydataTwin, energydataOrphan];

  const deduped = dedupeTripsBySource(trips, "gen2_2025");
  assert.deepEqual(
    deduped.map((trip) => trip.id),
    ["tel-1", "byd-2"],
  );

  // model_generation defaults to gen1_2024, and prod has DiLink 5 cars still
  // carrying it — observed energydata rows activate the dedupe regardless.
  assert.deepEqual(
    dedupeTripsBySource(trips, "gen1_2024").map((trip) => trip.id),
    ["tel-1", "byd-2"],
  );
  assert.deepEqual(
    dedupeTripsBySource(trips, null).map((trip) => trip.id),
    ["tel-1", "byd-2"],
  );

  // True DiLink 3 data (telemetry only) passes through untouched.
  const telemetryOnly = [telemetryTrip, { ...telemetryTrip, id: "tel-2" }];
  assert.equal(dedupeTripsBySource(telemetryOnly, "gen1_2024").length, 2);
});

test("computeHeroDriveMetrics does not double-count energydata twins", () => {
  const sessions = [
    {
      id: "s1",
      car_id: "car-a",
      status: "stopped",
      stopped_at: "2026-07-03T11:54:40.000Z",
      started_at: "2026-07-03T07:44:57.000Z",
      created_at: "2026-07-03T07:44:57.000Z",
    },
  ];
  const trips = [
    {
      ...baseTrip,
      id: "tel-1",
      source: "telemetry",
      started_at: "2026-07-06T04:25:45.000Z",
      ended_at: "2026-07-06T04:40:17.000Z",
      distance_km: 5.1,
    },
    {
      ...baseTrip,
      id: "byd-1",
      source: "byd_energydata",
      started_at: "2026-07-06T04:23:24.000Z",
      ended_at: "2026-07-06T04:40:34.000Z",
      distance_km: 5,
      soc_start: null,
      soc_end: null,
      sample_count: 0,
    },
  ];

  const metrics = computeHeroDriveMetrics({
    sessions,
    carId: "car-a",
    trips,
    snapshot: { telemetry: {} },
    batteryCapacityKwh: 45.1,
    modelGeneration: "gen2_2025",
  });
  assert.equal(metrics.distanceSinceChargeKm, 5.1);
});

test("computeHeroDriveMetrics returns null distance without finished session", () => {
  const metrics = computeHeroDriveMetrics({
    sessions: [],
    carId: "car-a",
    trips: [baseTrip],
    snapshot: { telemetry: {} },
    batteryCapacityKwh: 45,
  });
  assert.equal(metrics.distanceSinceChargeKm, null);
});

test("formatters render dash for missing values", () => {
  assert.equal(formatHeroDistanceKm(null), "—");
  assert.equal(formatKmPerPercent(undefined), "—");
  assert.equal(formatHeroDistanceKm(42.18), "42.2 km");
  assert.equal(formatKmPerPercent(4.2), "4.2 ");
});
