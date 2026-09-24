import assert from "node:assert/strict";
import test from "node:test";

import { cadenceDigestMessage, groupCadenceDigestAlarms } from "./cadence-digest-message.ts";

const gapAlarm = (observed_at, gap_seconds, overrides = {}) => ({
  user_id: "00000000-0000-4000-8000-000000000001",
  vehicle_id: "BYD Yuan Up 25",
  signal: "moving_gap",
  observed_at,
  gap_seconds,
  sample_count_24h: null,
  ...overrides,
});

const countAlarm = (observed_at, sample_count_24h, overrides = {}) => ({
  user_id: "00000000-0000-4000-8000-000000000002",
  vehicle_id: "BYD Yuan Up",
  signal: "low_24h_count",
  observed_at,
  gap_seconds: null,
  sample_count_24h,
  ...overrides,
});

test("groups repeats of the same tuple and keeps the worst gap and latest timestamp", () => {
  const groups = groupCadenceDigestAlarms([
    gapAlarm("2026-09-24T07:36:36+00:00", 121),
    gapAlarm("2026-09-24T10:49:33+00:00", 26),
    gapAlarm("2026-09-24T14:23:00+00:00", 101),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].count, 3);
  assert.equal(groups[0].worstGapSeconds, 121);
  assert.equal(groups[0].latestObservedAt, "2026-09-24T14:23:00+00:00");
});

test("keeps different vehicles and different signals as separate groups", () => {
  const groups = groupCadenceDigestAlarms([
    gapAlarm("2026-09-24T07:36:36+00:00", 121),
    countAlarm("2026-09-23T17:43:00+00:00", 285),
    countAlarm("2026-09-23T05:33:00+00:00", 347, { user_id: "00000000-0000-4000-8000-000000000003" }),
  ]);
  assert.equal(groups.length, 3);
});

test("tracks the lowest (worst) sample count for a low_24h_count group", () => {
  const groups = groupCadenceDigestAlarms([countAlarm("2026-09-11T04:53:00+00:00", 480), countAlarm("2026-09-23T17:43:00+00:00", 285)]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].worstSampleCount24h, 285);
});

test("formats a moving_gap digest line with count and worst duration", () => {
  const groups = groupCadenceDigestAlarms([
    gapAlarm("2026-09-24T07:36:36+00:00", 121),
    gapAlarm("2026-09-24T14:23:00+00:00", 26),
  ]);
  const message = cadenceDigestMessage(groups, new Map([[groups[0].user_id, "kevlar_5@meta.ua"]]));
  assert.match(message, /BYD Yuan Up 25 \(kevlar_5@meta\.ua\): 2x moving_gap, worst 2m 1s apart\. Last: 2026-09-24T14:23:00\+00:00/);
});

test("formats a low_24h_count digest line with count and worst sample count", () => {
  const groups = groupCadenceDigestAlarms([countAlarm("2026-09-23T17:43:00+00:00", 285)]);
  const message = cadenceDigestMessage(groups, new Map([[groups[0].user_id, "den4art@gmail.com"]]));
  assert.match(message, /BYD Yuan Up \(den4art@gmail\.com\): 1x low_24h_count, as low as 285 samples\/24h/);
});

test("falls back to the user id when the owner has no email", () => {
  const groups = groupCadenceDigestAlarms([gapAlarm("2026-09-24T07:36:36+00:00", 26)]);
  const message = cadenceDigestMessage(groups, new Map());
  assert.match(message, /\(user 00000000-0000-4000-8000-000000000001\)/);
});
