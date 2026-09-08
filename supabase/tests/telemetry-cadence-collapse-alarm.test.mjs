import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../migrations/20260908130000_telemetry_cadence_collapse_alarm.sql",
  import.meta.url,
);
const sql = await readFile(migrationUrl, "utf8");

test("uses the backtested moving-gap rule and independent 24-hour floor", () => {
  assert.match(sql, /diplus_speed_kmh > 0/);
  assert.match(sql, /moving_gap_seconds > 5/);
  assert.match(sql, /sample_count_24h < 500/);
  assert.doesNotMatch(sql, /preceding 10 minutes|sample_count[^\n]*< 60/i);
});

test("schedules the detector every ten minutes and delivers through the app", () => {
  assert.match(sql, /3,13,23,33,43,53 \* \* \* \*/);
  assert.match(sql, /\/api\/cron\/telemetry-cadence-alarm/);
  assert.doesNotMatch(sql, /api\.telegram\.org/);
});

test("keeps one open audit per vehicle and signal", () => {
  assert.match(sql, /unique index[\s\S]*\(user_id, vehicle_id, signal\)[\s\S]*where resolved_at is null/i);
  assert.match(sql, /on conflict \(user_id, vehicle_id, signal\) where resolved_at is null do nothing/i);
});
