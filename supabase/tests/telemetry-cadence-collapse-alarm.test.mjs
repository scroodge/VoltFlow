import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readMigration = (name) => readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8");

// The alarm table, schedule and delivery path; its detector is superseded below.
const installSql = await readMigration("20260908130000_telemetry_cadence_collapse_alarm.sql");
// Superseded by the cooldown/digest migration's detector redefinition, but still the
// source for the consecutive-pair rule assertions below (unchanged by that migration).
const detectorSql = await readMigration("20260911100000_telemetry_cadence_consecutive_moving_gap.sql");
// Historical admin cooldown/digest migration.
const digestSql = await readMigration("20260924100000_telemetry_cadence_alarm_digest.sql");
// Current owner-notice detector definition.
const ownerNoticeSql = await readMigration("20261007110000_owner_telemetry_offline_notices.sql");

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

test("keeps the SECURITY DEFINER detector off the public API roles", async () => {
  const revokeSql = await readMigration("20260911110000_revoke_cadence_detector_from_api_roles.sql");
  assert.match(
    revokeSql,
    /revoke execute on function public\.bydmate_detect_telemetry_cadence_collapses\(\) from anon, authenticated;/,
  );
});

test("keeps one open audit per vehicle and signal", () => {
  assert.match(installSql, /unique index[\s\S]*\(user_id, vehicle_id, signal\)[\s\S]*where resolved_at is null/i);
  assert.equal(
    detectorSql.match(/on conflict \(user_id, vehicle_id, signal\) where resolved_at is null do nothing/gi)?.length,
    2,
  );
});

test("the historical admin digest used a per-tuple cooldown", () => {
  assert.match(
    digestSql,
    /not exists \(\s*select 1\s*from public\.bydmate_telemetry_cadence_alarm_audits earlier[\s\S]*earlier\.notified_at >= v_now - interval '24 hours'/,
  );
  // The rule still keeps the consecutive-pair moving_gap logic and the 24h floor intact.
  assert.match(digestSql, /worst_gap_seconds > 8/);
  assert.match(digestSql, /sample_count_24h < 500/);
});

test("notifies only linked owners about low 24-hour telemetry counts", () => {
  assert.match(ownerNoticeSql, /audit\.signal = 'low_24h_count'/);
  assert.match(
    ownerNoticeSql,
    /from public\.profiles owner\s+where owner\.id = audit\.user_id\s+and owner\.telegram_id is not null/,
  );
  assert.match(ownerNoticeSql, /\/api\/cron\/telemetry-cadence-alarm/);
  assert.doesNotMatch(ownerNoticeSql, /api\.telegram\.org/);
});

test("keeps moving-gap alarms and unlinked owners out of Telegram delivery", () => {
  const deliveryLoop = ownerNoticeSql.match(/if exists \(select 1 from pg_extension where extname = 'pg_net'\)[\s\S]*?return jsonb_build_object/)?.[0] ?? "";
  assert.doesNotMatch(deliveryLoop, /audit\.signal = 'moving_gap'/);
  assert.match(deliveryLoop, /audit\.signal = 'low_24h_count'/);
  assert.match(deliveryLoop, /owner\.telegram_id is not null/);
});

test("unschedules the retired admin digest", () => {
  assert.match(ownerNoticeSql, /cron\.unschedule\(jobid\)[\s\S]*'telemetry-cadence-alarm-digest'/);
  assert.doesNotMatch(ownerNoticeSql, /cron\.schedule/);
});

test("keeps the digest dispatcher off the public API roles", () => {
  assert.match(
    digestSql,
    /revoke all on function public\.bydmate_dispatch_telemetry_cadence_digest\(\) from public;/,
  );
  assert.match(
    digestSql,
    /grant execute on function public\.bydmate_dispatch_telemetry_cadence_digest\(\) to service_role;/,
  );
});

test("also revokes the digest dispatcher from anon/authenticated (Supabase's explicit default grant)", async () => {
  // `revoke all ... from public` above does not remove Supabase's explicit default
  // EXECUTE grant to anon/authenticated on every new public function (AGENTS.md,
  // "Hard-won rules > Migrations"). Verified live right after applying 20260924100000:
  // bydmate_dispatch_telemetry_cadence_digest was executable by both. Fixed same-day.
  const revokeSql = await readMigration("20260924100001_revoke_cadence_digest_from_api_roles.sql");
  assert.match(
    revokeSql,
    /revoke execute on function public\.bydmate_dispatch_telemetry_cadence_digest\(\) from anon, authenticated;/,
  );
});

test("keeps the owner-notice detector off the public API roles", () => {
  assert.match(
    ownerNoticeSql,
    /revoke execute on function public\.bydmate_detect_telemetry_cadence_collapses\(\) from public, anon, authenticated;/,
  );
  assert.match(
    ownerNoticeSql,
    /grant execute on function public\.bydmate_detect_telemetry_cadence_collapses\(\) to service_role;/,
  );
});
