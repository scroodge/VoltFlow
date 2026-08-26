import assert from "node:assert/strict";
import test from "node:test";

import {
  AUX_BATTERY_ALERT_THRESHOLDS,
  AUX_BATTERY_REFERENCES,
  deriveAuxBatteryChemistry,
  resolveAuxBatteryChemistry,
} from "./vehicle/aux-battery-chemistry.ts";

test("derives the stock chemistry from model generation", () => {
  assert.equal(deriveAuxBatteryChemistry("gen1_2024"), "flooded");
  assert.equal(deriveAuxBatteryChemistry("gen2_2025"), "lifepo4");
});

test("alert thresholds warn earlier than command-block thresholds and never guess unknown chemistry", () => {
  for (const chemistry of ["flooded", "efb", "agm", "lifepo4"]) {
    assert.ok(AUX_BATTERY_ALERT_THRESHOLDS[chemistry] > AUX_BATTERY_REFERENCES[chemistry].lowVoltage);
  }
  assert.equal(AUX_BATTERY_ALERT_THRESHOLDS.other, null);
});

test("an explicit chemistry overrides the generation default", () => {
  assert.equal(resolveAuxBatteryChemistry("agm", "gen2_2025"), "agm");
  assert.equal(resolveAuxBatteryChemistry(null, "gen2_2025"), "lifepo4");
  assert.equal(resolveAuxBatteryChemistry(null, null), "other");
});

test("other keeps the legacy low reference and has no absolute resting band", () => {
  assert.deepEqual(AUX_BATTERY_REFERENCES.other, {
    restingBand: null,
    restingCeiling: null,
    lowVoltage: 11.8,
  });
});

test("resting ceilings leave margin above full charge while excluding converter voltage", () => {
  assert.equal(AUX_BATTERY_REFERENCES.flooded.restingCeiling, 12.9);
  assert.equal(AUX_BATTERY_REFERENCES.efb.restingCeiling, 13.0);
  assert.equal(AUX_BATTERY_REFERENCES.agm.restingCeiling, 13.1);
  assert.equal(AUX_BATTERY_REFERENCES.lifepo4.restingCeiling, 13.5);
});
