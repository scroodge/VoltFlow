import test from "node:test";
import assert from "node:assert/strict";

import { resolveChargingEtaPowerKw } from "./charging-math.ts";

test("fresh live power wins over the whole-session average during DC taper", () => {
  assert.equal(
    resolveChargingEtaPowerKw({
      freshLivePowerKw: 30,
      chargedGridEnergyKwh: 33.61,
      elapsedSeconds: 45 * 60,
      socGainPercent: 50,
      fallbackPowerKw: 44.8,
    }),
    30,
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
