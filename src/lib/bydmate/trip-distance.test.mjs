import assert from "node:assert/strict";
import test from "node:test";

import {
  odometerDeltaFromSamples,
  odometerDeltaKm,
  resolvePreferredTripDistanceKm,
  trackPathDistanceKm,
  tripDistanceSourcesAgree,
} from "./trip-distance.ts";

test("tripDistanceSourcesAgree accepts small absolute and relative deltas", () => {
  assert.equal(tripDistanceSourcesAgree(12, 12.4), true);
  assert.equal(tripDistanceSourcesAgree(0.4, 0.9), true);
  assert.equal(tripDistanceSourcesAgree(12, 20), false);
});

test("trackPathDistanceKm sums haversine segments", () => {
  const distance = trackPathDistanceKm([
    { lat: 53.9, lon: 27.56 },
    { lat: 53.901, lon: 27.561 },
    { lat: 53.902, lon: 27.562 },
  ]);
  assert.ok(distance != null && distance > 0.2 && distance < 0.4);
});

test("odometerDeltaKm uses first and last readings", () => {
  const odometerDelta = odometerDeltaKm([10_000, 10_012.3]);
  assert.ok(odometerDelta != null && Math.abs(odometerDelta - 12.3) < 0.001);
  assert.equal(odometerDeltaKm([10_000]), null);
});

test("odometerDeltaFromSamples reads telemetry and diplus mileage", () => {
  const delta = odometerDeltaFromSamples([
    { telemetry: { odometer_km: 100 } },
    { diplus_mileage_km: 108.2 },
  ]);
  assert.ok(delta != null && Math.abs(delta - 8.2) < 0.001);
});

test("resolvePreferredTripDistanceKm prefers GPS when odometer agrees", () => {
  assert.equal(
    resolvePreferredTripDistanceKm({
      gpsDistanceKm: 11.2,
      odometerDistanceKm: 11.5,
      tripCounterDistanceKm: 10,
      storedDistanceKm: 9,
    }),
    11.2,
  );
});

test("resolvePreferredTripDistanceKm falls back to odometer when GPS disagrees", () => {
  assert.equal(
    resolvePreferredTripDistanceKm({
      gpsDistanceKm: 2.1,
      odometerDistanceKm: 12.4,
      storedDistanceKm: 12,
    }),
    12.4,
  );
});

test("resolvePreferredTripDistanceKm uses odometer when GPS is missing", () => {
  assert.equal(
    resolvePreferredTripDistanceKm({
      odometerDistanceKm: 8.6,
      storedDistanceKm: 7,
    }),
    8.6,
  );
});
