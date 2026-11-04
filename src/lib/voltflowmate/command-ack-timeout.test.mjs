import assert from "node:assert/strict";
import test from "node:test";

import {
  SENT_ACK_TIMEOUT_MS,
  staleSentCommandIds,
} from "./command-ack-timeout.ts";

test("only sent rows older than the ack timeout are stale", () => {
  const now = Date.parse("2026-11-04T07:00:00Z");
  const at = (ms) => new Date(now - ms).toISOString();
  const rows = [
    {
      id: "old-sent",
      status: "sent",
      created_at: at(SENT_ACK_TIMEOUT_MS + 1000),
    },
    { id: "fresh-sent", status: "sent", created_at: at(30 * 1000) },
    { id: "old-done", status: "done", created_at: at(60 * 60 * 1000) },
    { id: "old-pending", status: "pending", created_at: at(60 * 60 * 1000) },
  ];
  assert.deepEqual(staleSentCommandIds(rows, now), ["old-sent"]);
  assert.deepEqual(staleSentCommandIds([], now), []);
});
