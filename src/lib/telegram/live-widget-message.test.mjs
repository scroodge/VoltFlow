import test from "node:test";
import assert from "node:assert/strict";

import {
  composeTelegramLiveWidget,
  mateVersionFooter,
} from "./live-widget-message.ts";

const BASE = {
  carName: "Seal",
  emoji: "🚗",
  state: "parked",
  locale: "en",
  soc: 80,
  estimatedRangeKm: null,
  rangeSampleTime: "2026-10-12T12:00:00Z",
  nowMs: Date.parse("2026-10-12T12:00:30Z"),
  chargePowerKw: null,
  timeToFull: null,
  odometer: null,
  speedKmh: null,
  lat: null,
  lon: null,
};

test("up-to-date Mate shows only the installed version", () => {
  assert.equal(
    mateVersionFooter({ locale: "en", mateVersion: "0.6.1", latestMateVersion: "0.6.1" }),
    "📱 VoltFlow Mate 0.6.1",
  );
});

test("installed newer than latest is not an update", () => {
  assert.equal(
    mateVersionFooter({ locale: "en", mateVersion: "0.6.2", latestMateVersion: "0.6.1" }),
    "📱 VoltFlow Mate 0.6.2",
  );
});

test("outdated Mate warns with installed → latest", () => {
  assert.equal(
    mateVersionFooter({ locale: "ru", mateVersion: "0.5.0", latestMateVersion: "0.6.1" }),
    "⚠️ VoltFlow Mate 0.5.0 → 0.6.1 — <b>доступно обновление</b>",
  );
});

test("unknown latest shows the version without a warning", () => {
  assert.equal(
    mateVersionFooter({ locale: "en", mateVersion: "0.5.0", latestMateVersion: null }),
    "📱 VoltFlow Mate 0.5.0",
  );
});

test("unknown installed version hides the footer", () => {
  assert.equal(
    mateVersionFooter({ locale: "en", mateVersion: null, latestMateVersion: "0.6.1" }),
    null,
  );
  assert.equal(
    mateVersionFooter({ locale: "en", mateVersion: "  ", latestMateVersion: "0.6.1" }),
    null,
  );
});

test("reported version is HTML-escaped", () => {
  assert.equal(
    mateVersionFooter({ locale: "en", mateVersion: "<x>", latestMateVersion: null }),
    "📱 VoltFlow Mate &lt;x&gt;",
  );
});

test("footer is the last widget line", () => {
  const html = composeTelegramLiveWidget({
    ...BASE,
    mateVersion: "0.5.0",
    latestMateVersion: "0.6.1",
  });
  const lines = html.split("\n");
  assert.equal(
    lines.at(-1),
    "⚠️ VoltFlow Mate 0.5.0 → 0.6.1 — <b>update available</b>",
  );
});

test("no footer when the car reports no version", () => {
  const html = composeTelegramLiveWidget(BASE);
  assert.ok(!html.includes("VoltFlow Mate"));
});
