import test from "node:test";
import assert from "node:assert/strict";

import {
  convertPressureFromKpa,
  formatPressureFromKpa,
  isPressureUnit,
  isTyrePressureKpa,
} from "./pressure-units.ts";

test("converts the car's kPa readings for each display unit", () => {
  assert.equal(convertPressureFromKpa(250, "kPa"), 250);
  assert.equal(convertPressureFromKpa(250, "psi"), 36.259434425);
  assert.equal(convertPressureFromKpa(250, "bar"), 2.5);
});

test("formats pressure with unit-appropriate precision", () => {
  assert.equal(formatPressureFromKpa(250, "kPa"), "250");
  assert.equal(formatPressureFromKpa(250, "psi"), "36.3");
  assert.equal(formatPressureFromKpa(250, "bar"), "2.50");
});

test("accepts only supported units and plausible tyre-pressure readings", () => {
  assert.equal(isPressureUnit("kPa"), true);
  assert.equal(isPressureUnit("mmHg"), false);
  assert.equal(isTyrePressureKpa(250), true);
  assert.equal(isTyrePressureKpa(100), false);
  assert.equal(isTyrePressureKpa(Number.NaN), false);
});
