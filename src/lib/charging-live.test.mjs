import test from "node:test";
import assert from "node:assert/strict";

import {
  CHARGING_PERSIST_SLACK_MS,
  chargingPersistIntervalMs,
  deriveChargePowerFromEnergyDeltaKw,
  deriveLiveChargingState,
  snapshotKwhCharged,
} from "./charging-live.ts";

const NOW = 1_900_000_000_000;
const CHARGING_PARAMS = {
  startPercent: 30,
  targetPercent: 100,
  batteryCapacityKwh: 72.9,
  chargerPowerKw: 7,
  efficiencyPercent: 100, // keeps grid == battery so the energy source is easy to assert
  pricePerKwh: 0.2,
};

function chargingSnapshot({ soc = 49, kwhCharged } = {}) {
  const telemetry = { soc, speed_kmh: 0, charge_power_kw: 4 };
  if (kwhCharged !== undefined) telemetry.kwh_charged = kwhCharged;
  return { received_at: new Date(NOW).toISOString(), telemetry };
}

test("deriveLiveChargingState uses SOC estimate even when kwh_charged is present", () => {
  const state = deriveLiveChargingState({
    snapshot: chargingSnapshot({ soc: 49, kwhCharged: 2.559 }),
    params: CHARGING_PARAMS,
    startedAtMs: NOW - 60_000,
    nowMs: NOW,
  });
  assert.ok(state);
  assert.equal(state.chargedEnergySource, "estimate");
  // 72.9 * (49 - 30)/100 = 13.851 — BMS counter is cell-only, not used for grid energy/cost.
  assert.ok(Math.abs(state.chargedEnergyKwh - 13.851) < 1e-9);
  assert.ok(Math.abs(state.estimatedCost - 13.851 * 0.2) < 1e-9);
});

test("deriveLiveChargingState falls back to the SOC estimate when kwh_charged is absent", () => {
  const state = deriveLiveChargingState({
    snapshot: chargingSnapshot({ soc: 49 }), // no kwh_charged
    params: CHARGING_PARAMS,
    startedAtMs: NOW - 60_000,
    nowMs: NOW,
  });
  assert.ok(state);
  assert.equal(state.chargedEnergySource, "estimate");
  // 72.9 * (49 - 30)/100 = 13.851
  assert.ok(Math.abs(state.chargedEnergyKwh - 13.851) < 1e-9);
});

test("snapshotKwhCharged ignores missing / non-positive values", () => {
  assert.equal(snapshotKwhCharged(chargingSnapshot({ kwhCharged: 2.5 })), 2.5);
  assert.equal(snapshotKwhCharged(chargingSnapshot({ kwhCharged: 0 })), null);
  assert.equal(snapshotKwhCharged(chargingSnapshot({})), null);
  assert.equal(snapshotKwhCharged(null), null);
});

test("deriveChargePowerFromEnergyDeltaKw differentiates the energy counter to float kW", () => {
  // +0.1 kWh over 60 s → 6 kW.
  assert.ok(
    Math.abs(deriveChargePowerFromEnergyDeltaKw(2.5, NOW, 2.6, NOW + 60_000) - 6) < 1e-9,
  );
  // Window too short → null (counter quantization guard).
  assert.equal(deriveChargePowerFromEnergyDeltaKw(2.5, NOW, 2.6, NOW + 5_000), null);
  // Counter reset to a smaller value (new session) → null, not negative power.
  assert.equal(deriveChargePowerFromEnergyDeltaKw(2.6, NOW, 0.0, NOW + 60_000), null);
  // Missing inputs → null.
  assert.equal(deriveChargePowerFromEnergyDeltaKw(null, NOW, 2.6, NOW + 60_000), null);
});

test("persist interval tiers by SOC like the read cadence", () => {
  // Long flat phase — coarse persists.
  assert.equal(chargingPersistIntervalMs(0), 30_000);
  assert.equal(chargingPersistIntervalMs(50), 30_000);
  assert.equal(chargingPersistIntervalMs(94.9), 30_000);

  // Approaching the tail.
  assert.equal(chargingPersistIntervalMs(95), 5_000);
  assert.equal(chargingPersistIntervalMs(97.9), 5_000);

  // Balance tail — fine resolution to catch exact completion.
  assert.equal(chargingPersistIntervalMs(98), 1_000);
  assert.equal(chargingPersistIntervalMs(100), 1_000);
});

test("non-finite percent falls back to the coarsest tier", () => {
  assert.equal(chargingPersistIntervalMs(null), 30_000);
  assert.equal(chargingPersistIntervalMs(undefined), 30_000);
  assert.equal(chargingPersistIntervalMs(Number.NaN), 30_000);
});

test("slack keeps a 1Hz tick clearing the ≥98% tier", () => {
  // The tick fires every ~1000ms; the effective threshold must be < 1000ms so a
  // tick landing a few ms early still persists at the balance tail.
  assert.ok(chargingPersistIntervalMs(99) - CHARGING_PERSIST_SLACK_MS < 1_000);
  assert.ok(CHARGING_PERSIST_SLACK_MS > 0);
});
