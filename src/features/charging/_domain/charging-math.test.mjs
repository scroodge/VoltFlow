import test from "node:test";
import assert from "node:assert/strict";

import {
  energyFromGridKwh,
  energyNeededKwh,
  gridSidePowerForEta,
  resolveChargingEtaPowerKw,
  secondsUntilTargetSoc,
} from "./charging-math.ts";

test("keeps battery gain distinct from grid energy", () => {
  const batteryGainKwh = energyNeededKwh(45.1, 0, 93);
  const gridEnergyKwh = energyFromGridKwh(batteryGainKwh, 92);

  assert.ok(Math.abs(batteryGainKwh - 41.943) < 1e-9);
  assert.ok(Math.abs(gridEnergyKwh - 45.59) < 1e-9);
  assert.ok(gridEnergyKwh > 45.1);
});

// ETA paths treat the resolved power as grid-side and multiply by efficiency. A measured pack
// V × I reading is battery-side, so it is divided by the efficiency first (car `way`, AC,
// 2026-10-01: 316 V × 17.9 A = 5.656 kW into the battery).
test("a measured battery-side power is converted so × efficiency lands back on it", () => {
  const ac = gridSidePowerForEta(5.656, 5.656, 98);
  assert.ok(Math.abs(ac - 5.656 / 0.98) < 1e-12);
  assert.ok(Math.abs(ac * 0.98 - 5.656) < 1e-12);

  // DC: the efficiency gap is wider (≈ 90 %), so is the correction.
  const dc = gridSidePowerForEta(65.902, 65.902, 90);
  assert.ok(Math.abs(dc * 0.9 - 65.902) < 1e-12);
});

test("values that were never battery-side are left alone", () => {
  // A session average or the fallback differs from the measured reading: untouched.
  assert.equal(gridSidePowerForEta(5.8, 5.656, 98), 5.8);
  // No measurement at all (di+ 1.x integer reading, stale snapshot): untouched.
  assert.equal(gridSidePowerForEta(5, null, 98), 5);
  assert.equal(gridSidePowerForEta(5, undefined, 98), 5);
  // Nothing resolved: still nothing.
  assert.equal(gridSidePowerForEta(null, 5.656, 98), null);
  assert.equal(gridSidePowerForEta(0, 0, 98), null);
});

test("an unusable efficiency never invents a correction", () => {
  for (const eff of [0, -5, 101, Number.NaN, null, undefined]) {
    assert.equal(gridSidePowerForEta(5.656, 5.656, eff), 5.656);
  }
  // 100 % efficiency is a valid (lossless) case: nothing to convert.
  assert.equal(gridSidePowerForEta(5.656, 5.656, 100), 5.656);
});

test("ETA on real numbers: measured power no longer counts the efficiency twice", () => {
  const capacityKwh = 45.77;
  const efficiency = 98;
  const measuredBatteryKw = 5.656;
  const base = {
    startPercent: 78,
    targetPercent: 100,
    batteryCapacityKwh: capacityKwh,
    efficiencyPercent: efficiency,
    pricePerKwh: 0.2,
  };
  const truth = ((capacityKwh * 22) / 100 / measuredBatteryKw) * 3600; // seconds, 78 → 100 %

  // Before: the measured battery-side value was multiplied by the efficiency again.
  const before = secondsUntilTargetSoc(
    { ...base, chargerPowerKw: measuredBatteryKw * (efficiency / 100) },
    78,
  );
  // After: converted to grid-side first, so the same × efficiency lands on the measurement.
  const gridKw = gridSidePowerForEta(measuredBatteryKw, measuredBatteryKw, efficiency);
  const after = secondsUntilTargetSoc(
    { ...base, chargerPowerKw: gridKw * (efficiency / 100) },
    78,
  );

  assert.ok(Math.abs(after - truth) < 1e-6);
  assert.ok(Math.abs(before / truth - 1 / 0.98) < 1e-9); // the old ETA was ≈ 2 % long
});

test("fresh live power wins over the whole-session average during DC taper", () => {
  assert.equal(
    resolveChargingEtaPowerKw({
      freshLivePowerKw: 30,
      chargedGridEnergyKwh: 33.61,
      elapsedSeconds: 45 * 60,
      socGainPercent: 50,
      fallbackPowerKw: 44.8,
      isDc: true,
    }),
    30,
  );
});

test("mature AC session refines a truncated live integer within the same bucket", () => {
  assert.equal(
    resolveChargingEtaPowerKw({
      freshLivePowerKw: 1,
      chargedGridEnergyKwh: 0.7,
      elapsedSeconds: 30 * 60,
      socGainPercent: 2,
      fallbackPowerKw: 1,
    }),
    1.4,
  );
});

test("AC refinement keeps live power when the observed average disagrees on the bucket", () => {
  assert.equal(
    resolveChargingEtaPowerKw({
      freshLivePowerKw: 1,
      chargedGridEnergyKwh: 1.15,
      elapsedSeconds: 30 * 60,
      socGainPercent: 4,
      fallbackPowerKw: 1,
    }),
    1,
  );
});

test("already-decimal AC live power is not replaced by the session average", () => {
  assert.equal(
    resolveChargingEtaPowerKw({
      freshLivePowerKw: 1.4,
      chargedGridEnergyKwh: 0.8,
      elapsedSeconds: 30 * 60,
      socGainPercent: 3,
      fallbackPowerKw: 1,
    }),
    1.4,
  );
});

test("observed session average replaces configured power when fresh live power is absent", () => {
  const power = resolveChargingEtaPowerKw({
    freshLivePowerKw: null,
    chargedGridEnergyKwh: 18.52,
    elapsedSeconds: 3 * 3600,
    socGainPercent: 30,
    fallbackPowerKw: 7,
  });
  assert.ok(power != null && Math.abs(power - 18.52 / 3) < 1e-9);
});

test("early or insufficient SOC progress retains the configured fallback", () => {
  assert.equal(
    resolveChargingEtaPowerKw({
      freshLivePowerKw: null,
      chargedGridEnergyKwh: 0.6,
      elapsedSeconds: 10 * 60,
      socGainPercent: 2,
      fallbackPowerKw: 7,
    }),
    7,
  );
  assert.equal(
    resolveChargingEtaPowerKw({
      freshLivePowerKw: null,
      chargedGridEnergyKwh: 1.2,
      elapsedSeconds: 20 * 60,
      socGainPercent: 1,
      fallbackPowerKw: 7,
    }),
    7,
  );
});

test("early AC session retains the live integer instead of inventing a decimal", () => {
  assert.equal(
    resolveChargingEtaPowerKw({
      freshLivePowerKw: 1,
      chargedGridEnergyKwh: 0.2,
      elapsedSeconds: 10 * 60,
      socGainPercent: 1,
      fallbackPowerKw: 1,
    }),
    1,
  );
});

test("fresh live power wins after a pause instead of using the depressed session average", () => {
  assert.equal(
    resolveChargingEtaPowerKw({
      freshLivePowerKw: 6.8,
      chargedGridEnergyKwh: 7,
      elapsedSeconds: 3 * 3600,
      socGainPercent: 12,
      fallbackPowerKw: 7,
    }),
    6.8,
  );
});

test("invalid observed and fallback power returns no ETA power", () => {
  assert.equal(
    resolveChargingEtaPowerKw({
      freshLivePowerKw: null,
      chargedGridEnergyKwh: Number.NaN,
      elapsedSeconds: 3600,
      socGainPercent: 10,
      fallbackPowerKw: 0,
    }),
    null,
  );
});
