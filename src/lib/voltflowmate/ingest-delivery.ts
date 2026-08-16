import {
  isTelemetryCharging,
  type TelemetryChargingDiplusContext,
} from "../../features/charging/_domain/telemetry-charging.ts";

type DeliveryTelemetry = {
  is_charging?: boolean | null;
  charge_power_kw?: number | null;
};

type DeliverySample = {
  live_only?: boolean | null;
  vehicle_id?: string;
  telemetry?: DeliveryTelemetry | null;
} & TelemetryChargingDiplusContext;

/**
 * Whether charge-notification bookkeeping could plausibly need to update: either the
 * batch itself shows a charging signal, or the vehicle's last known telemetry did --
 * the latter covers the just-stopped-charging sample, which needs to close out any
 * pending notification state even though it no longer reports charging itself.
 * Ignores the Di+ gun-state fallback for the "previous" side (no context is stored
 * there) -- real charge power is the primary signal per isTelemetryCharging's own
 * doc comment, so this stays conservative rather than wrong.
 */
export function batchHasChargingSignal(
  samples: readonly DeliverySample[],
  previousTelemetry: ReadonlyMap<string, { telemetry: DeliveryTelemetry }>,
) {
  if (samples.some((sample) => isTelemetryCharging(sample.telemetry ?? {}, sample))) {
    return true;
  }

  const vehicleIds = new Set(samples.map((sample) => sample.vehicle_id).filter(Boolean));
  for (const vehicleId of vehicleIds) {
    const previous = previousTelemetry.get(vehicleId as string)?.telemetry;
    if (previous && isTelemetryCharging(previous)) return true;
  }
  return false;
}

/**
 * A fast status batch is snapshot-only only when it contains no durable rollups.
 * A mixed batch keeps the full ingest path so a normal sample cannot lose its
 * trip, charging, notification, or history side effects.
 */
export function planTelemetryIngestDelivery(
  samples: readonly DeliverySample[],
  {
    hourlyBlockCount,
    tripBlockCount,
    chargingSignal,
  }: { hourlyBlockCount: number; tripBlockCount: number; chargingSignal: boolean },
) {
  const snapshotOnly =
    samples.length > 0 &&
    hourlyBlockCount === 0 &&
    tripBlockCount === 0 &&
    samples.every((sample) => sample.live_only === true);

  return {
    snapshotOnly,
    verifyPersistedSnapshot: !snapshotOnly,
    runChargeNotifications: !snapshotOnly && chargingSignal,
    runLiveStatusNotifications: !snapshotOnly,
    runAutoChargingSessions: !snapshotOnly,
    applyClientRollups: !snapshotOnly,
  };
}
