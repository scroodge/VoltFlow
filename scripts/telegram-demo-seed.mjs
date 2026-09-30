#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import {
  BATTERY_KWH, charges, DEMO_CAR_ID, DEMO_EMAIL, DEMO_PASSWORD,
  DEMO_VEHICLE_ID, demoTime, round, trips,
} from "./fixtures/telegram-demo.mjs";

const status = JSON.parse(execFileSync("supabase", ["status", "--output", "json"], {
  encoding: "utf8",
}));
const apiUrl = new URL(status.API_URL);
const dbUrl = new URL(status.DB_URL);
if (
  apiUrl.hostname !== "127.0.0.1" || apiUrl.port !== "55321" ||
  dbUrl.hostname !== "127.0.0.1" || dbUrl.port !== "55322" ||
  !status.SERVICE_ROLE_KEY
) {
  throw new Error("Refusing to seed: expected local demo Supabase on ports 55321/55322");
}

const supabase = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function assert(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

const users = assert(await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }), "list users");
let user = users.users.find((candidate) => candidate.email === DEMO_EMAIL);
if (user) {
  assert(await supabase.auth.admin.updateUserById(user.id, { password: DEMO_PASSWORD }), "update local demo password");
} else {
  user = assert(await supabase.auth.admin.createUser({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    email_confirm: true,
  }), "create local demo user").user;
}
const userId = user.id;

assert(await supabase.from("profiles").update({
  preferred_locale: "ru",
  preferred_currency: "BYN",
  timezone: "Europe/Minsk",
  home_price_per_kwh: 0.34,
  commercial_ac_price_per_kwh: 0.55,
  fast_dc_price_per_kwh: 0.78,
  default_price_per_kwh: 0.34,
  vehicle_connected_at: demoTime(20, 8),
}).eq("id", userId), "profile");

// The UI prices a new charge from user-owned provider rows, not just profile
// defaults. Keep those rows in step with the fictional completed sessions.
const providerPrices = [
  ["Home", 0.34, 0.55, 0.78, true],
  ["Malanka", 0.55, 0.55, 0.78, false],
  ["Evika!", 0.54, 0.54, 0.72, false],
  ["forEVo", 0.46, 0.46, 0.61, false],
  ["Zaryadka", 0.48, 0.48, 0.61, false],
  ["BatteryFly", 0.50, 0.50, 0.45, false],
];
const existingProviders = assert(await supabase.from("user_providers")
  .select("id,label").eq("user_id", userId), "read local demo providers");
for (const [label, home, ac, dc, isDefault] of providerPrices) {
  const row = {
    user_id: userId,
    label,
    home_price_per_kwh: home,
    commercial_ac_price_per_kwh: ac,
    fast_dc_price_per_kwh: dc,
    is_default: isDefault,
  };
  const existing = existingProviders.find((provider) => provider.label === label);
  if (existing) {
    assert(await supabase.from("user_providers").update(row).eq("id", existing.id), `provider ${label}`);
  } else {
    assert(await supabase.from("user_providers").insert(row), `provider ${label}`);
  }
}

assert(await supabase.from("cars").upsert({
  id: DEMO_CAR_ID,
  user_id: userId,
  name: "BYD Yuan Up",
  model_generation: "gen1_2024",
  battery_chemistry: null,
  battery_capacity_kwh: BATTERY_KWH,
  default_charger_power_kw: 7,
  default_efficiency_percent: 98,
  fast_dc_efficiency_percent: 90,
  vehicle_alias: DEMO_VEHICLE_ID,
}), "car");

const chargeRows = charges.map((charge) => {
  const batteryEnergy = (charge.to - charge.from) * BATTERY_KWH / 100;
  const gridEnergy = round(batteryEnergy / (charge.efficiency / 100), 3);
  const startedAt = demoTime(charge.daysAgo, charge.hour, charge.minute);
  const stoppedAt = new Date(Date.parse(startedAt) + charge.durationMin * 60_000).toISOString();
  return {
    id: charge.id,
    user_id: userId,
    car_id: DEMO_CAR_ID,
    start_percent: charge.from,
    current_percent: charge.to,
    target_percent: charge.to,
    battery_capacity_kwh: BATTERY_KWH,
    charger_power_kw: charge.power,
    efficiency_percent: charge.efficiency,
    tariff_type: charge.tariff,
    provider_type: charge.provider,
    price_per_kwh: charge.price,
    charged_energy_kwh: gridEnergy,
    estimated_cost: round(gridEnergy * charge.price),
    status: "completed",
    started_at: startedAt,
    stopped_at: stoppedAt,
    created_at: startedAt,
    updated_at: stoppedAt,
    tariff_manual: true,
    manual_entry: false,
  };
});
assert(await supabase.from("charging_sessions").upsert(chargeRows), "charging sessions");

