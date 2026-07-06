import test from "node:test";
import assert from "node:assert/strict";

import {
  decideTariffLocationAutosave,
  TARIFF_LOCATION_AUTOSAVE_DELAY_MS,
  uniqueTariffLocationName,
} from "./charging-tariff-location-autosave.ts";

const NOW = Date.parse("2026-07-06T12:00:00Z");
const READY_SELECTED_AT = new Date(NOW - TARIFF_LOCATION_AUTOSAVE_DELAY_MS - 1000).toISOString();
const TOO_RECENT_SELECTED_AT = new Date(NOW - 1000).toISOString();
const LOCATION = { lat: 53.9, lon: 27.56 };

function baseParams(overrides = {}) {
  return {
    sessionStatus: "charging",
    tariffManual: true,
    providerType: "malanka",
    tariffSelectedAt: READY_SELECTED_AT,
    nowMs: NOW,
    location: LOCATION,
    matched: null,
    ...overrides,
  };
}

test("skips when the session is no longer charging (unplugged before the delay)", () => {
  const result = decideTariffLocationAutosave(baseParams({ sessionStatus: "stopped" }));
  assert.deepEqual(result, { action: "skip", reason: "not-charging" });
});

test("skips when the tariff was never manually picked", () => {
  const result = decideTariffLocationAutosave(baseParams({ tariffManual: false }));
  assert.deepEqual(result, { action: "skip", reason: "not-manual" });
});

test("skips a custom (non-provider) manual pick", () => {
  const result = decideTariffLocationAutosave(baseParams({ providerType: "custom" }));
  assert.deepEqual(result, { action: "skip", reason: "custom-provider" });
});

test("skips when the pick hasn't stuck for the full delay yet", () => {
  const result = decideTariffLocationAutosave(
    baseParams({ tariffSelectedAt: TOO_RECENT_SELECTED_AT }),
  );
  assert.deepEqual(result, { action: "skip", reason: "too-early" });
});

test("skips when there is no tariff_selected_at at all", () => {
  const result = decideTariffLocationAutosave(baseParams({ tariffSelectedAt: null }));
  assert.deepEqual(result, { action: "skip", reason: "too-early" });
});

test("skips when no GPS location is available", () => {
  const result = decideTariffLocationAutosave(baseParams({ location: null }));
  assert.deepEqual(result, { action: "skip", reason: "no-location" });
});

test("skips (dedupe) when a matching location with the same provider already exists", () => {
  const matched = { id: "loc-1", provider_type: "malanka" };
  const result = decideTariffLocationAutosave(baseParams({ matched }));
  assert.deepEqual(result, {
    action: "skip",
    reason: "already-saved-same-provider",
    matchedLocationId: "loc-1",
  });
});

test("updates an existing location when the provider differs (user corrected the spot)", () => {
  const matched = { id: "loc-1", provider_type: "evika" };
  const result = decideTariffLocationAutosave(baseParams({ matched }));
  assert.deepEqual(result, { action: "update", matchedLocationId: "loc-1" });
});

test("inserts a new location when nothing matches", () => {
  const result = decideTariffLocationAutosave(baseParams());
  assert.deepEqual(result, { action: "insert" });
});

test("uniqueTariffLocationName keeps the base name when there is no collision", () => {
  assert.equal(uniqueTariffLocationName("Malanka", ["Evika!"]), "Malanka");
});

test("uniqueTariffLocationName appends an incrementing suffix on collision", () => {
  assert.equal(uniqueTariffLocationName("Malanka", ["Malanka"]), "Malanka 2");
  assert.equal(uniqueTariffLocationName("Malanka", ["Malanka", "Malanka 2"]), "Malanka 3");
});
