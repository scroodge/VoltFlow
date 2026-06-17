import test from "node:test";
import assert from "node:assert/strict";

import {
  isPremiumFromUntil,
  resolveEffectivePremium,
} from "./premium-entitlement.ts";

test("isPremiumFromUntil returns true for future premium_until", () => {
  assert.equal(isPremiumFromUntil("2099-01-01T00:00:00.000Z", Date.parse("2026-01-01T00:00:00Z")), true);
});

test("isPremiumFromUntil returns false for past or invalid values", () => {
  assert.equal(isPremiumFromUntil("2020-01-01T00:00:00.000Z", Date.parse("2026-01-01T00:00:00Z")), false);
  assert.equal(isPremiumFromUntil("not-a-date", Date.parse("2026-01-01T00:00:00Z")), false);
  assert.equal(isPremiumFromUntil(null, Date.parse("2026-01-01T00:00:00Z")), false);
});

test("resolveEffectivePremium prioritizes admin and flag before term", () => {
  assert.equal(
    resolveEffectivePremium({
      isAdmin: true,
      isPremiumFlag: false,
      premiumUntil: null,
      nowMs: Date.parse("2026-01-01T00:00:00Z"),
    }),
    true,
  );
  assert.equal(
    resolveEffectivePremium({
      isAdmin: false,
      isPremiumFlag: true,
      premiumUntil: null,
      nowMs: Date.parse("2026-01-01T00:00:00Z"),
    }),
    true,
  );
  assert.equal(
    resolveEffectivePremium({
      isAdmin: false,
      isPremiumFlag: false,
      premiumUntil: "2099-01-01T00:00:00.000Z",
      nowMs: Date.parse("2026-01-01T00:00:00Z"),
    }),
    true,
  );
  assert.equal(
    resolveEffectivePremium({
      isAdmin: false,
      isPremiumFlag: false,
      premiumUntil: "2020-01-01T00:00:00.000Z",
      nowMs: Date.parse("2026-01-01T00:00:00Z"),
    }),
    false,
  );
});
