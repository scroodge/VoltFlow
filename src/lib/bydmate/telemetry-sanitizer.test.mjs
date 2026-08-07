import test from "node:test";
import assert from "node:assert/strict";

import {
  filterDisplayTripTrackPoints,
  sanitizeLocation,
  sanitizePayloadLocations,
  sanitizePayloadTelemetry,
  sanitizeTripTrackPoints,
} from "./telemetry-sanitizer.ts";

const baseLocation = {
  lat: 53.92552049,
  lon: 27.63499593,
  accuracy_m: 3.7900924682617188,
  bearing_deg: 73.4,
};

test("drops low-confidence GPS points without bearing", () => {
  const result = sanitizeLocation(
    {
      lat: 53.928705,
      lon: 27.639588,
      accuracy_m: 142.6999969482422,
      bearing_deg: null,
    },
    undefined,
    Date.parse("2026-05-21T17:16:19.145Z"),
    { speed_kmh: 3 },
  );

  assert.equal(result.accepted, null);
  assert.deepEqual(result.location, {});
});

test("drops GPS jumps that contradict telemetry speed", () => {
  const previous = {
    lat: 53.92644457,
    lon: 27.63840415,
    deviceTimeMs: Date.parse("2026-05-21T17:17:28.592Z"),
    speedKmh: 25,
  };

  const result = sanitizeLocation(
    {
      lat: 53.927393,
      lon: 27.639089,
      accuracy_m: 3.7900924682617188,
      bearing_deg: 105,
    },
    previous,
    Date.parse("2026-05-21T17:17:29.782Z"),
    { speed_kmh: 27 },
  );

  assert.equal(result.accepted, null);
  assert.deepEqual(result.location, {});
});

test("keeps plausible moving GPS points", () => {
  const previous = {
    lat: baseLocation.lat,
    lon: baseLocation.lon,
    deviceTimeMs: Date.parse("2026-05-21T17:16:26.164Z"),
    speedKmh: 12,
  };

  const result = sanitizeLocation(
    {
      lat: 53.92569747,
      lon: 27.63530375,
      accuracy_m: 3.7900924682617188,
      bearing_deg: 68.80000305175781,
    },
    previous,
    Date.parse("2026-05-21T17:16:29.686Z"),
    { speed_kmh: 11 },
  );

  assert.equal(result.accepted?.lat, 53.92569747);
  assert.equal(result.location.bearing_deg, 68.80000305175781);
});

test("counts dropped coordinates in ordered batch sanitizing", () => {
  const payloads = [
    {
      schema_version: 1,
      vehicle_id: "way",
      device_time: "2026-05-21T17:17:29.782Z",
      source: "BYDMate",
      telemetry: { speed_kmh: 27 },
      location: {
        lat: 53.927393,
        lon: 27.639089,
        accuracy_m: 90.0999984741211,
        bearing_deg: null,
      },
    },
    {
      schema_version: 1,
      vehicle_id: "way",
      device_time: "2026-05-21T17:17:28.592Z",
      source: "BYDMate",
      telemetry: { speed_kmh: 25 },
      location: {
        lat: 53.92644457,
        lon: 27.63840415,
        accuracy_m: 3.7900924682617188,
        bearing_deg: 105,
      },
    },
  ];

  const result = sanitizePayloadLocations(payloads, new Map());

  assert.equal(result.droppedLocations, 1);
  assert.equal(result.payloads[0].location.lat, undefined);
  assert.equal(result.payloads[1].location.lat, 53.92644457);
});

test("drops the DiPlus negative SOC sentinel without discarding valid telemetry", () => {
  const result = sanitizePayloadTelemetry(
    [
      {
        schema_version: 1,
        vehicle_id: "way",
        device_time: "2026-08-07T12:39:05.683Z",
        source: "BYDMate",
        telemetry: { soc: 100, charge_power_kw: 4 },
        diplus: { soc: -1, charge_gun_state: 2 },
      },
    ],
    new Map(),
  );

  assert.equal(result.payloads[0].telemetry.soc, 100);
  assert.equal(result.payloads[0].diplus.soc, undefined);
  assert.equal(result.payloads[0].diplus.charge_gun_state, 2);
  assert.equal(result.droppedTelemetryFields, 1);
});

test("filters persisted trip track points for legacy dirty trips", () => {
  const result = sanitizeTripTrackPoints([
    {
      device_time: "2026-05-21T17:17:28.592Z",
      lat: 53.92644457,
      lon: 27.63840415,
      accuracy_m: 3.7900924682617188,
      bearing_deg: 105,
      speed_kmh: 25,
    },
    {
      device_time: "2026-05-21T17:17:29.782Z",
      lat: 53.927393,
      lon: 27.639089,
      accuracy_m: 90.0999984741211,
      bearing_deg: null,
      speed_kmh: 27,
    },
    {
      device_time: "2026-05-21T17:17:30.926Z",
      lat: 53.92642939,
      lon: 27.63861885,
      accuracy_m: 3.7900924682617188,
      bearing_deg: 95.19999694824219,
      speed_kmh: 30,
    },
  ]);

  assert.equal(result.droppedPointCount, 1);
  assert.equal(result.points.length, 2);
  assert.equal(result.points[0].device_time, "2026-05-21T17:17:28.592Z");
  assert.equal(result.points[1].device_time, "2026-05-21T17:17:30.926Z");
});

test("keeps persisted trip track points for map display without jump re-filtering", () => {
  const result = filterDisplayTripTrackPoints([
    {
      device_time: "2026-05-21T17:17:28.592Z",
      lat: 53.92644457,
      lon: 27.63840415,
      accuracy_m: 3.7900924682617188,
      bearing_deg: 105,
      speed_kmh: 25,
    },
    {
      device_time: "2026-05-21T17:17:29.782Z",
      lat: 53.927393,
      lon: 27.639089,
      accuracy_m: 90.0999984741211,
      bearing_deg: null,
      speed_kmh: 27,
    },
    {
      device_time: "2026-05-21T17:17:30.926Z",
      lat: 53.92642939,
      lon: 27.63861885,
      accuracy_m: 3.7900924682617188,
      bearing_deg: 95.19999694824219,
      speed_kmh: 30,
    },
  ]);

  assert.equal(result.droppedPointCount, 0);
  assert.equal(result.points.length, 3);
});
