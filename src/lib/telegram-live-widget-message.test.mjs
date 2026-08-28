import assert from "node:assert/strict";
import test from "node:test";

import {
  composeTelegramLiveWidget,
  freshRangeEstimateKm,
  TELEGRAM_LIVE_RANGE_ACTIVE_MAX_AGE_MS,
  TELEGRAM_LIVE_RANGE_PARKED_MAX_AGE_MS,
} from "./telegram/live-widget-message.ts";

const NOW_MS = Date.parse("2026-08-28T12:00:00.000Z");

function message(overrides = {}) {
  return composeTelegramLiveWidget({
    carName: "Yuan UP Way",
    emoji: "🔌",
    state: "charging",
    locale: "ru",
    soc: 100,
    rangeEstKm: 286.6,
    rangeSampleTime: new Date(NOW_MS - 30_000).toISOString(),
    nowMs: NOW_MS,
    chargePowerKw: 4.4,
    timeToFull: null,
    odometer: 46632,
    speedKmh: 0,
    lat: 53.9,
    lon: 27.56,
    ...overrides,
  });
}

test("live widget header omits range and keeps odometer in detail row", () => {
  const lines = message().split("\n");

  assert.equal(lines[0], "🔋 100% · ⚡");
  assert.equal(lines[1], "<b>🔌 Yuan UP Way</b> · Зарядка");
  assert.equal(lines[3], "⚡ 4.4 kW");
  assert.equal(lines[4], "🚗 Пробег 46632 км");
  assert.equal(lines[5], '📍 <a href="https://www.google.com/maps?q=53.9,27.56">Открыть карту</a>');
  assert.doesNotMatch(lines[0], /46632/);
});

test("live widget omits an unavailable range from the header", () => {
  const lines = message({ rangeEstKm: null }).split("\n");

  assert.equal(lines[0], "🔋 100% · ⚡");
  assert.equal(lines[4], "🚗 Пробег 46632 км");
});

test("live widget omits a stale driving range from the header", () => {
  const range = freshRangeEstimateKm(
    286.6,
    new Date(NOW_MS - TELEGRAM_LIVE_RANGE_ACTIVE_MAX_AGE_MS - 1).toISOString(),
    NOW_MS,
    "driving",
  );

  assert.equal(range, null);
});

test("live widget omits a stale charging range from the header", () => {
  const range = freshRangeEstimateKm(
    286.6,
    new Date(NOW_MS - TELEGRAM_LIVE_RANGE_ACTIVE_MAX_AGE_MS - 1).toISOString(),
    NOW_MS,
    "charging",
  );

  assert.equal(range, null);
});

test("live widget keeps an overnight parked range but eventually expires it", () => {
  const overnight = freshRangeEstimateKm(
    286.6,
    new Date(NOW_MS - 12 * 60 * 60 * 1000).toISOString(),
    NOW_MS,
    "parked",
  );
  assert.equal(overnight, 287);

  const expired = freshRangeEstimateKm(
    286.6,
    new Date(NOW_MS - TELEGRAM_LIVE_RANGE_PARKED_MAX_AGE_MS - 1).toISOString(),
    NOW_MS,
    "parked",
  );
  assert.equal(expired, null);
});

test("live widget keeps an overnight range when the last vehicle state is offline", () => {
  const range = freshRangeEstimateKm(
    286.6,
    new Date(NOW_MS - 12 * 60 * 60 * 1000).toISOString(),
    NOW_MS,
    "offline",
  );

  assert.equal(range, 287);
});

test("live widget localizes message copy in English and Belarusian", () => {
  const english = message({ locale: "en", state: "parked", emoji: "🚗" });
  assert.match(english, /<b>🚗 Yuan UP Way<\/b> · Parked/);
  assert.match(english, /🚗 Mileage 46632 km/);
  assert.match(english, />Open map<\/a>/);

  const belarusian = message({ locale: "be", state: "driving", emoji: "🚗" });
  assert.match(belarusian, /<b>🚗 Yuan UP Way<\/b> · У руху/);
  assert.match(belarusian, /🚗 Прабег 46632 км/);
  assert.match(belarusian, />Адкрыць карту<\/a>/);
});
