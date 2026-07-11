import assert from "node:assert/strict";
import test from "node:test";

import { collectPagedRows } from "./paged-query.ts";

test("collectPagedRows appends full pages and preserves their order", async () => {
  const requested = [];
  const rows = await collectPagedRows({
    limit: 5,
    pageSize: 2,
    fetchPage: async (from, to) => {
      requested.push([from, to]);
      return [["newest", "newer"], ["older", "oldest"], ["first"]][from / 2];
    },
  });

  assert.deepEqual(requested, [[0, 1], [2, 3], [4, 4]]);
  assert.deepEqual(rows, ["newest", "newer", "older", "oldest", "first"]);
});

test("collectPagedRows stops after a short page", async () => {
  const requested = [];
  const rows = await collectPagedRows({
    limit: 5_000,
    pageSize: 1_000,
    fetchPage: async (from, to) => {
      requested.push([from, to]);
      return from === 0 ? ["only"] : [];
    },
  });

  assert.deepEqual(requested, [[0, 999]]);
  assert.deepEqual(rows, ["only"]);
});

test("collectPagedRows honors an exact display cap", async () => {
  const rows = await collectPagedRows({
    limit: 5,
    pageSize: 2,
    fetchPage: async (from, to) => Array.from({ length: to - from + 1 }, (_, index) => from + index),
  });

  assert.deepEqual(rows, [0, 1, 2, 3, 4]);
});

test("collectPagedRows does not query for an empty cap", async () => {
  let calls = 0;
  const rows = await collectPagedRows({
    limit: 0,
    fetchPage: async () => {
      calls += 1;
      return [];
    },
  });

  assert.deepEqual(rows, []);
  assert.equal(calls, 0);
});
