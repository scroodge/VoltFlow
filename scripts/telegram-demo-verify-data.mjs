#!/usr/bin/env node
// Read-only, authenticated Data API check: verifies the demo's actual RLS path.
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { DEMO_EMAIL, DEMO_PASSWORD, DEMO_CAR_ID, DEMO_VEHICLE_ID, charges } from "./fixtures/telegram-demo.mjs";

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
let jwtTimingRetries = 0;
async function rows(table, columns, ownerColumn = "user_id") {
  const query = () => client.from(table).select(columns).eq(ownerColumn, auth.user.id);
  let { data, error } = await query();
  // Local Auth/PostgREST can straddle the freshly issued JWT's second boundary.
  // Retry this exact timing error once; retain the evidence and fail all others.
  if (error?.message === "JWT issued at future") {
    jwtTimingRetries++;
    await new Promise((resolve) => setTimeout(resolve, 2000));
    ({ data, error } = await query());
  }
  if (error) throw new Error(`${table}: ${error.message}`);
  return data;
}
const [cars, profiles, sessions, trips, samples, live, hourly, soh, service] = await Promise.all([
  rows("cars", "id,vehicle_alias,battery_capacity_kwh"),
  rows("profiles", "vehicle_connected_at", "id"),
  rows("charging_sessions", "id,status,start_percent,current_percent,charged_energy_kwh,estimated_cost"),
  rows("bydmate_trips", "distance_km"),
  rows("bydmate_telemetry_samples", "id"),
  rows("bydmate_live_snapshots", "vehicle_id,telemetry"),
  rows("bydmate_telemetry_hourly", "sample_count"),
  rows("bydmate_soh_daily_rollups", "date"),
  rows("vehicle_service_records", "total_cost"),
]);
const evidence = {
  cars: cars.length, connected: Boolean(profiles[0]?.vehicle_connected_at),
  completedCharges: sessions.filter((s) => s.status === "completed").length,
  trips: trips.length, distanceKm: trips.reduce((sum, t) => sum + Number(t.distance_km), 0),
  samples: samples.length, snapshots: live.length,
  hourlyBuckets: hourly.length, aggregatedSamples: hourly.reduce((sum, h) => sum + h.sample_count, 0),
  sohDays: soh.length,
  serviceRecords: service.length, serviceCost: service.reduce((sum, s) => sum + Number(s.total_cost), 0),
  jwtTimingRetries,
};
const receipt = sessions.find((session) => session.id === charges.at(-1).id);
evidence.batteryKwh = Number(cars[0]?.battery_capacity_kwh);
evidence.receipt = receipt ? { from: Number(receipt.start_percent), to: Number(receipt.current_percent),
  gridKwh: Number(receipt.charged_energy_kwh), costBYN: Number(receipt.estimated_cost) } : null;
if (cars.length !== 1 || cars[0].id !== DEMO_CAR_ID || cars[0].vehicle_alias !== DEMO_VEHICLE_ID ||
    !evidence.connected || evidence.completedCharges !== 4 || evidence.trips !== 12 ||
    evidence.distanceKm !== 482 || evidence.samples !== 76 || live.length !== 1 ||
    evidence.aggregatedSamples !== 76 || !evidence.hourlyBuckets || evidence.sohDays < 4 ||
    evidence.serviceRecords !== 3 || evidence.serviceCost !== 175 || evidence.batteryKwh !== 45.1 ||
    evidence.receipt?.from !== 51 || evidence.receipt?.to !== 86 ||
    Math.abs((evidence.receipt?.gridKwh ?? 0) - 16.107) > 0.000001 || evidence.receipt?.costBYN !== 8.86)
  throw new Error(`Fixture mismatch: ${JSON.stringify(evidence)}`);
console.log(JSON.stringify({ verified: true, ...evidence }));
