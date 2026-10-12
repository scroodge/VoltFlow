import assert from "node:assert/strict";
import { test } from "node:test";

import { sessionStartOdometerKm } from "./session-start-odometer.ts";

const sample = (device_time, odometer_km) => ({
  device_time,
  telemetry: { odometer_km },
});

test("returns the earliest sample's odometer regardless of order", () => {
  assert.equal(
    sessionStartOdometerKm([
      sample("2026-10-12T10:05:00Z", 12346),
      sample("2026-10-12T10:00:00Z", 12345),
    ]),
    12345,
  );
});

test("skips samples without a usable odometer", () => {
  assert.equal(
    sessionStartOdometerKm([
      sample("2026-10-12T10:00:00Z", null),
      sample("2026-10-12T10:01:00Z", 0),
      sample("2026-10-12T10:02:00Z", Number.NaN),
      { device_time: "2026-10-12T10:03:00Z", telemetry: {} },
      sample("2026-10-12T10:04:00Z", 12345.6),
    ]),
    12345.6,
  );
});

test("returns null when no sample reports an odometer", () => {
  assert.equal(sessionStartOdometerKm([]), null);
  assert.equal(
    sessionStartOdometerKm([sample("2026-10-12T10:00:00Z", null)]),
    null,
  );
});
