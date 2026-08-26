import assert from "node:assert/strict";
import test from "node:test";

import {
  AUX_BATTERY_REFERENCES,
  deriveAuxBatteryChemistry,
  resolveAuxBatteryChemistry,
} from "./vehicle/aux-battery-chemistry.ts";

test("derives the stock chemistry from model generation", () => {
  assert.equal(deriveAuxBatteryChemistry("gen1_2024"), "flooded");
  assert.equal(deriveAuxBatteryChemistry("gen2_2025"), "lifepo4");
});

test("an explicit chemistry overrides the generation default", () => {
  assert.equal(resolveAuxBatteryChemistry("agm", "gen2_2025"), "agm");
  assert.equal(resolveAuxBatteryChemistry(null, "gen2_2025"), "lifepo4");
  assert.equal(resolveAuxBatteryChemistry(null, null), "other");
});

test("other keeps the legacy low reference and has no absolute resting band", () => {
  assert.deepEqual(AUX_BATTERY_REFERENCES.other, {
    restingBand: null,
    lowVoltage: 11.8,
  });
});
