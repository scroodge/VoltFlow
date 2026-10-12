import test from "node:test";
import assert from "node:assert/strict";

import {
  ANALYTICS_CARD_IDS,
  DEFAULT_ANALYTICS_CARD_ORDER,
  normalizeCardOrder,
} from "./analytics-card-order.ts";

test("normalizeCardOrder(null) returns the default order", () => {
  assert.deepEqual(normalizeCardOrder(null), [...DEFAULT_ANALYTICS_CARD_ORDER]);
  assert.deepEqual(normalizeCardOrder(undefined), [...ANALYTICS_CARD_IDS]);
});

test("normalizeCardOrder rejects non-array garbage with the default order", () => {
  for (const value of ["soh", 42, {}, "", true]) {
    assert.deepEqual(normalizeCardOrder(value), [...DEFAULT_ANALYTICS_CARD_ORDER]);
  }
});

test("normalizeCardOrder keeps saved order and drops unknown ids", () => {
  const saved = ["export", "ghost_card", "soh", "phantom"];
  const result = normalizeCardOrder(saved);
  assert.equal(result[0], "export");
  assert.equal(result[1], "soh");
  assert.equal(result[2], "phantom");
  assert.ok(!result.includes("ghost_card"));
});

test("normalizeCardOrder dedupes and appends every missing id exactly once", () => {
  const result = normalizeCardOrder(["soh", "soh", "battery_health"]);
  assert.equal(result.filter((id) => id === "soh").length, 1);
  assert.deepEqual(
    result.slice(2),
    DEFAULT_ANALYTICS_CARD_ORDER.filter(
      (id) => id !== "soh" && id !== "battery_health",
    ),
  );
  assert.equal(result.length, ANALYTICS_CARD_IDS.length);
});

test("normalizeCardOrder of a full valid order is a round trip", () => {
  const shuffled = [...ANALYTICS_CARD_IDS].reverse();
  assert.deepEqual(normalizeCardOrder(shuffled), shuffled);
});
