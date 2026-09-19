import assert from "node:assert/strict";
import test from "node:test";

import {
  compactNumber,
  paymentMethodLabel,
  relativeTime,
  toDatetimeLocalValue,
} from "./admin-users-format.ts";

test("compactNumber abbreviates thousands and millions", () => {
  assert.equal(compactNumber(999), "999");
  assert.equal(compactNumber(1500), "1.5k");
  assert.equal(compactNumber(12000), "12k");
  assert.equal(compactNumber(2500000), "2.5m");
});

test("relativeTime buckets minutes, hours and days", () => {
  const now = Date.parse("2026-09-19T12:00:00Z");
  const ago = (ms) => new Date(now - ms).toISOString();
  assert.equal(relativeTime(null, now), "Never");
  assert.equal(relativeTime("nope", now), "Unknown");
  assert.equal(relativeTime(ago(10_000), now), "Just now");
  assert.equal(relativeTime(ago(5 * 60_000), now), "5m ago");
  assert.equal(relativeTime(ago(3 * 3_600_000), now), "3h ago");
  assert.equal(relativeTime(ago(2 * 86_400_000), now), "2d ago");
});

test("toDatetimeLocalValue handles empty and invalid input", () => {
  assert.equal(toDatetimeLocalValue(null), "");
  assert.equal(toDatetimeLocalValue("garbage"), "");
  assert.match(
    toDatetimeLocalValue("2026-09-19T12:00:00Z"),
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/,
  );
});

test("paymentMethodLabel falls back to Other", () => {
  assert.equal(paymentMethodLabel("cash"), "Cash");
  assert.equal(paymentMethodLabel("bank_transfer"), "Bank transfer");
  assert.equal(paymentMethodLabel("crypto"), "Other");
});
