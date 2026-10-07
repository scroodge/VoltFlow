#!/usr/bin/env node
// Read-only, authenticated Data API check: verifies the demo's actual RLS path.
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { DEMO_EMAIL, DEMO_PASSWORD, DEMO_CAR_ID, DEMO_VEHICLE_ID } from "./fixtures/telegram-demo.mjs";

const status = JSON.parse(execFileSync("supabase", ["status", "--output", "json"], {
  encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
}));
if (status.API_URL !== "http://127.0.0.1:55321" || new URL(status.DB_URL).port !== "55322")
  throw new Error("Expected the isolated loopback demo stack");
const client = createClient(status.API_URL, status.ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { data: auth, error } = await client.auth.signInWithPassword({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
if (error) throw error;
async function rows(table, columns, ownerColumn = "user_id") {
  const { data, error } = await client.from(table).select(columns).eq(ownerColumn, auth.user.id);
  if (error) throw new Error(`${table}: ${error.message}`);
  return data;
}
const [cars, profiles, sessions, trips, samples, live, hourly, soh] = await Promise.all([
  rows("cars", "id,vehicle_alias,battery_capacity_kwh"),
  rows("profiles", "vehicle_connected_at", "id"),
  rows("charging_sessions", "id,status,start_percent,current_percent,charged_energy_kwh,estimated_cost"),
  rows("bydmate_trips", "distance_km"),
  rows("bydmate_telemetry_samples", "id"),
  rows("bydmate_live_snapshots", "vehicle_id,telemetry"),
  rows("bydmate_telemetry_hourly", "sample_count"),
  rows("bydmate_soh_daily_rollups", "date"),
]);
const evidence = {
  cars: cars.length, connected: Boolean(profiles[0]?.vehicle_connected_at),
  completedCharges: sessions.filter((s) => s.status !== "charging").length,
  trips: trips.length, distanceKm: trips.reduce((sum, t) => sum + Number(t.distance_km), 0),
  samples: samples.length, snapshots: live.length,
  hourlyBuckets: hourly.length, aggregatedSamples: hourly.reduce((sum, h) => sum + h.sample_count, 0),
  sohDays: soh.length,
};
if (cars.length !== 1 || cars[0].id !== DEMO_CAR_ID || cars[0].vehicle_alias !== DEMO_VEHICLE_ID ||
    !evidence.connected || evidence.completedCharges !== 4 || evidence.trips !== 12 ||
    evidence.distanceKm !== 482 || evidence.samples !== 76 || live.length !== 1 ||
    evidence.aggregatedSamples !== 76 || !evidence.hourlyBuckets || evidence.sohDays < 4)
  throw new Error(`Fixture mismatch: ${JSON.stringify(evidence)}`);
console.log(JSON.stringify({ verified: true, ...evidence }));
