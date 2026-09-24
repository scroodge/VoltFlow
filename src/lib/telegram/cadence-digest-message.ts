import { formatDuration } from "../../features/charging/_domain/charging-math.ts";

/**
 * Once-daily operator digest for cadence-collapse alarms held back by the 24h
 * per-tuple cooldown in `bydmate_detect_telemetry_cadence_collapses()` (see the
 * migration for why: a brand-new (user_id, vehicle_id, signal) pages immediately as
 * before, but a repeat of an already-notified tuple within 24h is left undelivered
 * and picked up here instead, so a chronic sender bug doesn't page admins daily).
 */

export type CadenceDigestAlarmInput = {
  user_id: string;
  vehicle_id: string;
  signal: "moving_gap" | "low_24h_count";
  observed_at: string;
  gap_seconds: number | string | null;
  sample_count_24h: number | null;
};

export type CadenceDigestGroup = {
  user_id: string;
  vehicle_id: string;
  signal: "moving_gap" | "low_24h_count";
  count: number;
  /** Largest moving_gap seen in the group; null for low_24h_count groups. */
  worstGapSeconds: number | null;
  /** Lowest (worst) 24h sample count seen in the group; null for moving_gap groups. */
  worstSampleCount24h: number | null;
  latestObservedAt: string;
};

const groupKey = (
  alarm: Pick<CadenceDigestAlarmInput, "user_id" | "vehicle_id" | "signal">,
) => `${alarm.user_id}\u0000${alarm.vehicle_id}\u0000${alarm.signal}`;

/** Pure grouping step, kept separate from the message text so it's testable without I/O. */
export function groupCadenceDigestAlarms(
  alarms: CadenceDigestAlarmInput[],
): CadenceDigestGroup[] {
  const groups = new Map<string, CadenceDigestGroup>();

  for (const alarm of alarms) {
    const gapSeconds =
      alarm.gap_seconds == null ? null : Number(alarm.gap_seconds);
    const existing = groups.get(groupKey(alarm));

    if (!existing) {
      groups.set(groupKey(alarm), {
        user_id: alarm.user_id,
        vehicle_id: alarm.vehicle_id,
        signal: alarm.signal,
        count: 1,
        worstGapSeconds: gapSeconds,
        worstSampleCount24h: alarm.sample_count_24h,
        latestObservedAt: alarm.observed_at,
      });
      continue;
    }

    existing.count += 1;
    if (
      gapSeconds != null &&
      (existing.worstGapSeconds == null ||
        gapSeconds > existing.worstGapSeconds)
    ) {
      existing.worstGapSeconds = gapSeconds;
    }
    if (
      alarm.sample_count_24h != null &&
      (existing.worstSampleCount24h == null ||
        alarm.sample_count_24h < existing.worstSampleCount24h)
    ) {
      existing.worstSampleCount24h = alarm.sample_count_24h;
    }
    if (
      new Date(alarm.observed_at).getTime() >
      new Date(existing.latestObservedAt).getTime()
    ) {
      existing.latestObservedAt = alarm.observed_at;
    }
  }

  return [...groups.values()];
}

/** Operator (admin) Telegram text for one day's held-back cadence alarms, one line per group. */
export function cadenceDigestMessage(
  groups: CadenceDigestGroup[],
  ownerEmailByUserId: Map<string, string | null>,
): string {
  const lines = groups.map((group) => {
    const owner =
      ownerEmailByUserId.get(group.user_id) ?? `user ${group.user_id}`;
    const detail =
      group.signal === "moving_gap"
        ? `${group.count}x moving_gap, worst ${formatDuration(Number(group.worstGapSeconds ?? 0))} apart`
        : `${group.count}x low_24h_count, as low as ${group.worstSampleCount24h ?? 0} samples/24h`;
    return `• ${group.vehicle_id} (${owner}): ${detail}. Last: ${group.latestObservedAt}`;
  });

  return (
    `📋 VoltFlow telemetry cadence digest — repeat alarms held back from real-time delivery:\n` +
    lines.join("\n")
  );
}
