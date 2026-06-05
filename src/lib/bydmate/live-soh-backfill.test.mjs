import test from "node:test";
import assert from "node:assert/strict";

import {
  enrichSnapshotWithSoh,
  snapshotNeedsSohBackfill,
  validSohPercent,
} from "./live-soh-backfill.ts";

test("validSohPercent accepts 0..100 and rejects nullish", () => {
  assert.equal(validSohPercent(98.5), 98.5);
  assert.equal(validSohPercent("99"), 99);
  assert.equal(validSohPercent(null), null);
  assert.equal(validSohPercent(101), null);
});

test("enrichSnapshotWithSoh fills missing soh_percent", () => {
  const snapshot = {
    vehicle_id: "way",
    telemetry: { soc: 82 },
  };

  const enriched = enrichSnapshotWithSoh(snapshot, 97.2);

  assert.equal(enriched.telemetry.soh_percent, 97.2);
  assert.equal(snapshotNeedsSohBackfill(enriched.telemetry), false);
});

test("enrichSnapshotWithSoh leaves existing soh_percent unchanged", () => {
  const snapshot = {
    vehicle_id: "way",
    telemetry: { soc: 82, soh_percent: 96 },
  };

  const enriched = enrichSnapshotWithSoh(snapshot, 97.2);

  assert.equal(enriched.telemetry.soh_percent, 96);
});
