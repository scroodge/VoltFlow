import assert from "node:assert/strict";
import test from "node:test";

import {
  CAR_PROMISE_STORAGE_KEY,
  parseCarPromiseEnabled,
  readCarPromiseEnabled,
  writeCarPromiseEnabled,
} from "./car-promise-preference.ts";

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => void data.set(key, String(value)),
  };
}

const throwingStorage = {
  getItem() {
    throw new Error("blocked");
  },
  setItem() {
    throw new Error("blocked");
  },
};

test("defaults to OFF when nothing is stored or the value is unknown", () => {
  assert.equal(parseCarPromiseEnabled(null), false);
  assert.equal(parseCarPromiseEnabled(undefined), false);
  assert.equal(parseCarPromiseEnabled("garbage"), false);
});

test("honours an explicit stored choice", () => {
  assert.equal(parseCarPromiseEnabled("0"), false);
  assert.equal(parseCarPromiseEnabled("1"), true);
});

test("write then read round-trips through storage", () => {
  const storage = memoryStorage();
  assert.equal(writeCarPromiseEnabled(storage, false), true);
  assert.equal(storage.getItem(CAR_PROMISE_STORAGE_KEY), "0");
  assert.equal(readCarPromiseEnabled(storage), false);
  assert.equal(writeCarPromiseEnabled(storage, true), true);
  assert.equal(readCarPromiseEnabled(storage), true);
});

test("missing or throwing storage falls back to the default without throwing", () => {
  assert.equal(readCarPromiseEnabled(null), false);
  assert.equal(readCarPromiseEnabled(throwingStorage), false);
  assert.equal(writeCarPromiseEnabled(null, false), false);
  assert.equal(writeCarPromiseEnabled(throwingStorage, false), false);
});
