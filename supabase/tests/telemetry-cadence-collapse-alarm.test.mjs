import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readMigration = (name) => readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8");

// The alarm table, schedule and delivery path; its detector is superseded below.
const installSql = await readMigration("20260908130000_telemetry_cadence_collapse_alarm.sql");
// The current detector definition.
const detectorSql = await readMigration("20260911100000_telemetry_cadence_consecutive_moving_gap.sql");

test("judges consecutive samples, both moving, more than 8 s apart", () => {
  // Each moving sample is paired with the sample immediately before it, of any speed ...
  assert.match(detectorSql, /earlier\.device_time < sample\.device_time\s+order by earlier\.device_time desc\s+limit 1/);
  // ... and the pair only counts when that predecessor is moving too, so a stop between
  // two moving samples (the old false positive) is never measured as a gap.
  assert.match(detectorSql, /sample\.diplus_speed_kmh > 0/);
  assert.match(detectorSql, /previous\.diplus_speed_kmh > 0/);
  assert.match(detectorSql, /worst_gap_seconds > 8/);
  assert.doesNotMatch(detectorSql, /moving_gap_seconds > 5/);
});

test("judges every pair delivered since the previous run, not one pair per run", () => {
  assert.match(detectorSql, /sample\.received_at >= v_now - interval '11 minutes'/);
  assert.doesNotMatch(detectorSql, /limit 2/);
});

test("resolves a gap alarm only on fresh clean moving pairs", () => {
  assert.match(
    detectorSql,
    /signal = 'moving_gap'\s+and observation\.moving_pair_count > 0\s+and observation\.worst_gap_seconds <= 8/,
  );
});

test("keeps the independent 24-hour floor", () => {
  assert.match(detectorSql, /sample_count_24h < 500/);
  assert.doesNotMatch(detectorSql, /preceding 10 minutes|sample_count[^\n]*< 60/i);
});

test("schedules the detector every ten minutes and delivers through the app", () => {
  assert.match(installSql, /3,13,23,33,43,53 \* \* \* \*/);
  assert.match(detectorSql, /\/api\/cron\/telemetry-cadence-alarm/);
  assert.doesNotMatch(detectorSql, /api\.telegram\.org/);
});

test("keeps one open audit per vehicle and signal", () => {
  assert.match(installSql, /unique index[\s\S]*\(user_id, vehicle_id, signal\)[\s\S]*where resolved_at is null/i);
  assert.equal(
    detectorSql.match(/on conflict \(user_id, vehicle_id, signal\) where resolved_at is null do nothing/gi)?.length,
    2,
  );
});
