import assert from "node:assert/strict";
import test from "node:test";

import { stampUserActivity, USER_ACTIVITY_REFRESH_MS } from "./user-activity.ts";

function fakeClient(error = null) {
  const calls = [];
  const builder = {
    update(value) {
      calls.push(["update", value]);
      return this;
    },
    eq(column, value) {
      calls.push(["eq", column, value]);
      return this;
    },
    or(filter) {
      calls.push(["or", filter]);
      return Promise.resolve({ error });
    },
  };
  return {
    calls,
    client: {
      from(table) {
        calls.push(["from", table]);
        return builder;
      },
    },
  };
}

test("activity stamps use the shared one-hour conditional update", async () => {
  const now = new Date("2026-08-27T12:00:00.000Z");
  const { client, calls } = fakeClient();

  assert.equal(await stampUserActivity(client, "user-1", now), true);
  assert.equal(USER_ACTIVITY_REFRESH_MS, 3_600_000);
  assert.deepEqual(calls, [
    ["from", "profiles"],
    ["update", { last_active_at: "2026-08-27T12:00:00.000Z" }],
    ["eq", "id", "user-1"],
    ["or", "last_active_at.is.null,last_active_at.lt.2026-08-27T11:00:00.000Z"],
  ]);
});

test("activity stamping is best effort and reports query failure", async () => {
  const { client } = fakeClient({ message: "database unavailable" });
  assert.equal(await stampUserActivity(client, "user-1"), false);
});

test("activity stamping does not fail the caller on transport errors", async () => {
  const client = { from: () => { throw new Error("offline"); } };
  assert.equal(await stampUserActivity(client, "user-1"), false);
});
