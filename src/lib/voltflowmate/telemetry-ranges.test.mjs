import assert from "node:assert/strict";
import test from "node:test";

import {
  analyticsRangeAnchorForCurrentDate,
  isoWeekValueToAnchorDate,
  localCalendarDate,
  resolveTelemetryWindow,
  snapAnchorDateForRange,
} from "./telemetry-ranges.ts";

test("snapAnchorDateForRange week snaps mid-week date to Monday", () => {
  assert.equal(snapAnchorDateForRange("week", "2026-06-11"), "2026-06-08");
});

test("isoWeekValueToAnchorDate returns ISO week Monday", () => {
  assert.equal(isoWeekValueToAnchorDate("2026-W24"), "2026-06-08");
});

test("resolveTelemetryWindow week returns Monday-to-Sunday boundaries", () => {
  const window = resolveTelemetryWindow("week", "2026-06-08");
  assert.equal(window.from, "2026-06-08T00:00:00.000Z");
  assert.equal(window.to, "2026-06-14T23:59:59.999Z");
  assert.equal(window.useHourly, true);
  assert.equal(window.rawSampleDays, 3);
});

test("week snapping keeps ISO year boundary correct", () => {
  assert.equal(snapAnchorDateForRange("week", "2027-01-01"), "2026-12-28");
  assert.equal(isoWeekValueToAnchorDate("2026-W53"), "2026-12-28");
});

test("analytics range chips always re-anchor to today instead of a prior period end", () => {
  const july10 = new Date(2026, 6, 10, 12);
  assert.equal(localCalendarDate(july10), "2026-07-10");
  assert.equal(analyticsRangeAnchorForCurrentDate("day", july10), "2026-07-10");
  assert.equal(analyticsRangeAnchorForCurrentDate("week", july10), "2026-07-06");
  assert.equal(analyticsRangeAnchorForCurrentDate("month", july10), "2026-07-31");
  // A later range chip still starts from July 10, not the month-end anchor above.
  assert.equal(analyticsRangeAnchorForCurrentDate("week", july10), "2026-07-06");
  assert.equal(analyticsRangeAnchorForCurrentDate("day", july10), "2026-07-10");
});