let odometer = 18_000;
const tripRows = trips.map((trip, index) => {
  const startedAt = demoTime(trip.daysAgo, trip.hour);
  const endedAt = new Date(Date.parse(startedAt) + trip.durationMin * 60_000).toISOString();
  const startOdometer = odometer;
  odometer += trip.distance;
  const batteryEnergy = round((trip.from - trip.to) * BATTERY_KWH / 100, 3);
  return {
    id: `33333333-3333-4333-8333-${String(index + 1).padStart(12, "0")}`,
    user_id: userId,
    vehicle_id: DEMO_VEHICLE_ID,
    started_at: startedAt,
    ended_at: endedAt,
    last_device_time: endedAt,
    sample_count: 2,
    track_point_count: 0,
    distance_km: trip.distance,
    soc_start: trip.from,
    soc_end: trip.to,
    max_speed_kmh: 78,
    avg_speed_kmh: round(trip.distance / trip.durationMin * 60, 1),
    avg_consumption_kwh_100km: round(batteryEnergy / trip.distance * 100, 1),
    traction_energy_kwh: batteryEnergy,
    regen_energy_kwh: 0,
    fuel_kwh: batteryEnergy,
    trip_meter_baseline_km: startOdometer,
    source: "telemetry",
  };
});
assert(await supabase.from("bydmate_trips").upsert(tripRows), "trips");

const samples = [];
for (const trip of tripRows) {
  for (const [suffix, time, soc, mileage] of [
    ["1", trip.started_at, trip.soc_start, trip.trip_meter_baseline_km],
    ["2", trip.ended_at, trip.soc_end, trip.trip_meter_baseline_km + trip.distance_km],
  ]) {
    samples.push({
      id: `44444444-4444-4444-8444-${trip.id.slice(-11)}${suffix}`,
      user_id: userId,
      vehicle_id: DEMO_VEHICLE_ID,
      device_time: time,
      received_at: time,
      telemetry: { soc, speed_kmh: suffix === "1" ? 0 : 35, odometer_km: mileage, power_kw: 6 },
      diplus_soc: soc,
      diplus_speed_kmh: suffix === "1" ? 0 : 35,
      diplus_mileage_km: mileage,
      diplus_power_kw: 6,
    });
  }
}
for (const [index, charge] of chargeRows.entries()) {
  for (const [suffix, time, soc] of [
    ["1", charge.started_at, charge.start_percent],
    ["2", charge.stopped_at, charge.current_percent],
  ]) {
    samples.push({
      id: `55555555-5555-4555-8555-${String(index + 1).padStart(11, "0")}${suffix}`,
      user_id: userId,
      vehicle_id: DEMO_VEHICLE_ID,
      device_time: time,
      received_at: time,
      telemetry: { soc, speed_kmh: 0, charge_power_kw: charge.charger_power_kw, is_charging: true },
      diplus_soc: soc,
      diplus_speed_kmh: 0,
      diplus_power_kw: charge.charger_power_kw,
      diplus_charging_status: "charging",
    });
  }
}
// Relative dates move on a later rerun; replace only this fictional vehicle's
// sample set so the unique (user, vehicle, device_time) constraint stays valid.
assert(await supabase.from("bydmate_telemetry_samples").delete()
  .eq("user_id", userId).eq("vehicle_id", DEMO_VEHICLE_ID), "clear local demo samples");
assert(await supabase.from("bydmate_telemetry_samples").insert(samples), "telemetry samples");

const snapshotTime = new Date().toISOString();
assert(await supabase.from("bydmate_live_snapshots").upsert({
  id: "66666666-6666-4666-8666-666666666666",
  user_id: userId,
  vehicle_id: DEMO_VEHICLE_ID,
  source: "BYDMate",
  schema_version: 1,
  device_time: snapshotTime,
  received_at: snapshotTime,
  updated_at: snapshotTime,
  telemetry: { soc: 56, speed_kmh: 0, odometer_km: odometer, power_kw: 0 },
  diplus: {},
  location: {},
  raw_payload: {},
  diplus_soc: 56,
  diplus_speed_kmh: 0,
  diplus_mileage_km: odometer,
  diplus_power_kw: 0,
}), "live snapshot");

console.log(`Seeded local demo: ${DEMO_EMAIL}, 1 car, ${chargeRows.length} charges, ${tripRows.length} trips, ${samples.length} samples.`);
console.log("All records are fictional and exist only in local Supabase.");
