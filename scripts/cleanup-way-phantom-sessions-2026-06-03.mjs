#!/usr/bin/env node
/**
 * Remove phantom auto-start charging_sessions for vehicle "way" on 2026-06-03.
 * Run AFTER deploying the isMateAutoSessionCharging fix.
 *
 *   node --env-file=.env.local scripts/cleanup-way-phantom-sessions-2026-06-03.mjs --dry-run
 *   node --env-file=.env.local scripts/cleanup-way-phantom-sessions-2026-06-03.mjs --yes
 */
import { createClient } from "@supabase/supabase-js";

const KEEP_SESSION_IDS = new Set([
  "83704b09-7ec7-4ef3-90e2-ef363dd7800c", // morning session (completed, reconciled)
  "2d6aae00-884a-453f-ba06-d1ed9751642f", // real afternoon charging (adjust if your active id differs)
]);

const DAY_START = "2026-06-03T00:00:00Z";
const VEHICLE_ALIAS = "way";

const dryRun = process.argv.includes("--dry-run");
const confirmed = process.argv.includes("--yes");

if (!dryRun && !confirmed) {
  console.error("Pass --dry-run to preview or --yes to delete.");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key);

const { data: cars, error: carErr } = await supabase
  .from("cars")
  .select("id,user_id")
  .eq("vehicle_alias", VEHICLE_ALIAS);

if (carErr || !cars?.[0]) {
  console.error("Car not found:", carErr?.message);
  process.exit(1);
}

const carId = cars[0].id;
const userId = cars[0].user_id;

const { data: sessions, error: sessErr } = await supabase
  .from("charging_sessions")
  .select("id,status,started_at,charged_energy_kwh")
  .eq("car_id", carId)
  .gte("started_at", DAY_START)
  .order("started_at", { ascending: true });

if (sessErr) {
  console.error(sessErr.message);
  process.exit(1);
}

const toDelete = (sessions ?? []).filter((row) => !KEEP_SESSION_IDS.has(row.id));
const toKeep = (sessions ?? []).filter((row) => KEEP_SESSION_IDS.has(row.id));

console.log(`way ${DAY_START}: total=${sessions?.length ?? 0} keep=${toKeep.length} delete=${toDelete.length}`);
for (const row of toKeep) {
  console.log("  keep", row.id, row.status, row.started_at, row.charged_energy_kwh, "kWh");
}
if (toDelete.length <= 20) {
  for (const row of toDelete) {
    console.log("  del ", row.id, row.status, row.started_at);
  }
} else {
  console.log(`  (${toDelete.length} phantom rows, first 5)`);
  toDelete.slice(0, 5).forEach((row) => console.log("  del ", row.id, row.started_at));
}

if (dryRun) {
  console.log("\nDry run — no changes.");
  process.exit(0);
}

const ids = toDelete.map((row) => row.id);
for (let i = 0; i < ids.length; i += 50) {
  const chunk = ids.slice(i, i + 50);
  const { error } = await supabase.from("charging_sessions").delete().in("id", chunk);
  if (error) {
    console.error("Delete failed:", error.message);
    process.exit(1);
  }
}

await supabase
  .from("bydmate_auto_charging_session_state")
  .update({
    consecutive_charging_samples: 0,
    consecutive_unplug_samples: 0,
    last_is_charging: false,
  })
  .eq("user_id", userId)
  .eq("vehicle_id", VEHICLE_ALIAS);

console.log("\nDeleted", ids.length, "sessions and reset auto_charging_session_state for way.");
