export function latestSampleByVehicle<T extends { vehicle_id: string; device_time: string }>(
  orderedSamples: readonly T[],
) {
  const latest = new Map<string, T>();
  for (const sample of orderedSamples) {
    latest.set(sample.vehicle_id, sample);
  }
  return latest;
}

export function latestDeviceTimeByVehicle<T extends { vehicle_id: string; device_time: string }>(
  orderedSamples: readonly T[],
) {
  const latest = new Map<string, string>();
  for (const [vehicleId, sample] of latestSampleByVehicle(orderedSamples)) {
    latest.set(vehicleId, sample.device_time);
  }
  return latest;
}
