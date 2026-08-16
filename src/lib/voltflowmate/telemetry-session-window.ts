const COMPLETED_CHARGING_SAMPLE_TAIL_MS = 10 * 60 * 1000;

export function resolveChargingSessionSampleWindow({
  status,
  startedAt,
  stoppedAt,
  updatedAt,
  currentPercent,
  targetPercent,
  now = new Date(),
}: {
  status: string | null;
  startedAt: string;
  stoppedAt: string | null;
  updatedAt: string | null;
  currentPercent: number | null;
  targetPercent: number | null;
  now?: Date;
}) {
  const baseEndAt =
    stoppedAt ??
    (status === "charging" ? now.toISOString() : updatedAt) ??
    now.toISOString();
  const shouldIncludeCompletionTail =
    status === "completed" &&
    typeof currentPercent === "number" &&
    typeof targetPercent === "number" &&
    currentPercent >= targetPercent;
  const endAt = shouldIncludeCompletionTail
    ? new Date(Date.parse(baseEndAt) + COMPLETED_CHARGING_SAMPLE_TAIL_MS).toISOString()
    : baseEndAt;

  return { from: startedAt, to: endAt };
}
