import test from "node:test";
import assert from "node:assert/strict";

import {
  DIAGNOSTICS_MAX_COMMENT_CHARS,
  diagnosticsCaption,
  diagnosticsFileName,
  diagnosticsRateVerdict,
  isGzip,
  normalizeDiagnosticsComment,
  normalizeMateVersion,
  redactDiagnosticsText,
} from "./diagnostics.ts";

test("gzip is recognised by its magic bytes", () => {
  assert.equal(isGzip(new Uint8Array([0x1f, 0x8b, 8, 0])), true);
  assert.equal(isGzip(new Uint8Array([0x7b, 0x22])), false);
  assert.equal(isGzip(new Uint8Array([0x1f])), false);
});

test("secrets are redacted", () => {
  const out = redactDiagnosticsText(
    [
      "X-API-Key: 9e18aae878a5debaa78ff8f9ea2bbe77",
      '{"api_key":"abc123def","token": "tkn-1"}',
      "Authorization: Bearer eyJhbGciOi.payload.sig",
      "bot 1234567890:AAH3xYzAbCdEfGhIjKlMnOpQrStUvWxYz01 ok",
      "user councel.hp@example.com logged in",
    ].join("\n"),
  );
  assert.doesNotMatch(out, /9e18aae8|abc123def|tkn-1|eyJhbGciOi|AAH3xYz|councel/);
  assert.match(out, /X-API-Key: <redacted>/);
  assert.match(out, /<bot-token>/);
  assert.match(out, /<email>/);
});

test("every GPS form is removed (owner: GPS not needed)", () => {
  const out = redactDiagnosticsText(
    [
      '{"lat": 53.902284, "lon": 27.561831}',
      "location latitude=53.9 longitude=-27.56",
      "fix 53.902284, 27.561831 acc 5",
      "intent geo:53.9,27.56?q=home",
    ].join("\n"),
  );
  assert.doesNotMatch(out, /53\.9|27\.56/);
  assert.match(out, /"lat": <gps>/);
  assert.match(out, /latitude=<gps>/);
});

test("ordinary telemetry numbers survive", () => {
  const line = "soc=99.7 power_kw=-17 odometer_km=15251.8 cell_delta_v=0.026 12:38:52";
  assert.equal(redactDiagnosticsText(line), line);
});

test("a VIN keeps only its last 6 characters", () => {
  assert.equal(redactDiagnosticsText("vin=LGXCE4CB0P0123456"), "vin=VIN…123456");
});

test("rate limit: 3 per vehicle per hour, 10 per user per day", () => {
  assert.deepEqual(diagnosticsRateVerdict({ vehicleLastHour: 2, userLastDay: 9 }), { ok: true });
  assert.deepEqual(diagnosticsRateVerdict({ vehicleLastHour: 3, userLastDay: 0 }), {
    ok: false,
    reason: "vehicle_hourly",
  });
  assert.deepEqual(diagnosticsRateVerdict({ vehicleLastHour: 0, userLastDay: 10 }), {
    ok: false,
    reason: "user_daily",
  });
});

test("comment and version are normalised", () => {
  assert.equal(normalizeDiagnosticsComment("  нет   поездки\n12:38 "), "нет поездки 12:38");
  assert.equal(normalizeDiagnosticsComment("   "), null);
  assert.equal(normalizeDiagnosticsComment(42), null);
  assert.equal(
    normalizeDiagnosticsComment("x".repeat(DIAGNOSTICS_MAX_COMMENT_CHARS + 50)).length,
    DIAGNOSTICS_MAX_COMMENT_CHARS + 1,
  );
  assert.equal(normalizeMateVersion("0.6.1"), "0.6.1");
  assert.equal(normalizeMateVersion("<b>"), null);
});

test("file name is filesystem-safe and stamped in UTC", () => {
  assert.equal(
    diagnosticsFileName("BYD Yuan/UP", new Date("2026-10-21T09:46:57.850Z")),
    "diagnostics-BYD_Yuan_UP-20261021T094657Z.txt.gz",
  );
});

test("caption escapes HTML and stays within Telegram's 1024 chars", () => {
  const caption = diagnosticsCaption({
    carName: "Ваня <3",
    vehicleId: "cl",
    userId: "ce837128-8067-40f2-ba85-a2397c0196cd",
    mateVersion: "0.6.1",
    comment: "нет поездки & виджет",
    bytes: 120_000,
  });
  assert.match(caption, /Ваня &lt;3/);
  assert.match(caption, /💬 нет поездки &amp; виджет/);
  assert.match(caption, /Mate 0\.6\.1 · 117 KB/);
  assert.doesNotMatch(caption, /@/);

  const long = diagnosticsCaption({
    carName: "car",
    vehicleId: "cl",
    userId: "u",
    mateVersion: null,
    comment: "&".repeat(500),
    bytes: 1,
  });
  assert.ok(long.length <= 1024);
  assert.match(long, /&amp;…$/);
});
