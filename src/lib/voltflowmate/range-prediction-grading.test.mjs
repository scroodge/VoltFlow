import test from "node:test";
import assert from "node:assert/strict";

import { gradeRangePredictionCycles } from "./range-prediction-grading.ts";

const DAY_MS = 86_400_000;
const T0 = Date.parse("2026-09-01T12:00:00.000Z");

function iso(offsetDays) {
  return new Date(T0 + offsetDays * DAY_MS).toISOString();
}

function session(id, { stopDay, startDay = stopDay - 1, startPercent = 20, promise = null, anchor = null }) {
  return {
    id,
    status: "completed",
    start_percent: startPercent,
    started_at: iso(startDay),
    stopped_at: stopDay == null ? null : iso(stopDay),
    end_range_est_km: promise,
    end_range_soc: anchor,
  };
}

function trips(startDays, distanceKm) {
  return startDays.map((day) => ({ started_at: iso(day), distance_km: distanceKm }));
}

const window = { from: iso(0), to: iso(60) };

test("grades a clean cycle: promise vs actual km per % SOC", () => {
  const sessions = [
    session("a", { stopDay: 0, promise: 300, anchor: 100 }),
    session("b", { stopDay: 5, startDay: 4, startPercent: 50 }),
  ];
  // 100 km driven between charge A end and charge B start → 2 km/% actual vs 3 km/% promised
  const report = gradeRangePredictionCycles(sessions, trips([1, 2], 50), window);

  assert.equal(report.gradedCount, 1);
  const cycle = report.cycles[0];
  assert.equal(cycle.predictedKmAt100, 300);
  assert.equal(cycle.actualKmAt100, 200);
  assert.equal(cycle.errorPct, -33.3);
  assert.equal(cycle.distanceTraveledKm, 100);
  assert.equal(cycle.socDropPercent, 50);
  assert.equal(cycle.tripCount, 2);
  assert.equal(report.optimisticCount, 1);
});

test("skips pairs without a promise or with a tiny SOC drop", () => {
  const noPromise = [
    session("a", { stopDay: 0, promise: null, anchor: null }),
    session("b", { stopDay: 5, startDay: 4, startPercent: 50 }),
  ];
  assert.equal(gradeRangePredictionCycles(noPromise, trips([1], 50), window).gradedCount, 0);

  const tinyDrop = [
    session("a", { stopDay: 0, promise: 300, anchor: 50 }),
    session("b", { stopDay: 1, startDay: 0.5, startPercent: 49 }),
  ];
  assert.equal(gradeRangePredictionCycles(tinyDrop, trips([0.7], 10), window).gradedCount, 0);
});

test("skips parked-only cycles and over-long cycles", () => {
  const parked = [
    session("a", { stopDay: 0, promise: 300, anchor: 100 }),
    session("b", { stopDay: 5, startDay: 4, startPercent: 50 }),
  ];
  assert.equal(gradeRangePredictionCycles(parked, [], window).gradedCount, 0);

  const longCycle = [
    session("a", { stopDay: 0, promise: 300, anchor: 100 }),
    session("b", { stopDay: 60, startDay: 59, startPercent: 50 }),
  ];
  assert.equal(gradeRangePredictionCycles(longCycle, trips([30], 100), window).gradedCount, 0);
});

test("only counts trips inside the discharge gap", () => {
  const sessions = [
    session("a", { stopDay: 0, promise: 300, anchor: 100 }),
    session("b", { stopDay: 10, startDay: 9, startPercent: 50 }),
    session("c", { stopDay: 20, startDay: 19, startPercent: 30 }),
  ];
  // trips before charge A's end and after B's start must not land in the A→B cycle
  const report = gradeRangePredictionCycles(sessions, trips([-1, 5, 15], 40), window);
  const ab = report.cycles.find((cycle) => cycle.promiseSessionId === "a");
  assert.equal(ab.distanceTraveledKm, 40);
  assert.equal(ab.tripCount, 1);
});

test("summary aggregates across cycles", () => {
  const sessions = [
    session("a", { stopDay: 0, promise: 300, anchor: 100 }),
    session("b", { stopDay: 5, startDay: 4, startPercent: 50 }),
    session("c", { stopDay: 10, startDay: 9, startPercent: 25, promise: 250, anchor: 95 }),
  ];
  // A→B: 1.2 km/% (60 km over 50%) vs 3 promised (-60%); B has no promise → B→C skipped.
  const report = gradeRangePredictionCycles(sessions, trips([1, 6], 60), window);
  assert.equal(report.gradedCount, 1);
  assert.equal(report.meanErrorPct, -60);
  assert.equal(report.medianErrorPct, -60);
});

const ab = [
  session("a", { stopDay: 0, promise: 300, anchor: 100 }),
  session("b", { stopDay: 5, startDay: 4, startPercent: 50 }),
];

function tripAt(day, distanceKm, durationS) {
  const started = iso(day);
  return {
    started_at: started,
    distance_km: distanceKm,
    ended_at: new Date(Date.parse(started) + durationS * 1000).toISOString(),
  };
}

test("skips a cycle that contains an odometer-scale trip (44,123 km in 6 minutes)", () => {
  const report = gradeRangePredictionCycles(
    ab,
    [tripAt(1, 44122.9, 353), tripAt(2, 50, 3600)],
    window,
  );
  assert.equal(report.gradedCount, 0);
  assert.equal(report.trust, null);
});

test("skips a cycle whose trip implies an impossible speed below the km cap", () => {
  // 90 km in 5 minutes = 1080 km/h
  const report = gradeRangePredictionCycles(ab, [tripAt(1, 90, 300)], window);
  assert.equal(report.gradedCount, 0);
});

test("a dirty cycle does not poison its clean neighbour", () => {
  const sessions = [
    session("a", { stopDay: 0, promise: 300, anchor: 100 }),
    session("b", { stopDay: 5, startDay: 4, startPercent: 50, promise: 250, anchor: 100 }),
    session("c", { stopDay: 10, startDay: 9, startPercent: 25 }),
  ];
  const report = gradeRangePredictionCycles(
    sessions,
    [tripAt(1, 44122.9, 353), tripAt(6, 75, 3600)],
    window,
  );
  assert.equal(report.gradedCount, 1);
  assert.equal(report.cycles[0].promiseSessionId, "b");
  assert.equal(report.cycles[0].distanceTraveledKm, 75);
});

test("legitimate trips with an end time are graded exactly as before", () => {
  const report = gradeRangePredictionCycles(
    ab,
    [tripAt(1, 50, 3600), tripAt(2, 50, 3600)],
    window,
  );
  assert.equal(report.gradedCount, 1);
  assert.equal(report.cycles[0].actualKmAt100, 200);
  assert.equal(report.cycles[0].tripCount, 2);
});
