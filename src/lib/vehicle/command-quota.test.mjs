import assert from "node:assert/strict";
import test from "node:test";

import {
  FREE_COMMAND_WINDOW_MS,
  FREE_SNAPSHOT_WINDOW_MS,
  quotaBlock,
  quotaMessage,
} from "./command-quota.ts";

const NOW = Date.parse("2026-11-04T09:00:00Z");
const ago = (ms) => new Date(NOW - ms).toISOString();
const done = (ms, result = null) => ({
  created_at: ago(ms),
  status: "done",
  result,
});

test("premium and admin are never limited", () => {
  assert.equal(quotaBlock("premium", "ac", [done(1000)], NOW), null);
  assert.equal(quotaBlock("admin", "camera_snapshot", [done(1000)], NOW), null);
});

test("free: one command per 5 minutes", () => {
  assert.equal(quotaBlock("free", "ac", [], NOW), null);
  const block = quotaBlock("free", "fan_speed_step", [done(60 * 1000)], NOW);
  assert.deepEqual(block, { bucket: "command", retryAfterSeconds: 240 });
  assert.equal(
    quotaBlock("free", "ac", [done(FREE_COMMAND_WINDOW_MS + 1)], NOW),
    null,
  );
});

test("free: one snapshot per 8 hours", () => {
  const block = quotaBlock(
    "free",
    "camera_snapshot",
    [done(2 * 60 * 60 * 1000)],
    NOW,
  );
  assert.deepEqual(block, {
    bucket: "snapshot",
    retryAfterSeconds: 6 * 60 * 60,
  });
  assert.equal(
    quotaBlock(
      "free",
      "camera_snapshot",
      [done(FREE_SNAPSHOT_WINDOW_MS + 1)],
      NOW,
    ),
    null,
  );
});

test("commands that did nothing are free", () => {
  const rows = [
    { created_at: ago(1000), status: "failed", result: { error: "timeout" } },
    {
      created_at: ago(1000),
      status: "rejected",
      result: { error: "vehicle_moving" },
    },
    done(1000, {
      verified: false,
      state: { field: "fan_level", before: 7, after: 7 },
    }),
  ];
  assert.equal(quotaBlock("free", "ac", rows, NOW), null);
  // In flight still counts, and a pre-0.6.4 ack (verified:false, no state) did run.
  assert.ok(
    quotaBlock("free", "ac", [{ created_at: ago(1000), status: "sent" }], NOW),
  );
  assert.ok(quotaBlock("free", "ac", [done(1000, { verified: false })], NOW));
});

test("messages name the wait", () => {
  assert.match(
    quotaMessage({ bucket: "command", retryAfterSeconds: 240 }),
    /Следующая команда — через 4 мин/,
  );
  assert.match(
    quotaMessage({ bucket: "snapshot", retryAfterSeconds: 6 * 3600 }),
    /Следующий снимок — через 6 ч\./,
  );
  assert.match(
    quotaMessage({ bucket: "command", retryAfterSeconds: 30 }),
    /30 с/,
  );
});
