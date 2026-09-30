// Fictional, user-owned records for the local Telegram screenshot account.
// Energy in charging_sessions is grid-side: SOC delta * 45.1 / efficiency.
export const DEMO_EMAIL = "demo@voltflow.test";
export const DEMO_PASSWORD = "VoltFlowLocalDemo2026!";
export const DEMO_CAR_ID = "11111111-1111-4111-8111-111111111111";
export const DEMO_VEHICLE_ID = "demo-yuan-up-2024";
export const BATTERY_KWH = 45.1;

export const charges = [
  { id: "22222222-2222-4222-8222-222222222201", daysAgo: 19, hour: 18, minute: 0, durationMin: 130, from: 60, to: 90, tariff: "home", provider: "home", price: 0.34, efficiency: 98, power: 7 },
  { id: "22222222-2222-4222-8222-222222222202", daysAgo: 13, hour: 19, minute: 0, durationMin: 145, from: 53, to: 88, tariff: "home", provider: "home", price: 0.34, efficiency: 98, power: 7 },
  { id: "22222222-2222-4222-8222-222222222203", daysAgo: 10, hour: 16, minute: 0, durationMin: 36, from: 57, to: 85, tariff: "fast_dc", provider: "malanka", price: 0.78, efficiency: 90, power: 50 },
  { id: "22222222-2222-4222-8222-222222222204", daysAgo: 4, hour: 18, minute: 30, durationMin: 140, from: 51, to: 86, tariff: "commercial_ac", provider: "malanka", price: 0.55, efficiency: 98, power: 7 },
];

export const trips = [
  { daysAgo: 20, hour: 9, durationMin: 38, distance: 22, from: 78, to: 71 },
  { daysAgo: 19, hour: 9, durationMin: 54, distance: 35, from: 71, to: 60 },
  { daysAgo: 17, hour: 10, durationMin: 68, distance: 48, from: 90, to: 75 },
  { daysAgo: 15, hour: 9, durationMin: 43, distance: 29, from: 75, to: 66 },
  { daysAgo: 13, hour: 8, durationMin: 61, distance: 42, from: 66, to: 53 },
  { daysAgo: 11, hour: 10, durationMin: 84, distance: 66, from: 88, to: 68 },
  { daysAgo: 10, hour: 9, durationMin: 52, distance: 35, from: 68, to: 57 },
  { daysAgo: 8, hour: 9, durationMin: 74, distance: 51, from: 85, to: 69 },
  { daysAgo: 6, hour: 8, durationMin: 57, distance: 38, from: 69, to: 57 },
  { daysAgo: 4, hour: 9, durationMin: 34, distance: 20, from: 57, to: 51 },
  { daysAgo: 3, hour: 10, durationMin: 88, distance: 62, from: 86, to: 67 },
  { daysAgo: 1, hour: 9, durationMin: 50, distance: 34, from: 67, to: 56 },
];

export function demoTime(daysAgo, hour, minute = 0) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  date.setUTCHours(hour, minute, 0, 0);
  return date.toISOString();
}

export function round(value, digits = 2) {
  return Number(value.toFixed(digits));
}
