import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";

import { verifyTelegramInitData } from "./verify-init-data.ts";

const BOT_TOKEN = "123456:TEST_TOKEN_abcDEF";

/** Build a correctly-signed initData string for a given user + auth_date. */
function buildInitData(user, authDate, token = BOT_TOKEN) {
  const params = new URLSearchParams();
  params.set("user", JSON.stringify(user));
  params.set("auth_date", String(authDate));
  params.set("query_id", "AAH-test");

  const pairs = [];
  for (const [key, value] of params) pairs.push(`${key}=${value}`);
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  const hash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  params.set("hash", hash);
  return params.toString();
}

const NOW = 1_900_000_000; // fixed clock for deterministic age checks
const now = () => NOW;

test("accepts a correctly signed payload and parses the user", () => {
  const user = { id: 42, first_name: "Test", username: "tester" };
  const initData = buildInitData(user, NOW - 10);
  const result = verifyTelegramInitData(initData, BOT_TOKEN, { now });
  assert.equal(result.ok, true);
  assert.equal(result.user.id, 42);
  assert.equal(result.user.username, "tester");
  assert.equal(result.authDate, NOW - 10);
});

test("rejects a tampered payload (signature mismatch)", () => {
  const initData = buildInitData({ id: 42, username: "tester" }, NOW - 10);
  const tampered = initData.replace("tester", "hacker"); // mutate user without re-signing
  assert.notEqual(tampered, initData);
  const result = verifyTelegramInitData(tampered, BOT_TOKEN, { now });
  assert.equal(result.ok, false);
  assert.equal(result.error, "bad_signature");
});

test("rejects a payload signed with a different token", () => {
  const initData = buildInitData({ id: 42 }, NOW - 10, "999:OTHER");
  const result = verifyTelegramInitData(initData, BOT_TOKEN, { now });
  assert.equal(result.ok, false);
  assert.equal(result.error, "bad_signature");
});

test("rejects an expired payload", () => {
  const initData = buildInitData({ id: 42 }, NOW - 48 * 60 * 60);
  const result = verifyTelegramInitData(initData, BOT_TOKEN, { now });
  assert.equal(result.ok, false);
  assert.equal(result.error, "expired");
});

test("rejects when hash is missing", () => {
  const result = verifyTelegramInitData("user=%7B%22id%22%3A1%7D&auth_date=1", BOT_TOKEN, { now });
  assert.equal(result.ok, false);
  assert.equal(result.error, "missing_hash");
});

test("rejects empty inputs", () => {
  assert.equal(verifyTelegramInitData("", BOT_TOKEN).ok, false);
  assert.equal(verifyTelegramInitData("hash=x", "").ok, false);
});
