// A batch is "late" when its samples were recorded long before the server received them
// (car asleep/offline, flushed when it woke). Same 3 min as the live auto-start window: a
// sample older than that can never open a live session, so it must be recovered from history.
export const LATE_DELIVERY_MS = 3 * 60_000;
// How far before the earliest late sample a still-unclosed charge may have started.
export const LATE_RECOVERY_LOOKBACK_MS = 12 * 60 * 60_000;

export type LateDeliverySample = {
  vehicle_id: string;
  device_time: string;
  live_only?: boolean | null;
};

export type LateRecoveryWindow = {
  vehicleId: string;
  fromIso: string;
  toIso: string;
};

/**
 * Per vehicle, the telemetry range worth re-scanning for closed charges after this batch.
 * Empty when every sample was delivered promptly, so the normal fast path costs nothing.
 * `live_only` samples are never persisted to history and are ignored.
 */
export function lateDeliveryWindows(
  samples: readonly LateDeliverySample[],
  receivedAtMs: number,
): LateRecoveryWindow[] {
  const byVehicle = new Map<
    string,
    { earliestLateMs: number | null; latestMs: number }
  >();
  for (const sample of samples) {
    if (sample.live_only === true) continue;
    const deviceMs = Date.parse(sample.device_time);
    if (!Number.isFinite(deviceMs)) continue;
    const entry = byVehicle.get(sample.vehicle_id) ?? {
      earliestLateMs: null,
      latestMs: deviceMs,
    };
    entry.latestMs = Math.max(entry.latestMs, deviceMs);
    if (receivedAtMs - deviceMs > LATE_DELIVERY_MS) {
      entry.earliestLateMs =
        entry.earliestLateMs == null
          ? deviceMs
          : Math.min(entry.earliestLateMs, deviceMs);
    }
    byVehicle.set(sample.vehicle_id, entry);
  }

  const windows: LateRecoveryWindow[] = [];
  for (const [vehicleId, entry] of byVehicle) {
    if (entry.earliestLateMs == null) continue;
    windows.push({
      vehicleId,
      fromIso: new Date(
        entry.earliestLateMs - LATE_RECOVERY_LOOKBACK_MS,
      ).toISOString(),
      toIso: new Date(entry.latestMs).toISOString(),
    });
  }
  return windows;
}
