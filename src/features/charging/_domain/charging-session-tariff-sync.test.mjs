import test from "node:test";
import assert from "node:assert/strict";

import {
  sessionTariffMatches,
  shouldAutoApplyTariffResolution,
} from "./charging-session-tariff-sync.ts";

test("sessionTariffMatches compares tariff fields with price tolerance", () => {
  assert.equal(
    sessionTariffMatches(
      { tariff_type: "commercial_ac", provider_type: "malanka", price_per_kwh: 0.55 },
      { tariffType: "commercial_ac", providerType: "malanka", pricePerKwh: 0.55000001 },
    ),
    true,
  );
  assert.equal(
    sessionTariffMatches(
      { tariff_type: "home", provider_type: "custom", price_per_kwh: 0.15 },
      { tariffType: "commercial_ac", providerType: "malanka", pricePerKwh: 0.55 },
    ),
    false,
  );
});

test("shouldAutoApplyTariffResolution only allows GPS location matches", () => {
  assert.equal(
    shouldAutoApplyTariffResolution({
      tariffType: "commercial_ac",
      providerType: "malanka",
      pricePerKwh: 0.55,
      source: "location",
      locationPresetId: "preset-1",
    }),
    true,
  );
  assert.equal(
    shouldAutoApplyTariffResolution({
      tariffType: "home",
      providerType: "home",
      pricePerKwh: 0.15,
      source: "power",
      locationPresetId: null,
    }),
    false,
  );
});
