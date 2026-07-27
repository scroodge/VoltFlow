import test from "node:test";
import assert from "node:assert/strict";

import {
  CHARGING_PERSIST_SLACK_MS,
  chargingPersistIntervalMs,
  deriveChargePowerFromEnergyDeltaKw,
  deriveLiveChargingState,
  latestSnapshotSocReading,
  snapshotKwhCharged,
} from "./charging-live.ts";
import { clampDerivedToSocCeiling, deriveChargingState } from "./charging-math.ts";

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

const CLAMP_PARAMS = {
  startPercent: 32,
  targetPercent: 100,
  batteryCapacityKwh: 45.1,
  chargerPowerKw: 4.4,
  efficiencyPercent: 100,
  pricePerKwh: 0.3265,
};

test("latestSnapshotSocReading picks the newest snapshot carrying a SOC", () => {
  const reading = latestSnapshotSocReading([
    { received_at: new Date(NOW - 120_000).toISOString(), telemetry: { soc: 60 } },
    { received_at: new Date(NOW - 60_000).toISOString(), telemetry: { soc: 64 } },
    { received_at: new Date(NOW - 30_000).toISOString(), telemetry: { speed_kmh: 0 } },
  ]);
  assert.equal(reading.soc, 64);
  assert.equal(reading.receivedMs, NOW - 60_000);
});

test("latestSnapshotSocReading is null when no snapshot has SOC", () => {
  assert.equal(latestSnapshotSocReading([{ received_at: new Date(NOW).toISOString(), telemetry: {} }]), null);
});

test("clampDerivedToSocCeiling caps runaway math at the last real SOC + bridge", () => {
  // Session left open ~8h after charging ended; math projects all the way to target, but
  // the last real SOC was 64% only 30s ago. The ceiling is 64 + tiny bridge, so the
  // persisted value stays ~64 instead of the runaway value.
  const math = deriveChargingState(CLAMP_PARAMS, NOW - 8 * 3600_000, NOW);
  assert.ok(math.currentPercent > 70); // unclamped runaway (hits target)
  const clamped = clampDerivedToSocCeiling(math, CLAMP_PARAMS, 64, 30);
  assert.ok(clamped.currentPercent < 65, `expected ~64, got ${clamped.currentPercent}`);
  assert.ok(clamped.currentPercent >= 64);
  // energy rebuilt from the clamped SOC (~64% + tiny bridge): ≈(64-32)% * 45.1 = 14.43 kWh
  assert.ok(Math.abs(clamped.chargedEnergyKwh - 14.45) < 0.05);
  assert.equal(clamped.isComplete, false);
});

test("clampDerivedToSocCeiling leaves a non-overshooting state untouched", () => {
  const math = deriveChargingState(CLAMP_PARAMS, NOW - 5 * 60_000, NOW);
  const clamped = clampDerivedToSocCeiling(math, CLAMP_PARAMS, 90, 30);
  assert.deepEqual(clamped, math);
});

test("clampDerivedToSocCeiling is a no-op without a SOC anchor", () => {
  const math = deriveChargingState(CLAMP_PARAMS, NOW - 200 * 60_000, NOW);
  assert.deepEqual(clampDerivedToSocCeiling(math, CLAMP_PARAMS, null, 0), math);
});

test("clampDerivedToSocCeiling allows completion when bridge reaches target (offline)", () => {
  // Last SOC 96% seen 1 hour ago, car offline since: bridge at 4.4kW/45.1kWh ~9.75%/h
  // lifts the ceiling past 100, so a genuinely-finished offline session can complete.
  const math = deriveChargingState(CLAMP_PARAMS, NOW - 8 * 3600_000, NOW);
  const clamped = clampDerivedToSocCeiling(math, CLAMP_PARAMS, 96, 3600);
  assert.equal(clamped.currentPercent, 100);
  assert.equal(clamped.isComplete, true);
});
