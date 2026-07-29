import assert from "node:assert/strict";
import test from "node:test";

import { planTelemetryIngestDelivery } from "./ingest-delivery.ts";

test("treats an all-live_only batch without rollups as snapshot-only", () => {
  assert.deepEqual(
    planTelemetryIngestDelivery([{ live_only: true }, { live_only: true }], {
      hourlyBlockCount: 0,
      tripBlockCount: 0,
    }),
    {
      snapshotOnly: true,
      verifyPersistedSnapshot: false,
      runChargeNotifications: false,
      runLiveStatusNotifications: false,
      runAutoChargingSessions: false,
      applyClientRollups: false,
    },
  );
});

test("keeps mixed or durable batches on the full ingest path", () => {
  assert.deepEqual(
    planTelemetryIngestDelivery([{ live_only: true }, { live_only: false }], {
      hourlyBlockCount: 0,
      tripBlockCount: 0,
    }),
    {
      snapshotOnly: false,
      verifyPersistedSnapshot: true,
      runChargeNotifications: true,
      runLiveStatusNotifications: true,
      runAutoChargingSessions: true,
      applyClientRollups: true,
    },
  );
  assert.equal(
    planTelemetryIngestDelivery([{ live_only: true }], {
      hourlyBlockCount: 1,
      tripBlockCount: 0,
    }).snapshotOnly,
    false,
  );
  assert.equal(
    planTelemetryIngestDelivery([{ live_only: true }], {
      hourlyBlockCount: 0,
      tripBlockCount: 1,
    }).snapshotOnly,
    false,
  );
});

test("keeps legacy samples without live_only on the full ingest path", () => {
  assert.equal(
    planTelemetryIngestDelivery([{}], {
      hourlyBlockCount: 0,
      tripBlockCount: 0,
    }).snapshotOnly,
    false,
  );
});
