import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveSessionTariff,
  resolveTariffTypeByPower,
  PROVIDER_TARIFF_PRESETS,
} from "./charging-tariffs.ts";

const profile = {
  default_price_per_kwh: 0.5,
  home_price_per_kwh: 0.3,
  commercial_ac_price_per_kwh: 0.55,
  fast_dc_price_per_kwh: 0.73,
};

test("tariff boundaries by power", () => {
  assert.equal(resolveTariffTypeByPower(3.99), "home");
  assert.equal(resolveTariffTypeByPower(4.0), "commercial_ac");
  assert.equal(resolveTariffTypeByPower(9.99), "commercial_ac");
  assert.equal(resolveTariffTypeByPower(10.0), "fast_dc");
});

test("location preset wins over power resolver", () => {
  const result = resolveSessionTariff({
    chargerPowerKw: 15,
    location: { lat: 53.9, lon: 27.56 },
    locationPresets: [
      {
        id: "loc-1",
        user_id: "u1",
        name: "Malanka Plaza",
        lat: 53.9,
        lng: 27.56,
        radius_m: 150,
        tariff_type: "commercial_ac",
        provider_type: "malanka",
        price_per_kwh_override: null,
        created_at: "",
        updated_at: "",
      },
    ],
    profile,
  });
  assert.equal(result.source, "location");
  assert.equal(result.providerType, "malanka");
  assert.equal(result.tariffType, "commercial_ac");
  assert.equal(result.pricePerKwh, PROVIDER_TARIFF_PRESETS.malanka.commercial_ac);
});

test("manual override wins over location and power", () => {
  const result = resolveSessionTariff({
    manualPricePerKwh: 0.66,
    manualTariffType: "fast_dc",
    manualProviderType: "evika",
    chargerPowerKw: 4.4,
    location: { lat: 53.9, lon: 27.56 },
    locationPresets: [],
    profile,
  });
  assert.equal(result.source, "manual");
  assert.equal(result.providerType, "evika");
  assert.equal(result.tariffType, "fast_dc");
  assert.equal(result.pricePerKwh, 0.66);
});
