import assert from "node:assert/strict";
import test from "node:test";

import { mapAdminUsersStats } from "./admin-users-stats.ts";

test("maps a PostgREST RPC row with bigint values", () => {
  assert.deepEqual(
    mapAdminUsersStats([
      {
        connected_today: "12",
        registered_users_total: "54",
        registered_today: "3",
        removed_today: "1",
        trips_recorded_total: "987",
        removals_tracked_since: "2026-07-18",
      },
    ]),
    {
      connectionsToday: 12,
      registeredUsersTotal: 54,
      registeredToday: 3,
      removedToday: 1,
      tripsRecordedTotal: 987,
      removalsTrackedSince: "2026-07-18",
    },
  );
});

test("defaults malformed or empty RPC data to safe zero values", () => {
  assert.deepEqual(mapAdminUsersStats(null), {
    connectionsToday: 0,
    registeredUsersTotal: 0,
    registeredToday: 0,
    removedToday: 0,
    tripsRecordedTotal: 0,
    removalsTrackedSince: null,
  });
});
