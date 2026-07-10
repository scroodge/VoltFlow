/**
 * Converts a telemetry vehicle alias lookup into the matching charging-session scope.
 * `null` means the requested alias does not belong to a car, so callers must return no
 * sessions rather than accidentally falling back to every car owned by the user.
 */
export function chargingSessionAnalyticsScope(
  vehicleId: string | null,
  carId: string | null,
): { car_id: string } | Record<string, never> | null {
  if (!vehicleId) return {};
  return carId ? { car_id: carId } : null;
}
