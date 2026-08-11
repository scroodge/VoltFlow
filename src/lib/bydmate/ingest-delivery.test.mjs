import assert from "node:assert/strict";
import test from "node:test";

import { batchHasChargingSignal, planTelemetryIngestDelivery } from "./ingest-delivery.ts";

test("treats an all-live_only batch without rollups as snapshot-only", () => {
  assert.deepEqual(
    planTelemetryIngestDelivery([{ live_only: true }, { live_only: true }], {
      hourlyBlockCount: 0,
      tripBlockCount: 0,
      chargingSignal: false,
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
      chargingSignal: true,
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
      chargingSignal: true,
    }).snapshotOnly,
    false,
  );
  assert.equal(
    planTelemetryIngestDelivery([{ live_only: true }], {
      hourlyBlockCount: 0,
      tripBlockCount: 1,
      chargingSignal: true,
    }).snapshotOnly,
    false,
  );
});

test("keeps legacy samples without live_only on the full ingest path", () => {
  assert.equal(
    planTelemetryIngestDelivery([{}], {
      hourlyBlockCount: 0,
      tripBlockCount: 0,
      chargingSignal: true,
    }).snapshotOnly,
    false,
  );
});

test("mixed batch without a charging signal skips charge notifications only", () => {
  const plan = planTelemetryIngestDelivery([{ live_only: true }, { live_only: false }], {
    hourlyBlockCount: 0,
    tripBlockCount: 0,
    chargingSignal: false,
  });
  assert.equal(plan.snapshotOnly, false);
  assert.equal(plan.runChargeNotifications, false);
  assert.equal(plan.runLiveStatusNotifications, true);
  assert.equal(plan.runAutoChargingSessions, true);
  assert.equal(plan.applyClientRollups, true);
});

test("batchHasChargingSignal: true when a sample in the batch is charging", () => {
  assert.equal(
    batchHasChargingSignal(
      [{ vehicle_id: "way", telemetry: { charge_power_kw: 4 } }],
      new Map(),
    ),
    true,
  );
});

test("batchHasChargingSignal: true when the vehicle was charging previously, even if the batch is not", () => {
  assert.equal(
    batchHasChargingSignal(
      [{ vehicle_id: "way", telemetry: { charge_power_kw: 0 } }],
      new Map([["way", { telemetry: { charge_power_kw: 4 } }]]),
    ),
    true,
  );
});

test("batchHasChargingSignal: false when neither the batch nor prior telemetry shows charging", () => {
  assert.equal(
    batchHasChargingSignal(
      [{ vehicle_id: "way", telemetry: { speed_kmh: 60 } }],
      new Map([["way", { telemetry: { speed_kmh: 55 } }]]),
    ),
    false,
  );
});

test("batchHasChargingSignal: gun-state fallback still works for the current-batch side", () => {
  assert.equal(
    batchHasChargingSignal(
      [{ vehicle_id: "way", telemetry: {}, diplus_charge_gun_state: "2" }],
      new Map(),
    ),
    true,
  );
});
