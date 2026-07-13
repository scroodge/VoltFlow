import assert from "node:assert/strict";
import { test } from "node:test";

import { formatTimeAgo, timeAgoParts } from "./time-ago.ts";

const NOW = Date.parse("2026-07-13T12:00:00.000Z");
const at = (offsetSeconds) => new Date(NOW - offsetSeconds * 1000).toISOString();

test("buckets sub-minute gaps as seconds", () => {
  assert.deepEqual(timeAgoParts(at(0), NOW), {
    key: "vehicle.timeAgoSeconds",
    value: 0,
  });
  assert.deepEqual(timeAgoParts(at(59), NOW), {
    key: "vehicle.timeAgoSeconds",
    value: 59,
  });
});

test("buckets sub-hour gaps as minutes", () => {
  assert.deepEqual(timeAgoParts(at(60), NOW), {
    key: "vehicle.timeAgoMinutes",
    value: 1,
  });
  assert.deepEqual(timeAgoParts(at(45 * 60), NOW), {
    key: "vehicle.timeAgoMinutes",
    value: 45,
  });
});

test("buckets hour-plus gaps as hours", () => {
  assert.deepEqual(timeAgoParts(at(60 * 60), NOW), {
    key: "vehicle.timeAgoHours",
    value: 1,
  });
  assert.deepEqual(timeAgoParts(at(5 * 60 * 60), NOW), {
    key: "vehicle.timeAgoHours",
    value: 5,
  });
});

test("clamps future timestamps to zero rather than going negative", () => {
  // Car clock ahead of the phone: report "0s ago", never "-12s ago".
  assert.deepEqual(timeAgoParts(at(-12), NOW), {
    key: "vehicle.timeAgoSeconds",
    value: 0,
  });
});

test("returns null for an unparseable timestamp", () => {
  assert.equal(timeAgoParts("not-a-date", NOW), null);
  assert.equal(
    formatTimeAgo("not-a-date", NOW, () => "unused"),
    null,
  );
});

test("formatTimeAgo passes the key and value to the translator", () => {
  const calls = [];
  const result = formatTimeAgo(at(90), NOW, (key, values) => {
    calls.push([key, values]);
    return `${values.value} min`;
  });

  assert.equal(result, "2 min");
  assert.deepEqual(calls, [["vehicle.timeAgoMinutes", { value: 2 }]]);
});
