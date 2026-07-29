type DeliverySample = {
  live_only?: boolean | null;
};

/**
 * A fast status batch is snapshot-only only when it contains no durable rollups.
 * A mixed batch keeps the full ingest path so a normal sample cannot lose its
 * trip, charging, notification, or history side effects.
 */
export function planTelemetryIngestDelivery(
  samples: readonly DeliverySample[],
  { hourlyBlockCount, tripBlockCount }: { hourlyBlockCount: number; tripBlockCount: number },
) {
  const snapshotOnly =
    samples.length > 0 &&
    hourlyBlockCount === 0 &&
    tripBlockCount === 0 &&
    samples.every((sample) => sample.live_only === true);

  return {
    snapshotOnly,
    verifyPersistedSnapshot: !snapshotOnly,
    runChargeNotifications: !snapshotOnly,
    runLiveStatusNotifications: !snapshotOnly,
    runAutoChargingSessions: !snapshotOnly,
    applyClientRollups: !snapshotOnly,
  };
}
