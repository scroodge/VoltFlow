import assert from "node:assert/strict";
import test from "node:test";

import { cadenceAlarmMessage } from "./cadence-alarm-message.ts";

const gapAlarm = (gap_seconds) => ({
  user_id: "00000000-0000-4000-8000-000000000001",
  vehicle_id: "car",
  signal: "moving_gap",
  observed_at: "2026-01-01T00:04:25+00:00",
  previous_moving_at: "2026-01-01T00:00:00+00:00",
  gap_seconds,
  sample_count_24h: null,
});

test("formats a moving gap as a readable duration", () => {
  assert.match(cadenceAlarmMessage(gapAlarm(9.4), null), /Moving samples were 9s apart\./);
  assert.match(cadenceAlarmMessage(gapAlarm(265.2), null), /Moving samples were 4m 25s apart\./);
  assert.match(cadenceAlarmMessage(gapAlarm(20838), null), /Moving samples were 5h 47m apart\./);
});

test("accepts PostgREST numeric strings", () => {
  assert.match(cadenceAlarmMessage(gapAlarm("265.200"), null), /4m 25s/);
});

test("names the owner and the gap window for the admin", () => {
  assert.equal(
    cadenceAlarmMessage(gapAlarm(265.2), "owner@example.com"),
    "⚠️ VoltFlow telemetry cadence alarm: car (owner@example.com).\n" +
      "Moving samples were 4m 25s apart.\n" +
      "From: 2026-01-01T00:00:00+00:00\nTo: 2026-01-01T00:04:25+00:00",
  );
});

test("falls back to the user id when the owner has no email", () => {
  assert.match(
    cadenceAlarmMessage(gapAlarm(10), null),
    /\(user 00000000-0000-4000-8000-000000000001\)/,
  );
});

test("reports the 24-hour floor by sample count", () => {
  const message = cadenceAlarmMessage(
    { ...gapAlarm(null), signal: "low_24h_count", previous_moving_at: null, sample_count_24h: 126 },
    "owner@example.com",
  );
  assert.equal(
    message,
    "⚠️ VoltFlow telemetry cadence alarm: car (owner@example.com).\n" +
      "Only 126 telemetry samples arrived in 24 hours.\nLast contact: 2026-01-01T00:04:25+00:00",
  );
});
