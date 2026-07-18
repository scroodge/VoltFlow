import assert from "node:assert/strict";
import test from "node:test";

import { mapAdminUsersAttention } from "./admin-users-attention.ts";

test("maps valid attention rows and drops malformed rows", () => {
  assert.deepEqual(
    mapAdminUsersAttention([
      {
        kind: "mate_update",
        priority: "30",
        user_id: "user-1",
        email: "driver@example.com",
        created_at: "2026-07-01T10:00:00Z",
        last_seen_at: "2026-07-17T10:00:00Z",
        mate_version: "0.4.7",
        latest_mate_version: "0.4.8",
        premium_until: null,
      },
      { kind: "unknown", user_id: "user-2" },
      { kind: "stale_7d" },
    ]),
    [
      {
        kind: "mate_update",
        priority: 30,
        userId: "user-1",
        email: "driver@example.com",
        createdAt: "2026-07-01T10:00:00Z",
        lastSeenAt: "2026-07-17T10:00:00Z",
        mateVersion: "0.4.7",
        latestMateVersion: "0.4.8",
        premiumUntil: null,
      },
    ],
  );
});

test("defaults non-array RPC data to an empty queue", () => {
  assert.deepEqual(mapAdminUsersAttention(null), []);
});
