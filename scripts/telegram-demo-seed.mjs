#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import {
  BATTERY_KWH, charges, DEMO_CAR_ID, DEMO_EMAIL, DEMO_PASSWORD,
  DEMO_VEHICLE_ID, demoTime, round, trips,
} from "./fixtures/telegram-demo.mjs";

const status = JSON.parse(execFileSync("supabase", ["status", "--output", "json"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"],
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
if (!user) {
  user = assert(await supabase.auth.admin.createUser({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    email_confirm: true,
  }), "create local demo user").user;
}
const userId = user.id;
const activeDemoId = "99999999-9999-4999-8999-999999999999";
assert(await supabase.from("charging_sessions").delete()
  .eq("id", activeDemoId).eq("user_id", userId), "clear prior active demo scenario");

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

const providers = assert(await supabase.from("user_providers")
  .select("id,label").eq("user_id", userId), "read seeded providers");

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
    provider_type: "user_provider",
    user_provider_id: providers.find((provider) => provider.label ===
      (charge.provider === "home" ? "Home" : "Malanka")).id,
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
  for (let point = 0; point <= 12; point++) {
    const fraction = point / 12;
    const time = new Date(Date.parse(charge.started_at) + fraction *
      (Date.parse(charge.stopped_at) - Date.parse(charge.started_at))).toISOString();
    const soc = round(charge.start_percent + fraction * (charge.current_percent - charge.start_percent), 2);
    samples.push({
      id: `55555555-5555-4555-8555-${String(index * 100 + point + 1).padStart(12, "0")}`,
      user_id: userId,
      vehicle_id: DEMO_VEHICLE_ID,
      device_time: time,
      received_at: time,
      telemetry: { soc, speed_kmh: 0, charge_power_kw: charge.charger_power_kw,
        is_charging: true, battery_temp_c: round(24 + fraction * 5),
        outside_temp_c: 16, battery_voltage_v: round(330 + fraction * 12),
        cell_voltage_min_v: 3.28, cell_voltage_max_v: 3.295, cell_delta_v: 0.015,
        soh_percent: 98.5 },
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
  telemetry: { soc: 56, speed_kmh: 0, odometer_km: odometer, power_kw: 0,
    battery_temp_c: 25, outside_temp_c: 16, cabin_temp_c: 21,
    battery_voltage_v: 332, aux_voltage_v: 13.2, soh_percent: 98.5,
    cell_voltage_min_v: 3.28, cell_voltage_max_v: 3.295, cell_delta_v: 0.015,
    is_charging: false, charge_power_kw: 0 },
  diplus: { gear: "P", charge_gun_state: 1, voltage_12v: 13.2,
    min_cell_voltage_v: 3.28, max_cell_voltage_v: 3.295, cell_delta_v: 0.015,
    tire_press_fl_kpa: 240, tire_press_fr_kpa: 240,
    tire_press_rl_kpa: 235, tire_press_rr_kpa: 235 },
  location: {},
  raw_payload: {},
  diplus_soc: 56,
  diplus_speed_kmh: 0,
  diplus_mileage_km: odometer,
  diplus_power_kw: 0,
  diplus_min_cell_voltage_v: 3.28, diplus_max_cell_voltage_v: 3.295,
  diplus_cell_delta_v: 0.015, diplus_voltage_12v: 13.2,
}), "live snapshot");

console.log(`Seeded local demo: ${DEMO_EMAIL}, 1 car, ${chargeRows.length} charges, ${tripRows.length} trips, ${samples.length} samples.`);
console.log("All records are fictional and exist only in local Supabase.");

const serviceRows = [
  ["77777777-7777-4777-8777-777777777701", "Замена салонного фильтра", "cabin_filter", 18, 18057, 35, 15],
  ["77777777-7777-4777-8777-777777777702", "Сезонная смена шин", "tires", 9, 18277, 0, 80],
  ["77777777-7777-4777-8777-777777777703", "Проверка тормозной системы", "brakes", 2, 18448, 0, 45],
].map(([id, title, category, daysAgo, mileage, parts, labor]) => ({
  id, user_id: userId, car_id: DEMO_CAR_ID, title, category,
  service_type: "maintenance", performed_date: demoTime(daysAgo, 9).slice(0, 10),
  odometer_km: mileage, vendor_name: "Демо-сервис", parts_cost: parts,
  labor_cost: labor, total_cost: parts + labor, currency: "BYN",
  notes: "Вымышленная запись для демонстрации интерфейса.", next_due_km: mileage + 10000,
}));
assert(await supabase.from("vehicle_service_records").upsert(serviceRows), "service records");

const categoryId = "88888888-8888-4888-8888-888888888801";
assert(await supabase.from("knowledge_categories").upsert({
  id: categoryId, slug: "demo-charging", title: "Зарядка и расходы",
  description: "Демонстрационные материалы VoltFlow", sort_order: -10,
}), "knowledge category");
assert(await supabase.from("knowledge_articles").upsert({
  id: "88888888-8888-4888-8888-888888888802", slug: "demo-charge-cost",
  title: "Как читать стоимость зарядки в VoltFlow", category_id: categoryId,
  summary: "Демонстрационный пример: SOC, энергия из сети и ваш тариф.",
  content: [
    { heading: "От процента к энергии", body: "В этом вымышленном примере батарея имеет ёмкость 45,1 кВт·ч. Зарядка с 51% до 86% при КПД 98% соответствует примерно 16,107 кВт·ч из сети." },
    { heading: "Ваш тариф", body: "При демонстрационной цене 0,55 BYN за кВт·ч стоимость составляет 8,86 BYN. Фактическую стоимость можно уточнить по чеку провайдера." },
  ], tags: ["зарядка", "тариф", "демо"], status: "published",
  published_at: demoTime(10, 12), source_label: "Демонстрационные данные", sort_order: -10,
}), "knowledge article");
assert(await supabase.from("faq_items").upsert({
  id: "88888888-8888-4888-8888-888888888803", category_id: categoryId,
  question: "Можно ли пользоваться VoltFlow без подключения автомобиля?",
  answer: "Можно вручную вести зарядки и сервисные записи и читать базу знаний. Живой статус, автоматические поездки и зарядки требуют поступающей телеметрии. Этот экран использует вымышленные демоданные.",
  status: "published", tags: ["начало", "демо"], sort_order: -10,
}), "FAQ");
console.log("Seeded 3 service records, 1 article and 1 FAQ in local demo only.");

assert(await supabase.from("accessories").upsert({
  id: "88888888-8888-4888-8888-888888888804", title: "Органайзер багажника — демо",
  category_id: categoryId, use_case: "Хранение кабеля и небольших вещей",
  why_useful: "Пример карточки аксессуара, а не рекомендация к покупке.",
  what_to_check: ["Размеры багажника", "Способ крепления"], priority: "optional",
  status: "published", sort_order: -10,
}), "accessory");
assert(await supabase.from("spare_parts").upsert({
  id: "88888888-8888-4888-8888-888888888805", title: "Салонный фильтр — демо",
  description: "Вымышленная карточка для демонстрации каталога.",
  category_id: categoryId, compatibility: "Совместимость нужно уточнять по автомобилю",
  status: "published", sort_order: -10,
}), "spare part");
assert(await supabase.from("service_providers").upsert({
  id: "88888888-8888-4888-8888-888888888806", name: "Демо-сервис BYD",
  description: "Вымышленная организация. Не является реальным предложением услуг.",
  services: ["Осмотр", "Сезонная смена шин"], status: "published", sort_order: -10,
}), "service provider");
if (process.argv.includes("--charging")) {
  const startedAt = new Date(Date.now() - 23 * 60_000).toISOString();
  const now = new Date().toISOString();
  assert(await supabase.from("charging_sessions").upsert({
    ...chargeRows[0], id: activeDemoId, start_percent: 56, current_percent: 62,
    target_percent: 90, status: "charging", started_at: startedAt, stopped_at: null,
    created_at: startedAt, updated_at: now,
    charged_energy_kwh: round(6 * BATTERY_KWH / 100 / 0.98, 3),
    estimated_cost: round(6 * BATTERY_KWH / 100 / 0.98 * 0.34),
  }), "active charging scenario");
  assert(await supabase.from("bydmate_live_snapshots").update({
    device_time: now, received_at: now, updated_at: now, diplus_soc: 62,
    diplus_charging_status: "charging",
    telemetry: { soc: 62, speed_kmh: 0, charge_power_kw: 7, is_charging: true,
      odometer_km: odometer, battery_voltage_v: 332, charge_current_a: -21.08,
      battery_temp_c: 28, outside_temp_c: 16, soh_percent: 98.5 },
    diplus: { gear: "P", charge_gun_state: 0, charging_status: "charging" },
  }).eq("user_id", userId).eq("vehicle_id", DEMO_VEHICLE_ID), "charging snapshot");
}
console.log(JSON.stringify({ homeProviderId: providers.find((provider) => provider.label === "Home").id }));
