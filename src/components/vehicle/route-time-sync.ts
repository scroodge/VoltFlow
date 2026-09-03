export const ROUTE_SYNC_TOLERANCE_MS = 15_000;

export function nearestRoutePointIndexByTime(
  points: readonly { time: number }[],
  selectedTimeMs: number | null | undefined,
  toleranceMs = ROUTE_SYNC_TOLERANCE_MS,
) {
  if (selectedTimeMs == null || !Number.isFinite(selectedTimeMs) || toleranceMs < 0) {
    return null;
  }

  let nearestIndex: number | null = null;
  let nearestDistanceMs = Infinity;

  for (let index = 0; index < points.length; index += 1) {
    const time = points[index]?.time;
    if (!Number.isFinite(time)) continue;

    const distanceMs = Math.abs(time - selectedTimeMs);
    if (distanceMs < nearestDistanceMs) {
      nearestIndex = index;
      nearestDistanceMs = distanceMs;
    }
  }

  return nearestDistanceMs <= toleranceMs ? nearestIndex : null;
}
