import test from "node:test";
import assert from "node:assert/strict";

import {
  appPreferencesStorageKey,
  getPersistedAppPreferences,
  hasPersistedLocalePreference,
  parsePersistedAppPreferences,
} from "./app-preferences.ts";

test("parses valid persisted app preferences from zustand storage", () => {
  const result = parsePersistedAppPreferences(
    JSON.stringify({
      state: {
        selectedCarId: "car-1",
        defaultPricePerKwh: 0.17,
        currency: "BYN",
        locale: "be",
      },
      version: 0,
    }),
  );

  assert.deepEqual(result, {
    selectedCarId: "car-1",
    defaultPricePerKwh: 0.17,
    currency: "BYN",
    locale: "be",
  });
});

test("ignores invalid persisted locale values", () => {
  const result = parsePersistedAppPreferences(
    JSON.stringify({
      state: {
        currency: "EUR",
        locale: "de",
      },
    }),
  );

  assert.deepEqual(result, {
    currency: "EUR",
  });
});

test("returns null when parsing invalid JSON or non-record payloads", () => {
  assert.equal(parsePersistedAppPreferences(null), null);
  assert.equal(parsePersistedAppPreferences(""), null);
  assert.equal(parsePersistedAppPreferences("{invalid_json"), null);
  assert.equal(parsePersistedAppPreferences("12345"), null);
  assert.equal(parsePersistedAppPreferences('"just a string"'), null);
  assert.equal(parsePersistedAppPreferences("true"), null);
});

test("detects an on-device locale preference without throwing on bad storage", () => {
  const storage = new Map([
    [
      appPreferencesStorageKey,
      JSON.stringify({
        state: {
          locale: "ru",
        },
      }),
    ],
  ]);

  assert.equal(
    hasPersistedLocalePreference({
      getItem: (key) => storage.get(key) ?? null,
    }),
    true,
  );
  assert.equal(getPersistedAppPreferences({ getItem: () => "{" }), null);
});
