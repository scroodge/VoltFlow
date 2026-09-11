import assert from "node:assert/strict";
import test from "node:test";

import { cadenceAlarmMessage } from "./cadence-alarm-message.ts";

const gapAlarm = (gap_seconds) => ({
  vehicle_id: "car",
  signal: "moving_gap",
  observed_at: "2026-01-01T00:00:00+00:00",
  gap_seconds,
  sample_count_24h: null,
});

test("formats a moving gap as a readable duration", () => {
  assert.match(cadenceAlarmMessage(gapAlarm(9.4)), /Moving samples were 9s apart\./);
  assert.match(cadenceAlarmMessage(gapAlarm(265.2)), /Moving samples were 4m 25s apart\./);
  assert.match(cadenceAlarmMessage(gapAlarm(20838)), /Moving samples were 5h 47m apart\./);
});

test("accepts PostgREST numeric strings", () => {
  assert.match(cadenceAlarmMessage(gapAlarm("265.200")), /4m 25s/);
});

test("reports the 24-hour floor by sample count", () => {
  const message = cadenceAlarmMessage({
    vehicle_id: "car",
    signal: "low_24h_count",
    observed_at: "2026-01-01T00:00:00+00:00",
    gap_seconds: null,
    sample_count_24h: 126,
  });
  assert.equal(
    message,
    "⚠️ VoltFlow telemetry cadence collapsed for car.\nOnly 126 telemetry samples arrived in 24 hours.\nObserved: 2026-01-01T00:00:00+00:00",
  );
});
