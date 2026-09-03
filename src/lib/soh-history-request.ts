import {
  resolveTelemetryWindow,
  type TelemetryHistoryRange,
} from "./voltflowmate/telemetry-ranges.ts";

export function resolveSohHistoryWindow(range: TelemetryHistoryRange, anchorDate: string) {
  return resolveTelemetryWindow(range, anchorDate);
}

export function buildSohHistoryPath({
  range,
  anchorDate,
  vehicleId,
}: {
  range: TelemetryHistoryRange;
  anchorDate: string;
  vehicleId: string | null;
}) {
  const params = new URLSearchParams({ range, date: anchorDate });
  if (vehicleId) params.set("vehicle_id", vehicleId);
  return `/api/vehicle/telemetry/soh?${params.toString()}`;
}
