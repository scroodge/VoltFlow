import test from "node:test";
import assert from "node:assert/strict";

import {
  defaultUserProviderSeeds,
  findDefaultHomeProvider,
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

test("location preset wins over power resolver (legacy bare-enum row)", () => {
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
    {
      id: "up-1",
      user_id: "u1",
      label: "My Garage",
      home_price_per_kwh: 0.3,
      commercial_ac_price_per_kwh: 0.3,
      fast_dc_price_per_kwh: 0.5,
      is_default: false,
      created_at: "",
      updated_at: "",
    },
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
    {
      id: "up-2",
      user_id: "u1",
      label: "Office",
      home_price_per_kwh: 0.4,
      commercial_ac_price_per_kwh: 0.4,
      fast_dc_price_per_kwh: 0.6,
      is_default: false,
      created_at: "",
      updated_at: "",
    },
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

test("manual override wins over location and power (legacy bare-enum provider)", () => {
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

test("resolveProviderTariff falls back to the hardcoded preset for legacy bare-enum providers", () => {
  assert.deepEqual(resolveProviderTariff("malanka"), PROVIDER_TARIFF_PRESETS.malanka);
  assert.deepEqual(resolveProviderTariff("evika"), PROVIDER_TARIFF_PRESETS.evika);
});

test("resolveTariffPrice resolves a legacy bare-enum provider via the hardcoded preset", () => {
  assert.equal(
    resolveTariffPrice("fast_dc", profile, "malanka"),
    PROVIDER_TARIFF_PRESETS.malanka.fast_dc,
  );
});

test("defaultUserProviderSeeds returns the 6 seed providers with Home flagged is_default", () => {
  const seeds = defaultUserProviderSeeds();
  assert.equal(seeds.length, 6);
  const home = seeds.find((s) => s.label === "Home");
  assert.equal(home.is_default, true);
  assert.equal(home.commercial_ac_price_per_kwh, PROVIDER_TARIFF_PRESETS.home.commercial_ac);
  const others = seeds.filter((s) => s.label !== "Home");
  assert.equal(others.length, 5);
  assert.ok(others.every((s) => s.is_default === false));
  const malanka = seeds.find((s) => s.label === "Malanka");
  assert.equal(malanka.fast_dc_price_per_kwh, PROVIDER_TARIFF_PRESETS.malanka.fast_dc);
});

test("findDefaultHomeProvider returns the is_default row, or null if unseeded", () => {
  assert.equal(findDefaultHomeProvider(undefined), null);
  assert.equal(findDefaultHomeProvider({}), null);
  const userMap = userProvidersFromRows([
    {
      id: "up-home",
      user_id: "u1",
      label: "Home",
      home_price_per_kwh: 0.2,
      commercial_ac_price_per_kwh: 0.5,
      fast_dc_price_per_kwh: 0.5,
      is_default: true,
      created_at: "",
      updated_at: "",
    },
    {
      id: "up-3",
      user_id: "u1",
      label: "Custom Spot",
      home_price_per_kwh: 0.4,
      commercial_ac_price_per_kwh: 0.4,
      fast_dc_price_per_kwh: 0.6,
      is_default: false,
      created_at: "",
      updated_at: "",
    },
  ]);
  const home = findDefaultHomeProvider(userMap);
  assert.equal(home?.id, "up-home");
});

test("auto power fallback for home tariff resolves through the seeded Home provider", () => {
  const userMap = userProvidersFromRows([
    {
      id: "up-home",
      user_id: "u1",
      label: "Home",
      home_price_per_kwh: 0.22,
      commercial_ac_price_per_kwh: 0.5,
      fast_dc_price_per_kwh: 0.5,
      is_default: true,
      created_at: "",
      updated_at: "",
    },
  ]);
  const result = resolveSessionTariff({
    chargerPowerKw: 3.5,
    location: null,
    locationPresets: [],
    profile,
    userProviderMap: userMap,
  });
  assert.equal(result.source, "power");
  assert.equal(result.tariffType, "home");
  assert.equal(result.providerType, "user_provider");
  assert.equal(result.userProviderId, "up-home");
  assert.equal(result.pricePerKwh, 0.22);
});

test("auto power fallback falls back to custom/profile price when Home isn't seeded yet", () => {
  const result = resolveSessionTariff({
    chargerPowerKw: 3.5,
    location: null,
    locationPresets: [],
    profile,
  });
  assert.equal(result.source, "power");
  assert.equal(result.tariffType, "home");
  assert.equal(result.providerType, "custom");
  assert.equal(result.userProviderId, null);
  assert.equal(result.pricePerKwh, profile.home_price_per_kwh);
});
