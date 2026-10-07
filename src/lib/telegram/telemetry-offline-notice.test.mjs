import assert from "node:assert/strict";
import test from "node:test";

import { telemetryOfflineNotice } from "./telemetry-offline-notice.ts";

test("formats an actionable owner telemetry-offline notice without account identity", () => {
  const message = telemetryOfflineNotice({
    vehicleId: "BYD Yuan Up",
    lastContact: "2026-10-05T14:36:07.745+00:00",
    sampleCount24h: 268,
  });

  assert.match(message, /telemetry from BYD Yuan Up is no longer arriving/);
  assert.match(message, /Last contact: 2026-10-05T14:36:07\.745\+00:00/);
  assert.match(message, /Only 268 samples arrived in the last 24 hours/);
  assert.match(message, /Live status, remote commands, and automatic charging updates may be unavailable/);
  assert.doesNotMatch(message, /@|user [0-9a-f-]{8,}|email/i);
});

test("uses zero when the detector has no count", () => {
  assert.match(
    telemetryOfflineNotice({ vehicleId: "car", lastContact: "unknown", sampleCount24h: null }),
    /Only 0 samples arrived/,
  );
});
