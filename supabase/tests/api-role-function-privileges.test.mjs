import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readMigration = (name) => readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8");

const apiRolesSql = await readMigration("20260911120000_revoke_server_only_definer_functions_from_api_roles.sql");
const publicSql = await readMigration("20260911121000_revoke_public_execute_on_server_only_definer_functions.sql");

// Server-only SECURITY DEFINER functions: called by service-role routes and pg_cron only.
const serverOnly = [
  "bydmate_apply_client_hourly",
  "bydmate_apply_client_trip",
  "bydmate_apply_diplus_columns",
  "bydmate_apply_hourly_rollup_sample",
  "bydmate_discard_trip_if_junk",
  "bydmate_enqueue_aux_voltage_backfill",
  "bydmate_enqueue_aux_voltage_day",
  "bydmate_finalize_trip_energy",
  "bydmate_ingest_telemetry",
  "bydmate_ingest_telemetry_batch",
  "bydmate_ingest_trip_summaries",
  "bydmate_materialize_aux_voltage_day",
  "bydmate_process_aux_voltage_rollup_queue",
  "bydmate_prune_telemetry_samples",
  "bydmate_update_hourly_energy",
  "purge_old_bydmate_aux_voltage_rollups",
  "purge_old_bydmate_telemetry",
  "rdp_simplify_trip_track",
  "simplify_aged_bydmate_trip_tracks",
];

// Needed by RLS policies, invoker functions, or the public knowledge base.
const mustStayCallable = ["is_admin", "is_user_premium", "increment_knowledge_article_view"];

const listedNames = (sql) => [...sql.matchAll(/^\s+'([a-z_]+)',?$/gm)].map((match) => match[1]).sort();

test("revokes every server-only function from anon, authenticated and PUBLIC", () => {
  assert.deepEqual(listedNames(apiRolesSql), [...serverOnly].sort());
  assert.deepEqual(listedNames(publicSql), [...serverOnly].sort());
  assert.match(apiRolesSql, /revoke execute on function %s from anon, authenticated/);
  // A revoke from anon alone leaves Postgres's built-in EXECUTE-to-PUBLIC in place.
  assert.match(publicSql, /revoke execute on function %s from public/);
});

test("revokes by name so every overload is covered", () => {
  for (const sql of [apiRolesSql, publicSql]) {
    assert.match(sql, /p\.oid::regprocedure/);
    assert.match(sql, /p\.proname = any \(array\[/);
  }
});

test("leaves the functions RLS and the public knowledge base depend on", () => {
  for (const name of mustStayCallable) {
    assert.ok(!listedNames(apiRolesSql).includes(name), `${name} must stay callable`);
    assert.ok(!listedNames(publicSql).includes(name), `${name} must stay callable`);
  }
});
