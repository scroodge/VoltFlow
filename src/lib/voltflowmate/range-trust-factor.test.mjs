import test from "node:test";
import assert from "node:assert/strict";

import { computeRangeTrustFactor, correctCarPromise } from "./range-trust-factor.ts";

const DAY_MS = 86_400_000;
const NOW = "2026-10-06T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);

function cycle(daysAgo, predictedKmAt100, actualKmAt100) {
  return {
    promiseSessionId: `p-${daysAgo}`,
    nextSessionId: `n-${daysAgo}`,
    chargeEndedAt: new Date(NOW_MS - (daysAgo + 1) * DAY_MS).toISOString(),
    cycleEndedAt: new Date(NOW_MS - daysAgo * DAY_MS).toISOString(),
    promiseKm: predictedKmAt100,
    anchorSoc: 100,
    predictedKmAt100,
    actualKmAt100,
    errorPct: 0,
    distanceTraveledKm: 50,
    socDropPercent: 25,
    tripCount: 3,
    cycleDays: 1,
  };
}

test("returns null below the minimum sample size", () => {
  const cycles = [cycle(1, 250, 200), cycle(5, 250, 210)];
  assert.equal(computeRangeTrustFactor(cycles, { nowIso: NOW }), null);
});

test("recent-weighted median for an optimistic car lands below 1", () => {
  const cycles = [
    cycle(1, 250, 200), // 0.80
    cycle(5, 250, 212.5), // 0.85
    cycle(10, 250, 187.5), // 0.75
    cycle(20, 250, 205), // 0.82
  ];
  const trust = computeRangeTrustFactor(cycles, { nowIso: NOW });
  assert.equal(trust.factor, 0.8); // cumulative weight crosses the half at the recent 0.80
  assert.equal(trust.sampleCycles, 4);
  assert.equal(trust.windowDays, 90);
});

test("one extreme outlier cannot swing the median", () => {
  const cycles = [
    cycle(1, 250, 200), // 0.80
    cycle(5, 250, 200), // 0.80
    cycle(10, 250, 200), // 0.80
    cycle(20, 250, 625), // 2.5 — nonsense spike
  ];
  assert.equal(computeRangeTrustFactor(cycles, { nowIso: NOW }).factor, 0.8);
});

test("pessimistic promises clamp at the upper bound", () => {
  const cycles = [cycle(1, 100, 200), cycle(5, 100, 250), cycle(10, 100, 300)];
  assert.equal(computeRangeTrustFactor(cycles, { nowIso: NOW }).factor, 1.15);
});

test("collapsed promises clamp at the lower bound", () => {
  const cycles = [cycle(1, 300, 50), cycle(5, 300, 40), cycle(10, 300, 60)];
  assert.equal(computeRangeTrustFactor(cycles, { nowIso: NOW }).factor, 0.5);
});

test("cycles older than the trailing window are ignored", () => {
  const cycles = [
    cycle(1, 250, 200),
    cycle(5, 250, 200),
    cycle(10, 250, 200),
    cycle(120, 250, 100),
    cycle(200, 250, 100),
  ];
  const trust = computeRangeTrustFactor(cycles, { nowIso: NOW });
  assert.equal(trust.sampleCycles, 3);
  assert.equal(trust.factor, 0.8);
});

test("zero or broken cycle numbers are excluded from the sample", () => {
  const cycles = [
    cycle(1, 250, 200),
    cycle(5, 250, 200),
    cycle(10, 250, 200),
    cycle(15, 0, 100),
    cycle(20, 250, 0),
  ];
  const trust = computeRangeTrustFactor(cycles, { nowIso: NOW });
  assert.equal(trust.sampleCycles, 3);
});

test("a recent promise-regime shift wins over stale majority", () => {
  // Plain median would say 0.5 (5 stale cycles vs 3 recent); recency weight must follow
  // the fresh regime — this mirrors the car's late-September promise behavior change.
  const cycles = [
    cycle(30, 250, 125), // 0.50 old regime
    cycle(35, 250, 125),
    cycle(40, 250, 125),
    cycle(50, 250, 125),
    cycle(60, 250, 125),
    cycle(1, 250, 225), // 0.90 new regime
    cycle(2, 250, 225),
    cycle(3, 250, 225),
  ];
  assert.equal(computeRangeTrustFactor(cycles, { nowIso: NOW }).factor, 0.9);
});

test("custom window size is honored", () => {
  const cycles = [
    cycle(1, 250, 200),
    cycle(5, 250, 200),
    cycle(10, 250, 200),
    cycle(40, 250, 100),
  ];
  const trust = computeRangeTrustFactor(cycles, { nowIso: NOW, windowDays: 30 });
  assert.equal(trust.sampleCycles, 3);
  assert.equal(trust.windowDays, 30);
  assert.equal(trust.factor, 0.8);
});

test("correctCarPromise scales a plausible promise", () => {
  const trust = { factor: 0.85, sampleCycles: 5, windowDays: 90 };
  assert.equal(correctCarPromise(245, trust), 208); // 245 × 0.85 = 208.25
  assert.equal(correctCarPromise(120, trust), 102);
});

test("correctCarPromise returns null without a learned trust factor", () => {
  assert.equal(correctCarPromise(245, null), null);
});

test("correctCarPromise rejects implausible promises instead of scaling them", () => {
  const trust = { factor: 0.85, sampleCycles: 5, windowDays: 90 };
  for (const bad of [null, undefined, 0, -50, Number.NaN, 1200]) {
    assert.equal(correctCarPromise(bad, trust), null);
  }
});
