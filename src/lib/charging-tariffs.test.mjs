import test from "node:test";
import assert from "node:assert/strict";

import {
  providerTariffsFromRows,
  resolveProviderTariff,
  resolveSessionTariff,
  resolveTariffPrice,
  resolveTariffTypeByPower,
  userProvidersFromRows,
  resolveUserProviderPrices,
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
        user_provider_id: null,
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

test("user provider tariff resolution", () => {
  const userMap = userProvidersFromRows([
    { id: "up-1", user_id: "u1", label: "My Garage", home_price_per_kwh: 0.3, commercial_ac_price_per_kwh: 0.3, fast_dc_price_per_kwh: 0.5, created_at: "", updated_at: "" },
  ]);
  assert.deepEqual(resolveUserProviderPrices("up-1", userMap), { home: 0.3, commercial_ac: 0.3, fast_dc: 0.5 });
  assert.equal(resolveUserProviderPrices("nonexistent", userMap), null);

  const result = resolveSessionTariff({
    manualPricePerKwh: 0.66,
    manualTariffType: "fast_dc",
    manualProviderType: "user_provider",
    userProviderId: "up-1",
    chargerPowerKw: 4.4,
    location: { lat: 53.9, lon: 27.56 },
    locationPresets: [],
    profile,
    userProviderMap: userMap,
  });
  assert.equal(result.source, "manual");
  assert.equal(result.providerType, "user_provider");
  assert.equal(result.userProviderId, "up-1");
  assert.equal(result.tariffType, "fast_dc");
  assert.equal(result.pricePerKwh, 0.66);
});

test("user provider tariff resolution with location match", () => {
  const userMap = userProvidersFromRows([
    { id: "up-2", user_id: "u1", label: "Office", home_price_per_kwh: 0.4, commercial_ac_price_per_kwh: 0.4, fast_dc_price_per_kwh: 0.6, created_at: "", updated_at: "" },
  ]);
  const result = resolveSessionTariff({
    chargerPowerKw: 15,
    location: { lat: 53.9, lon: 27.56 },
    locationPresets: [
      {
        id: "loc-up",
        user_id: "u1",
        name: "Office spot",
        lat: 53.9,
        lng: 27.56,
        radius_m: 150,
        tariff_type: "commercial_ac",
        provider_type: "user_provider",
        user_provider_id: "up-2",
        price_per_kwh_override: null,
        created_at: "",
        updated_at: "",
      },
    ],
    profile,
    userProviderMap: userMap,
  });
  assert.equal(result.source, "location");
  assert.equal(result.providerType, "user_provider");
  assert.equal(result.userProviderId, "up-2");
  assert.equal(result.tariffType, "commercial_ac");
  assert.equal(result.pricePerKwh, 0.4);
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

test("resolveProviderTariff falls back to the hardcoded preset when no override exists", () => {
  assert.deepEqual(resolveProviderTariff("malanka"), PROVIDER_TARIFF_PRESETS.malanka);
  assert.deepEqual(resolveProviderTariff("malanka", {}), PROVIDER_TARIFF_PRESETS.malanka);
});

test("resolveProviderTariff prefers a user override over the hardcoded preset", () => {
  const overrides = { malanka: { home: 0.6, commercial_ac: 0.6, fast_dc: 0.8 } };
  assert.deepEqual(resolveProviderTariff("malanka", overrides), overrides.malanka);
  // untouched providers still fall back to their preset
  assert.deepEqual(resolveProviderTariff("evika", overrides), PROVIDER_TARIFF_PRESETS.evika);
});

test("resolveTariffPrice uses the provider override when present", () => {
  const overrides = { malanka: { home: 0.6, commercial_ac: 0.6, fast_dc: 0.8 } };
  assert.equal(
    resolveTariffPrice("fast_dc", profile, "malanka", overrides),
    0.8,
  );
  assert.equal(
    resolveTariffPrice("fast_dc", profile, "malanka"),
    PROVIDER_TARIFF_PRESETS.malanka.fast_dc,
  );
});

test("providerTariffsFromRows collapses rows into the overrides shape", () => {
  const overrides = providerTariffsFromRows([
    {
      user_id: "u1",
      provider_type: "malanka",
      home_price_per_kwh: 0.6,
      commercial_ac_price_per_kwh: 0.6,
      fast_dc_price_per_kwh: 0.8,
      created_at: "",
      updated_at: "",
    },
  ]);
  assert.deepEqual(overrides, { malanka: { home: 0.6, commercial_ac: 0.6, fast_dc: 0.8 } });
});

test("resolveSessionTariff applies provider overrides for a matched location", () => {
  const overrides = { malanka: { home: 0.6, commercial_ac: 0.6, fast_dc: 0.9 } };
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
        user_provider_id: null,
        price_per_kwh_override: null,
        created_at: "",
        updated_at: "",
      },
    ],
    profile,
    providerTariffs: overrides,
  });
  assert.equal(result.pricePerKwh, overrides.malanka.commercial_ac);
});

test("a location's price_per_kwh_override still wins over a provider override", () => {
  const overrides = { malanka: { home: 0.6, commercial_ac: 0.6, fast_dc: 0.9 } };
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
        price_per_kwh_override: 0.42,
        created_at: "",
        updated_at: "",
      },
    ],
    profile,
    providerTariffs: overrides,
  });
  assert.equal(result.pricePerKwh, 0.42);
});
