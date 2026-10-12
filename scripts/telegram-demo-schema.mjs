#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEMO_EMAIL } from "./fixtures/telegram-demo.mjs";
const root = resolve(import.meta.dirname, "..");
const container = "supabase_db_voltflow_telegram_demo";
const status = JSON.parse(execFileSync("supabase", ["status", "--output", "json"], {
  cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
}));
const api = new URL(status.API_URL), db = new URL(status.DB_URL);
if (api.hostname !== "127.0.0.1" || api.port !== "55321" ||
  db.hostname !== "127.0.0.1" || db.port !== "55322") throw new Error("Not the isolated demo stack");
const args = ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"];
const others = execFileSync("docker", [...args, "-Atc",
  `select count(*) from auth.users where email is distinct from '${DEMO_EMAIL}';`], { encoding: "utf8" }).trim();
if (others !== "0") throw new Error("Refusing schema refresh: this demo database contains other accounts");
// These existing schema changes are needed by current read paths. Never alter
// historical repo migrations or reset the saved local volumes.
for (const name of [
  "20260930120000_charging_session_recovery_origin.sql",
  "20261006120000_cars_range_reserve_soc.sql",
  "20261006180000_charge_end_range_snapshot.sql",
  "20261006210000_profile_analytics_card_order.sql",
]) {
  execFileSync("docker", args, { input: readFileSync(resolve(root, "supabase/migrations", name)),
    stdio: ["pipe", "ignore", "pipe"] });
  console.log(`Local demo schema: ${name}`);
}
execFileSync("docker", [...args, "-c", "notify pgrst, 'reload schema';"], { stdio: "ignore" });
