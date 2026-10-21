import test from "node:test";
import assert from "node:assert/strict";

import { formatChargingEndTime } from "./charging-end-time.ts";

// Local-time constructors keep these independent of the runner's time zone.
const at = (day, hours, minutes) =>
  new Date(2026, 9, day, hours, minutes).getTime();

const format = (nowMs, timeLeftSeconds, locale = "ru") =>
  formatChargingEndTime({
    nowMs,
    timeLeftSeconds,
    locale,
    tomorrowLabel: locale === "en" ? "tomorrow" : "завтра",
  });

test("same-day end shows only the clock time", () => {
  assert.equal(format(at(21, 10, 6), (2 * 60 + 28) * 60), "~12:34");
});

test("pads hours and minutes to 24 h", () => {
  assert.equal(format(at(21, 8, 0), 5 * 60 + 30), "~08:05");
  assert.equal(format(at(21, 20, 0), 3 * 3600 + 15 * 60), "~23:15");
});

test("end after midnight is marked tomorrow", () => {
  assert.equal(format(at(21, 22, 0), (5 * 60 + 10) * 60), "~03:10 завтра");
  assert.equal(
    format(at(21, 22, 0), (5 * 60 + 10) * 60, "en"),
    "~03:10 tomorrow",
  );
});

test("exactly midnight counts as tomorrow", () => {
  assert.equal(format(at(21, 23, 0), 3600), "~00:00 завтра");
});

test("end two or more days out shows the date", () => {
  const ru = format(at(21, 22, 0), (29 * 60 + 10) * 60);
  assert.match(ru, /^~03:10, 23 окт/);
  const en = format(at(21, 22, 0), (29 * 60 + 10) * 60, "en");
  assert.equal(en, "~03:10, Oct 23");
});

test("almost done, non-finite, or beyond 48 h yields no end time", () => {
  const now = at(21, 10, 0);
  assert.equal(format(now, 0), null);
  assert.equal(format(now, 60), null);
  assert.equal(format(now, Number.NaN), null);
  assert.equal(format(now, Number.POSITIVE_INFINITY), null);
  assert.equal(format(now, 48 * 3600 + 1), null);
  assert.equal(format(now, 61), "~10:01");
  assert.notEqual(format(now, 48 * 3600), null);
});
