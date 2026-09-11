import { formatDuration } from "../../features/charging/_domain/charging-math.ts";

export type CadenceAlarmMessageInput = {
  vehicle_id: string;
  signal: "moving_gap" | "low_24h_count";
  observed_at: string;
  gap_seconds: number | string | null;
  sample_count_24h: number | null;
};

/** Telegram text for one cadence-collapse alarm. A real mid-drive hole can last hours. */
export function cadenceAlarmMessage(alarm: CadenceAlarmMessageInput): string {
  const detail = alarm.signal === "moving_gap"
    ? `Moving samples were ${formatDuration(Number(alarm.gap_seconds))} apart.`
    : `Only ${alarm.sample_count_24h ?? 0} telemetry samples arrived in 24 hours.`;
  return `⚠️ VoltFlow telemetry cadence collapsed for ${alarm.vehicle_id}.\n${detail}\nObserved: ${alarm.observed_at}`;
}
