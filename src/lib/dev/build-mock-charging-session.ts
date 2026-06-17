import type { ChargingSessionRow } from "@/types/database";

/** Fixed id for dev-only charge UI preview (no DB row). */
export const DEV_MOCK_CHARGING_SESSION_ID = "dev-preview";

export function isDevMockChargingSessionId(sessionId: string) {
  return sessionId === DEV_MOCK_CHARGING_SESSION_ID;
}

/** Synthetic active session for /dev/charging visual QA. */
export function buildMockChargingSession(nowMs = Date.now()): ChargingSessionRow {
  const startedAt = new Date(nowMs - 12 * 60 * 1000).toISOString();
  const createdAt = startedAt;

  return {
    id: DEV_MOCK_CHARGING_SESSION_ID,
    user_id: "dev-preview-user",
    car_id: "dev-preview-car",
    start_percent: 35,
    current_percent: 35,
    target_percent: 90,
    battery_capacity_kwh: 71.8,
    charger_power_kw: 7.4,
    efficiency_percent: 90,
    tariff_type: "commercial_ac",
    provider_type: "home",
    price_per_kwh: 0.15,
    charged_energy_kwh: 0,
    estimated_cost: 0,
    status: "charging",
    started_at: startedAt,
    stopped_at: null,
    created_at: createdAt,
    updated_at: createdAt,
  };
}
