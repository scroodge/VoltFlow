import test from "node:test";
import assert from "node:assert/strict";

import { validateQuickSessionInput } from "./checkout-input.ts";

function validate(overrides = {}) {
  return validateQuickSessionInput({
    startPct: "42",
    targetPct: "100",
    chargerKw: "",
    price: "0.55",
    ...overrides,
  });
}

test("accepts finite, deliberately entered values including a zero price", () => {
  const result = validate({ price: "0", chargerKw: "7,2" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    startPercent: 42,
    targetPercent: 100,
    chargerPowerKw: 7.2,
    pricePerKwh: 0,
  });
});

test("rejects blank and non-numeric values instead of coercing them to zero", () => {
  const result = validate({ startPct: "", price: "not a number" });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, { startPct: true, price: true });
});

test("keeps percentage and power limits aligned with the start-session schema", () => {
  const result = validate({ startPct: "80", targetPct: "80", chargerKw: "351" });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, { targetPct: true, chargerKw: true });
});
