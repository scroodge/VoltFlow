import assert from "node:assert/strict";
import test from "node:test";
import { mapDayTelemetryBucketRows } from "./voltflowmate/telemetry-day-buckets.ts";

const complete = [
  { bucket_id: 0, bucket_kind: 0, device_time: "2026-08-20T00:10:00.000Z", telemetry: { power_kw: -80 }, source_sample_count: "42000", source_first_time: "2026-08-20T00:10:00.000Z", source_last_time: "2026-08-20T22:45:00.000Z" },
  { bucket_id: 400, bucket_kind: 1, device_time: "2026-08-20T12:00:00.000Z", telemetry: { power_kw: 120 }, source_sample_count: "42000", source_first_time: "2026-08-20T00:10:00.000Z", source_last_time: "2026-08-20T22:45:00.000Z" },
  { bucket_id: 799, bucket_kind: 2, device_time: "2026-08-20T22:45:00.000Z", telemetry: { power_kw: 0 }, source_sample_count: "42000", source_first_time: "2026-08-20T00:10:00.000Z", source_last_time: "2026-08-20T22:45:00.000Z" },
];

test("maps a full-window day envelope and removes transport metadata", () => {
  const points = mapDayTelemetryBucketRows(complete, 2400);
  assert.equal(points.length, 3);
  assert.equal(points[1].telemetry.power_kw, 120);
  assert.equal("source_sample_count" in points[0], false);
});

test("fails closed when coverage metadata reveals a partial response", () => {
  assert.throws(() => mapDayTelemetryBucketRows(complete.slice(0, 2), 2400), /complete source window/);
});

test("fails closed when the RPC exceeds the client point budget", () => {
  assert.throws(() => mapDayTelemetryBucketRows(complete, 2), /point budget/);
});
