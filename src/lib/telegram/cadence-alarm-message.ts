import { formatDuration } from "../../features/charging/_domain/charging-math.ts";

export type CadenceAlarmMessageInput = {
  user_id: string;
  vehicle_id: string;
  signal: "moving_gap" | "low_24h_count";
  observed_at: string;
  previous_moving_at: string | null;
  gap_seconds: number | string | null;
  sample_count_24h: number | null;
};

/**
 * Operator (admin) Telegram text for one cadence-collapse alarm. Admins see every user's
 * alarms, so it names the owner; a real mid-drive hole can last hours.
 */
export function cadenceAlarmMessage(alarm: CadenceAlarmMessageInput, ownerEmail: string | null): string {
  const owner = ownerEmail ?? `user ${alarm.user_id}`;
  const detail = alarm.signal === "moving_gap"
    ? `Moving samples were ${formatDuration(Number(alarm.gap_seconds))} apart.\n` +
      `From: ${alarm.previous_moving_at ?? "?"}\nTo: ${alarm.observed_at}`
    : `Only ${alarm.sample_count_24h ?? 0} telemetry samples arrived in 24 hours.\n` +
      `Last contact: ${alarm.observed_at}`;
  return `⚠️ VoltFlow telemetry cadence alarm: ${alarm.vehicle_id} (${owner}).\n${detail}`;
}
