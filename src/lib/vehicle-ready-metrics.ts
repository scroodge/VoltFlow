export function vehicleReadyDurationBucket(durationMs: number) {
  if (durationMs <= 1_000) return "le_1s";
  if (durationMs <= 2_500) return "le_2_5s";
  if (durationMs <= 4_000) return "le_4s";
  return "gt_4s";
}
