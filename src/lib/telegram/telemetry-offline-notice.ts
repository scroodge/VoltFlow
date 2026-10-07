export type TelemetryOfflineNoticeInput = {
  vehicleId: string;
  lastContact: string;
  sampleCount24h: number | null;
};

/** Owner-facing notice for a sustained loss of car telemetry. */
export function telemetryOfflineNotice({
  vehicleId,
  lastContact,
  sampleCount24h,
}: TelemetryOfflineNoticeInput): string {
  return `⚠️ VoltFlow: telemetry from ${vehicleId} is no longer arriving.\n` +
    `Last contact: ${lastContact}\n` +
    `Only ${sampleCount24h ?? 0} samples arrived in the last 24 hours.\n\n` +
    "Live status, remote commands, and automatic charging updates may be unavailable. " +
    "Check VoltFlow Mate on the head unit, its network connection, and Android background permissions.";
}
