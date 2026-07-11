export function latestDeviceTimeByVehicle<T extends { vehicle_id: string; device_time: string }>(
  orderedSamples: readonly T[],
) {
  const latest = new Map<string, string>();
  for (const sample of orderedSamples) {
    latest.set(sample.vehicle_id, sample.device_time);
  }
  return latest;
}
