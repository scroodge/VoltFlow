import test from "node:test";
import assert from "node:assert/strict";

import { parseIngestStats } from "./ingest-stats.ts";

test("batch RPC with explicit inserted and duplicate counts", () => {
  const stats = parseIngestStats(
    {
      sample_count: 3,
      inserted_count: 2,
      duplicate_count: 1,
      skipped_stale_count: 0,
    },
    3,
  );

  assert.equal(stats.inserted_count, 2);
  assert.equal(stats.duplicate_count, 1);
  assert.equal(stats.skipped_stale_count, 0);
});

test("legacy batch RPC maps sample_count minus skipped to inserted", () => {
  const stats = parseIngestStats(
    {
      sample_count: 2,
      skipped_stale_count: 1,
    },
    3,
  );

  assert.equal(stats.skipped_stale_count, 1);
  assert.equal(stats.duplicate_count, 0);
  assert.equal(stats.inserted_count, 2);
});

test("single-sample duplicate", () => {
  const stats = parseIngestStats({ duplicate: true, vehicle_id: "way" }, 1);

  assert.equal(stats.inserted_count, 0);
  assert.equal(stats.duplicate_count, 1);
});

test("fully stale legacy batch yields zero inserted", () => {
  const stats = parseIngestStats(
    {
      sample_count: 0,
      skipped_stale_count: 15,
      live_device_time: "2026-06-04T10:00:00.000Z",
    },
    15,
  );

  assert.equal(stats.inserted_count, 0);
  assert.equal(stats.skipped_stale_count, 15);
  assert.equal(stats.duplicate_count, 0);
});
